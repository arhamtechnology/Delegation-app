import { formatChecklistDueAt } from '../checklists/checklist-time.js';

// FMS (flow monitoring) rules and wording. Pure: fms-run.js does the I/O.
export const stepCodes = new Set(['approval', 'dispatch', 'invoice', 'transport']);
export const feedLookbackMs = 3 * 24 * 60 * 60000;
export const assignedLookbackMs = 30 * 60000;
export const dueSoonMs = 30 * 60000;
export const overdueWindowMs = 60 * 60000;
export const escalateAfterMs = 60 * 60000;

const refLabels = { invoice: 'Dispatch', transport: 'Invoice' };

export function dueAt(item, step) {
  return new Date(Date.parse(item.started_at) + step.eta_minutes * 60000).toISOString();
}

/** pending | overdue | done (on time) | late (done after the ETA) | cancelled */
export function itemStatus(item, step, now) {
  const due = Date.parse(dueAt(item, step));
  if (item.done_at) return Date.parse(item.done_at) <= due ? 'done' : 'late';
  if (item.cancelled) return 'cancelled';
  return now.getTime() > due ? 'overdue' : 'pending';
}

/** One feed row from the ERP as an fms_items row, or null when it is malformed. */
export function feedRowToItem(row, process, syncedAt) {
  const valid = row && typeof row.key === 'string' && stepCodes.has(row.step) && typeof row.order_id === 'string'
    && row.order_no && !Number.isNaN(Date.parse(row.started_at));
  if (!valid) return null;
  return {
    key: row.key,
    process,
    step: row.step,
    order_id: row.order_id,
    order_no: String(row.order_no),
    customer: row.customer ? String(row.customer) : null,
    ref: row.ref ? String(row.ref) : null,
    started_at: row.started_at,
    done_at: row.done_at && !Number.isNaN(Date.parse(row.done_at)) ? row.done_at : null,
    cancelled: row.cancelled === true,
    synced_at: syncedAt,
  };
}

/** The ERP's step rows for orders punched since `from`; finished orders only if changed since `since`. */
export async function fetchFmsFeed({ from, since }, fetchImpl = fetch) {
  const { ERP_FMS_URL, ERP_FORWARD_SECRET } = process.env;
  if (!ERP_FMS_URL || !ERP_FORWARD_SECRET) return null;
  const response = await fetchImpl(ERP_FMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wa-forward': ERP_FORWARD_SECRET },
    body: JSON.stringify({ from, since }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`ERP FMS feed failed with status ${response.status}.`);
  const body = await response.json();
  if (!body?.ok || !Array.isArray(body.steps)) throw new Error('ERP FMS feed returned no steps.');
  return body.steps;
}

/**
 * Alerts owed at `now` for open items, before de-duplication. `anchor` keys each alert, so a changed
 * ETA earns fresh reminders. Windows are bounded so a long outage never floods anyone with stale alerts.
 * @param {{ key: string, step: string, order_no: string, customer?: string | null, ref?: string | null, started_at: string }[]} items
 * @param {Map<string, { name: string, eta_minutes: number, doer_id: string | null, doerName?: string | null }>} steps
 */
export function planFmsAlerts(items, steps, now) {
  const at = now.getTime();
  const alerts = [];
  for (const item of items) {
    const step = steps.get(item.step);
    if (!step) continue;
    const due = dueAt(item, step);
    const base = { key: item.key, step: item.step, stepName: step.name, doerId: step.doer_id, doerName: step.doerName || null, orderNo: item.order_no, customer: item.customer, ref: item.ref, due };
    const sinceStart = at - Date.parse(item.started_at);
    const late = at - Date.parse(due);
    if (sinceStart >= 0 && sinceStart <= assignedLookbackMs) alerts.push({ ...base, stage: 'assigned', anchor: item.started_at });
    if (late < 0 && -late <= dueSoonMs) alerts.push({ ...base, stage: 'due_soon', anchor: due });
    if (late >= 0 && late < overdueWindowMs) alerts.push({ ...base, stage: 'overdue', anchor: due });
    if (late >= escalateAfterMs && late < escalateAfterMs + overdueWindowMs) alerts.push({ ...base, stage: 'escalated', anchor: due });
  }
  return alerts;
}

const headers = {
  assigned: '🆕 FMS · New pending work',
  due_soon: '⏰ FMS · Due in 30 minutes',
  overdue: '⚠️ FMS · Overdue: the ETA has passed',
  escalated: '🚨 FMS · Still pending 1 hour after the ETA',
};
const stageOrder = ['assigned', 'due_soon', 'overdue', 'escalated'];
const blocksPerSection = 10;

function block(alert) {
  const lines = [`Step: ${alert.stepName}`, `Order: ${alert.orderNo}${alert.customer ? ` · ${alert.customer}` : ''}`];
  if (alert.ref && refLabels[alert.step]) lines.push(`${refLabels[alert.step]}: ${alert.ref}`);
  lines.push(`Due: ${formatChecklistDueAt(alert.due)}`);
  lines.push(`Doer: ${alert.doerName || 'Not assigned'}`);
  return lines.join('\n');
}

/**
 * One WhatsApp message per recipient. Doers get none (their FMS steps are on their dashboard):
 * EAs get every stage, directors also get the 1-hour escalation.
 * @param {string[]} eaChats
 * @param {string[]} directorChats
 * @returns {{ chatId: string, text: string }[]}
 */
export function buildFmsMessages(alerts, eaChats, directorChats) {
  const inbox = new Map();
  const add = (chatId, alert) => {
    if (!chatId) return;
    const stages = inbox.get(chatId) || new Map();
    stages.set(alert.stage, [...(stages.get(alert.stage) || []), block(alert)]);
    inbox.set(chatId, stages);
  };
  for (const alert of alerts) {
    const recipients = new Set([...eaChats, ...(alert.stage === 'escalated' ? directorChats : [])]);
    for (const chatId of recipients) add(chatId, alert);
  }
  return [...inbox.entries()].map(([chatId, stages]) => ({
    chatId,
    text: stageOrder.filter((stage) => stages.has(stage)).map((stage) => {
      const blocks = stages.get(stage);
      const shown = blocks.slice(0, blocksPerSection);
      if (blocks.length > shown.length) shown.push(`+${blocks.length - shown.length} more on the FMS page`);
      return `${headers[stage]}\n\n${shown.join('\n\n')}`;
    }).join('\n\n'),
  }));
}

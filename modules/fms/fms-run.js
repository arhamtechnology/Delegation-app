import { createSupabaseAdminClient } from '../../lib/supabase-server';
import { getTransport } from '../whatsapp/transport';
import { send } from '../whatsapp/alerts-run';
import { directorRoles } from '../whatsapp/alerts.mjs';
import { buildFmsMessages, feedLookbackMs, feedRowToItem, fetchFmsFeed, planFmsAlerts } from './fms.mjs';

const upsertChunk = 500;

async function loadSteps(admin, code) {
  const { data, error } = await admin.from('fms_steps').select('code,name,eta_minutes,doer_id,doer:employees!fms_steps_doer_id_fkey(name)').eq('process', code);
  if (error) throw error;
  return new Map(data.map((step) => [step.code, { ...step, doerName: step.doer?.name || null }]));
}

/** Pull the ERP feed into fms_items. The ERP is the source of truth, so every row is overwritten. */
export async function syncFmsFeed(admin, flow, now, fetchImpl = fetch) {
  const from = flow.live_from;
  const since = new Date(now.getTime() - feedLookbackMs).toISOString();
  const rows = await fetchFmsFeed({ from, since }, fetchImpl);
  if (!rows) return { skipped: 'ERP_FMS_URL or ERP_FORWARD_SECRET is not set' };
  const syncedAt = now.toISOString();
  const items = rows.map((row) => feedRowToItem(row, flow.code, syncedAt)).filter(Boolean);
  for (let index = 0; index < items.length; index += upsertChunk) {
    const { error } = await admin.from('fms_items').upsert(items.slice(index, index + upsertChunk), { onConflict: 'key' });
    if (error) throw error;
  }
  // Open work the feed no longer lists (dispatch cancelled, approval withdrawn, order gone) is closed.
  // shortcut: a sync gap longer than feedLookbackMs marks finished work cancelled instead of done; widen the lookback if that happens.
  const { count, error } = await admin.from('fms_items').update({ cancelled: true }, { count: 'exact' })
    .eq('process', flow.code).is('done_at', null).eq('cancelled', false).lt('synced_at', syncedAt);
  if (error) throw error;
  return { synced: items.length, closed: count || 0 };
}

async function claim(admin, planned) {
  if (!planned.length) return [];
  const { data, error } = await admin
    .from('fms_alerts')
    .upsert(planned.map((alert) => ({ item_key: alert.key, stage: alert.stage, anchor: alert.anchor })), { onConflict: 'item_key,stage,anchor', ignoreDuplicates: true })
    .select('item_key,stage,anchor');
  if (error) throw error;
  const keys = new Set((data || []).map((row) => `${row.item_key}|${row.stage}|${Date.parse(row.anchor)}`));
  return planned.filter((alert) => keys.has(`${alert.key}|${alert.stage}|${Date.parse(alert.anchor)}`));
}

// EAs, and every director number (one director login can have several linked numbers).
async function loadChats(admin) {
  const [directors, links, eas] = await Promise.all([
    admin.from('employees').select('id,whatsapp_chat_id').in('role', [...directorRoles]).eq('active', true),
    admin.from('wa_chat_links').select('chat_id,employee_id'),
    admin.from('employees').select('whatsapp_chat_id').eq('role', 'ea').eq('active', true).not('whatsapp_chat_id', 'is', null),
  ]);
  for (const result of [directors, links, eas]) if (result.error) throw result.error;
  const directorIds = new Set(directors.data.map((employee) => employee.id));
  const directorChats = [...new Set([
    ...directors.data.map((employee) => employee.whatsapp_chat_id),
    ...links.data.filter((link) => directorIds.has(link.employee_id)).map((link) => link.chat_id),
  ].filter(Boolean))];
  return { eaChats: eas.data.map((employee) => employee.whatsapp_chat_id), directorChats };
}

export async function sendFmsAlerts(admin, transport, flow, now) {
  const [steps, open] = await Promise.all([
    loadSteps(admin, flow.code),
    admin.from('fms_items').select('key,step,order_no,customer,ref,started_at').eq('process', flow.code).is('done_at', null).eq('cancelled', false).limit(2000),
  ]);
  if (open.error) throw open.error;
  const alerts = await claim(admin, planFmsAlerts(open.data, steps, now));
  if (!alerts.length) return 0;
  const { eaChats, directorChats } = await loadChats(admin);
  let sent = 0;
  for (const message of buildFmsMessages(alerts, eaChats, directorChats)) {
    try {
      await send(admin, transport, message.chatId, message.text);
      sent += 1;
    } catch (sendError) {
      console.error('FMS alert send failed.', { message: sendError?.message });
    }
  }
  return sent;
}

/** One scheduler tick for every active FMS flow: sync from the ERP, then WhatsApp alerts. */
export async function runFmsTick(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const { data: processes, error } = await admin.from('fms_processes').select('code,live_from').eq('active', true);
  if (error) throw error;
  const result = {};
  for (const flow of processes) {
    // A failed sync still lets alerts go out for what is already known.
    const sync = await syncFmsFeed(admin, flow, now).catch((syncError) => {
      console.error('FMS sync failed.', { process: flow.code, message: syncError?.message });
      return { failed: true };
    });
    const alerts = await sendFmsAlerts(admin, getTransport(), flow, now);
    result[flow.code] = { ...sync, alerts };
  }
  return result;
}

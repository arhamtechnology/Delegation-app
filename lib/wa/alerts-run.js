import { createSupabaseAdminClient } from '../supabase-server';
import { dueToIso, loadAssignees, openStatusFilter } from './common';
import { getDailyReport } from './reads';
import { formatChecklistDueAt, getChecklistBusinessDate } from '../checklist-time';
import { getUnifiedWorkItemStatus } from '../work-summary.mjs';
import { getTransport } from './transport';
import { assignedLookbackMs, buildAlertMessages, buildHourlyDigest, directorRoles, dueSummaryDate, hourlyAnchor, isHourlyReminderWindow, planChecklistAlerts, planChecklistItemAlerts, planTaskAlerts, reminderLookaheadMs, reminderLookbackMs } from './alerts.mjs';

const alertTaskSelect = 'id,title,description,eta,created_at,created_by,assigned_by_name,assigned_by_chat_id,assignee:employees!tasks_assignee_id_fkey(name)';

const alertTemplateSelect = 'id,task,frequency,weekday,day_of_month,monthly_days,start_date,due_time,created_at,created_by,assigned_by_name,assigned_by_chat_id,employee:employees!checklist_templates_employee_id_fkey(name)';
const alertChecklistItemSelect = 'id,task,due_at,status,completed_at,employee_id,template:checklist_templates!checklist_items_template_id_fkey(created_by,assigned_by_name,assigned_by_chat_id),employee:employees!checklist_items_employee_id_fkey(name)';

async function send(admin, transport, chatId, text) {
  await transport.sendText(chatId, text);
  // Logged like chat replies, so a director answering an alert gives the assistant its context.
  const { error } = await admin.from('wa_messages').insert({ chat_id: chatId, sender: 'bot', direction: 'out', body: text });
  if (error) console.error('WhatsApp alert log failed.', { code: error.code, message: error.message });
}

// Directors by login, named the way they are known on WhatsApp (a linked number's display name wins).
async function loadDirectors(admin) {
  const [employees, links] = await Promise.all([
    admin.from('employees').select('id,name,role,auth_user_id,whatsapp_chat_id').in('role', [...directorRoles]).not('auth_user_id', 'is', null),
    admin.from('wa_chat_links').select('chat_id,display_name'),
  ]);
  if (employees.error) throw employees.error;
  if (links.error) throw links.error;
  const linkNames = new Map((links.data || []).map((link) => [link.chat_id, link.display_name]));
  const linkChats = new Map((links.data || []).map((link) => [link.employee_id, link.chat_id]));
  return new Map((employees.data || []).map((employee) => [employee.auth_user_id, {
    name: linkNames.get(employee.whatsapp_chat_id) || employee.name,
    chatId: linkChats.get(employee.id) || employee.whatsapp_chat_id || null,
  }]));
}

async function loadAlertTasks(admin, now) {
  const nowMs = now.getTime();
  const open = (query) => query.not('status', 'in', openStatusFilter);
  const [byEta, byCreation] = await Promise.all([
    open(admin.from('tasks').select(alertTaskSelect).gte('eta', new Date(nowMs - reminderLookbackMs).toISOString()).lte('eta', new Date(nowMs + reminderLookaheadMs).toISOString())).limit(500),
    open(admin.from('tasks').select(alertTaskSelect).gte('created_at', new Date(nowMs - assignedLookbackMs).toISOString())).limit(500),
  ]);
  if (byEta.error) throw byEta.error;
  if (byCreation.error) throw byCreation.error;
  return [...new Map([...byEta.data, ...byCreation.data].map((task) => [task.id, task])).values()];
}

async function loadAlertChecklistItems(admin, now) {
  const { data, error } = await admin
    .from('checklist_items')
    .select(alertChecklistItemSelect)
    .neq('status', 'completed')
    .neq('status', 'deactivated')
    .is('completed_at', null)
    .gte('due_at', new Date(now.getTime() - reminderLookbackMs).toISOString())
    .lte('due_at', new Date(now.getTime() + reminderLookaheadMs).toISOString())
    .limit(500);
  if (error) throw error;
  return data || [];
}

// Only a director's login makes work director-assigned; the WhatsApp number says which director.
function assignedBy(record, directors) {
  const creator = directors.get(record.created_by);
  return creator ? { name: record.assigned_by_name || creator.name, chatId: record.assigned_by_chat_id || creator.chatId } : null;
}

// Claim before sending: overlapping runs each get only the alerts they inserted.
async function claimTaskAlerts(admin, planned) {
  if (!planned.length) return [];
  const { data: claimed, error } = await admin
    .from('wa_task_alerts')
    .upsert(planned.map((alert) => ({ task_id: alert.taskId, stage: alert.stage, anchor: alert.anchor })), { onConflict: 'task_id,stage,anchor', ignoreDuplicates: true })
    .select('task_id,stage,anchor');
  if (error) throw error;
  const claimedKeys = new Set((claimed || []).map((row) => `${row.task_id}|${row.stage}|${Date.parse(row.anchor)}`));
  return planned.filter((alert) => claimedKeys.has(`${alert.taskId}|${alert.stage}|${Date.parse(alert.anchor)}`));
}

async function claimChecklistAlerts(admin, planned) {
  if (!planned.length) return [];
  const { data: claimed, error } = await admin
    .from('wa_checklist_alerts')
    .upsert(planned.map((alert) => ({ template_id: alert.templateId })), { onConflict: 'template_id', ignoreDuplicates: true })
    .select('template_id');
  if (error) throw error;
  const claimedIds = new Set((claimed || []).map((row) => row.template_id));
  return planned.filter((alert) => claimedIds.has(alert.templateId));
}

async function claimChecklistItemAlerts(admin, planned) {
  if (!planned.length) return [];
  const { data: claimed, error } = await admin
    .from('wa_checklist_item_alerts')
    .upsert(planned.map((alert) => ({ checklist_item_id: alert.itemId, stage: alert.stage, anchor: alert.anchor })), { onConflict: 'checklist_item_id,stage,anchor', ignoreDuplicates: true })
    .select('checklist_item_id,stage,anchor');
  if (error) throw error;
  const claimedKeys = new Set((claimed || []).map((row) => `${row.checklist_item_id}|${row.stage}|${Date.parse(row.anchor)}`));
  return planned.filter((alert) => claimedKeys.has(`${alert.itemId}|${alert.stage}|${Date.parse(alert.anchor)}`));
}

// Recurring checklist tasks added in the last half hour. A failure here (say, before the migration
// is applied) is logged and skipped so task alerts still go out.
async function loadChecklistAlerts(admin, directors, now) {
  try {
    const { data, error } = await admin.from('checklist_templates').select(alertTemplateSelect).eq('active', true)
      .gte('created_at', new Date(now.getTime() - assignedLookbackMs).toISOString()).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const planned = planChecklistAlerts(data.map((template) => ({ ...template, assigneeName: template.employee?.name || 'Unassigned', director: assignedBy(template, directors) })), now);
    return await claimChecklistAlerts(admin, planned);
  } catch (error) {
    console.error('WhatsApp checklist alerts skipped.', { code: error?.code, message: error?.message });
    return [];
  }
}

async function sendTaskAlerts(admin, transport, now) {
  const [tasks, checklistItems, directors, eas] = await Promise.all([
    loadAlertTasks(admin, now),
    loadAlertChecklistItems(admin, now),
    loadDirectors(admin),
    admin.from('employees').select('whatsapp_chat_id').eq('role', 'ea').eq('active', true).not('whatsapp_chat_id', 'is', null),
  ]);
  if (eas.error) throw eas.error;
  const eaChatIds = eas.data.map((employee) => employee.whatsapp_chat_id);

  const planned = planTaskAlerts(tasks.map((task) => ({ ...task, assigneeName: task.assignee?.name || 'Unassigned', director: assignedBy(task, directors) })), now);
  const plannedChecklistItems = planChecklistItemAlerts(checklistItems.map((item) => ({
    ...item,
    employeeName: item.employee?.name || 'Unassigned',
    director: item.template ? assignedBy(item.template, directors) : null,
  })), now);

  const alerts = [
    ...await claimTaskAlerts(admin, planned),
    ...await claimChecklistItemAlerts(admin, plannedChecklistItems),
    ...await loadChecklistAlerts(admin, directors, now),
  ];
  if (!alerts.length) return 0;

  let sent = 0;
  for (const message of buildAlertMessages(alerts, eaChatIds)) {
    try {
      await send(admin, transport, message.chatId, message.text);
      sent += 1;
    } catch (sendError) {
      console.error('WhatsApp task alert send failed.', { message: sendError?.message });
    }
  }
  return sent;
}

const hourlyTaskSelect = 'title,eta,status,completed_at,assignee:employees!tasks_assignee_id_fkey(name)';
const hourlyChecklistSelect = 'task,status,due_date,due_at,completed_at,employee:employees!checklist_items_employee_id_fkey(name)';

// Every open task and checklist item due today, grouped person by person, to each director and EA once an hour.
async function sendHourlyDigest(admin, transport, now) {
  if (!isHourlyReminderWindow(now)) return 0;
  // One login can serve several directors, each with their own linked number, so every link counts.
  const [directors, links, eas] = await Promise.all([
    admin.from('employees').select('id,whatsapp_chat_id').in('role', [...directorRoles]),
    admin.from('wa_chat_links').select('chat_id,employee_id'),
    admin.from('employees').select('whatsapp_chat_id').eq('role', 'ea').eq('active', true).not('whatsapp_chat_id', 'is', null),
  ]);
  for (const result of [directors, links, eas]) if (result.error) throw result.error;
  const directorIds = new Set(directors.data.map((employee) => employee.id));
  const recipients = [...new Set([
    ...directors.data.map((employee) => employee.whatsapp_chat_id),
    ...links.data.filter((link) => directorIds.has(link.employee_id)).map((link) => link.chat_id),
    ...eas.data.map((employee) => employee.whatsapp_chat_id),
  ].filter(Boolean))];
  if (!recipients.length) return 0;

  const anchor = hourlyAnchor(now);
  const { data: claimed, error } = await admin
    .from('wa_hourly_digests')
    .upsert(recipients.map((chatId) => ({ chat_id: chatId, hour_anchor: anchor })), { onConflict: 'chat_id,hour_anchor', ignoreDuplicates: true })
    .select('chat_id');
  if (error) throw error;
  if (!claimed?.length) return 0;

  const release = () => admin.from('wa_hourly_digests').delete().eq('hour_anchor', anchor).in('chat_id', claimed.map((row) => row.chat_id));
  let messages;
  try {
    // Today's work only (India day); older overdue work is left out of the hourly report.
    const today = getChecklistBusinessDate(now);
    const start = dueToIso(today, '00:00');
    const end = new Date(Date.parse(start) + 86400000).toISOString();
    const [tasks, checklist] = await Promise.all([
      admin.from('tasks').select(hourlyTaskSelect).not('status', 'in', openStatusFilter).is('completed_at', null).gte('eta', start).lt('eta', end).order('eta').limit(1000),
      admin.from('checklist_items').select(hourlyChecklistSelect).eq('due_date', today).neq('status', 'deactivated').neq('status', 'completed').is('completed_at', null).order('due_at').limit(1000),
    ]);
    if (tasks.error) throw tasks.error;
    if (checklist.error) throw checklist.error;
    messages = buildHourlyDigest([
      ...tasks.data.map((task) => ({ person: task.assignee?.name || 'Unassigned', title: task.title, due: formatChecklistDueAt(task.eta), overdue: getUnifiedWorkItemStatus(task, now, 'task') === 'overdue', checklist: false })),
      ...checklist.data.map((item) => ({ person: item.employee?.name || 'Unassigned', title: item.task, due: item.due_at ? formatChecklistDueAt(item.due_at) : item.due_date, overdue: getUnifiedWorkItemStatus({ ...item, kind: 'checklist' }, now, 'checklist') === 'overdue', checklist: true })),
    ], now);
  } catch (loadError) {
    await release();
    throw loadError;
  }
  if (!messages.length) return 0;

  let sent = 0;
  for (const chatId of claimed.map((row) => row.chat_id)) {
    let delivered = 0;
    try {
      for (const text of messages) {
        await send(admin, transport, chatId, text);
        delivered += 1;
      }
      sent += 1;
    } catch (sendError) {
      console.error('WhatsApp hourly report send failed.', { delivered, of: messages.length, message: sendError?.message });
      // Nothing reached them: release the claim so the next minute's run tries again.
      if (!delivered) await admin.from('wa_hourly_digests').delete().eq('hour_anchor', anchor).eq('chat_id', chatId);
    }
  }
  return sent;
}

async function sendDailySummaries(admin, transport, now) {
  const date = dueSummaryDate(now);
  if (!date) return 0;
  const { data: recipients, error } = await admin.from('wa_chat_links').select('chat_id').eq('daily_summary', true);
  if (error) throw error;
  if (!recipients?.length) return 0;
  const { data: claimed, error: claimError } = await admin
    .from('wa_daily_summaries')
    .upsert(recipients.map((recipient) => ({ summary_date: date, chat_id: recipient.chat_id })), { onConflict: 'summary_date,chat_id', ignoreDuplicates: true })
    .select('chat_id');
  if (claimError) throw claimError;
  if (!claimed?.length) return 0;

  let messages;
  try {
    messages = await getDailyReport(admin, await loadAssignees(admin), now);
  } catch (reportError) {
    // Release every claim so the next minute's run builds the report again.
    await admin.from('wa_daily_summaries').delete().eq('summary_date', date).in('chat_id', claimed.map((row) => row.chat_id));
    throw reportError;
  }
  let sent = 0;
  for (const { chat_id: chatId } of claimed) {
    let delivered = 0;
    try {
      for (const text of messages) {
        await send(admin, transport, chatId, text);
        delivered += 1;
      }
      sent += 1;
    } catch (sendError) {
      console.error('WhatsApp daily report send failed.', { delivered, of: messages.length, message: sendError?.message });
      // Nothing reached them: release the claim so the next minute's run tries again. A partly sent
      // report is not resent, so the director never gets the first parts twice.
      if (!delivered) await admin.from('wa_daily_summaries').delete().eq('summary_date', date).eq('chat_id', chatId);
    }
  }
  return sent;
}

/** One scheduler tick (every minute): task and checklist assignment notices, ETA reminders, and the 6 PM report. */
export async function runWhatsAppAlerts(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const transport = getTransport();
  const alerts = await sendTaskAlerts(admin, transport, now);
  const summaries = await sendDailySummaries(admin, transport, now);
  // A failure here (say, before the migration is applied) must not stop the alerts above.
  const hourly = await sendHourlyDigest(admin, transport, now).catch((error) => {
    console.error('WhatsApp hourly report failed.', { code: error?.code, message: error?.message });
    return 0;
  });
  return { alerts, summaries, hourly };
}

import { getWorkspaceDate, localDateTimeToIso } from '../../lib/business-time';
import { isChecklistDueOnDate } from './checklist-time';
import { isSunday, reconcileOpenChecklistItemsForNonWorkingDays } from './checklist-non-working-day';

const timeZone = process.env.CHECKLIST_TIMEZONE || 'Asia/Kolkata';

export async function generateChecklistItems(admin) {
  const today = getWorkspaceDate(new Date(), timeZone);
  const { data: templates, error: templateError } = await admin
    .from('checklist_templates')
    .select('id,employee_id,task,frequency,weekday,day_of_month,monthly_days,start_date,due_time')
    .eq('active', true);
  if (templateError) throw templateError;

  const dueTemplates = (templates || []).filter((template) => isChecklistDueOnDate(template, today));
  const rows = dueTemplates.map((template) => ({
    template_id: template.id,
    employee_id: template.employee_id,
    task: template.task,
    due_date: today,
    due_at: localDateTimeToIso(today, template.due_time, timeZone),
    status: isSunday(today) ? 'deactivated' : 'pending',
  }));

  let created = 0;
  if (rows.length) {
    const { data, error } = await admin
      .from('checklist_items')
      .upsert(rows, { onConflict: 'template_id,due_date', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    created = data?.length || 0;
  }

  const reconciliation = await reconcileOpenChecklistItemsForNonWorkingDays(admin);

  return {
    date: today,
    scanned: templates?.length || 0,
    due: rows.length,
    created,
    skipped: Math.max(rows.length - created, 0),
    deactivatedNonWorkingDayItems: reconciliation.deactivated,
    markedOverdue: reconciliation.markedOverdue,
  };
}

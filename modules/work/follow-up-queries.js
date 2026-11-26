import { workspaceTimeZone } from '../../lib/business-time';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { getChecklistItems } from '../checklists/checklist-queries';
import { getTasks } from '../tasks/task-data';
import { addFollowUpMetadata } from '../work-model/follow-up-tasks.mjs';
import { dedupeWorkItems, getWorkItemStatus, sortWorkItemsChronologically, toChecklistWorkItem, toTaskWorkItem } from '../work-model/work-items.mjs';
import { getWorkQueryError } from '../work-model/work-list.mjs';
import { fromWorkListRow, workListSelect } from './work-list-query';

async function loadEveryPage(loadPage, pageSize) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await loadPage(offset);
    if (response.error) return { data: [], error: response.error };
    rows.push(...(response.data || []));
    if ((response.data || []).length < pageSize) return { data: rows, error: null };
  }
}

async function getActiveHolidayDates(pageSize = 1000, client) {
  return loadEveryPage((offset) => (client || supabaseBrowser())
    .from('national_holidays')
    .select('holiday_date')
    .eq('country', 'India')
    .eq('is_active', true)
    .order('holiday_date', { ascending: true })
    .range(offset, offset + pageSize - 1), pageSize);
}

async function getLegacyFollowUpItems({ employeeId, pageSize, now, client }) {
  const [taskResponse, checklistResponse, holidayResponse] = await Promise.all([
    loadEveryPage((offset) => getTasks({ limit: pageSize, offset, assigneeId: employeeId, nowIso: now.toISOString(), client }), pageSize),
    loadEveryPage((offset) => getChecklistItems({ limit: pageSize, offset, employeeId, includeDeactivated: true, nowIso: now.toISOString(), client }), pageSize),
    getActiveHolidayDates(pageSize, client),
  ]);
  const error = taskResponse.error || checklistResponse.error || holidayResponse.error;
  if (error) return { data: [], error };
  const items = dedupeWorkItems([
    ...(taskResponse.data || []).map(toTaskWorkItem),
    ...(checklistResponse.data || []).map(toChecklistWorkItem),
  ]);
  return { data: scheduleFollowUps(items, holidayResponse.data, now), error: null };
}

function scheduleFollowUps(items, holidays, now) {
  const holidayDates = new Set((holidays || []).map((holiday) => holiday.holiday_date));
  const followUps = items.map((item) => addFollowUpMetadata(item, holidayDates, workspaceTimeZone))
    .filter((item) => item.isFollowUp && getWorkItemStatus(item, now) !== 'deactivated');
  return sortWorkItemsChronologically(followUps, now);
}

const missingFollowUpView = /follow_up_work_items/i;

// Follow-up work in one request: the follow_up_work_items view (migration 20261027150000)
// returns only Sunday/holiday work; this adds the carried-over dates. Falls back to the
// full scan while that migration is not applied yet.
export async function getFollowUpWorkItems({ employeeId, client, now = new Date() } = {}) {
  const supabase = client || supabaseBrowser();
  const pageSize = 1000;
  const [workResponse, holidayResponse] = await Promise.all([
    loadEveryPage((offset) => {
      let query = supabase.from('follow_up_work_items').select(workListSelect)
        .order('scheduled_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (employeeId) query = query.eq('employee_id', employeeId);
      return query;
    }, pageSize),
    getActiveHolidayDates(pageSize, supabase),
  ]);
  if (workResponse.error && missingFollowUpView.test(workResponse.error.message || '')) {
    return getLegacyFollowUpItems({ employeeId, pageSize, now, client });
  }
  const error = workResponse.error || holidayResponse.error;
  if (error) return { data: [], error: getWorkQueryError(error) };
  const items = (workResponse.data || []).map(fromWorkListRow);
  return { data: scheduleFollowUps(items, holidayResponse.data, now), error: null };
}

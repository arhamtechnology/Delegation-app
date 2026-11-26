import { canManageWork } from '../identity/roles.mjs';
import { getActiveEmployees } from '../identity/employee-directory';
import { getWorkspaceDate, workspaceTimeZone } from '../../lib/business-time';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { addFollowUpMetadata } from '../work-model/follow-up-tasks.mjs';
import { compareWorkItemsChronologically, getTaskDueDateTime, getWorkItemStatus } from '../work-model/work-items.mjs';
import { getWorkItemsPage } from './work-list-query';
import { getFmsWorkItems } from './fms-work';
import { getWorkSummary } from '../work-model/work-summary.mjs';
import { getWorkReport } from './work-report';

export async function loadDashboardData({ employee, client, signal } = {}) {
  const employeeRequest = canManageWork(employee.role) ? getActiveEmployees({ client }) : Promise.resolve({ data: [employee], error: null });
  const [workResponse, employeeResponse] = await Promise.all([getUnifiedDashboardData({ signal, client, employee }), employeeRequest]);
  if (workResponse.error) return { data: null, error: workResponse.error };
  if (employeeResponse.error) return { data: null, error: employeeResponse.error };
  return {
    data: {
      employeeId: employee.id,
      name: employee.name,
      role: employee.role,
      employees: employeeResponse.data || [],
      metrics: workResponse.data?.metrics || {},
      todayItems: workResponse.data?.todayItems || [],
    },
    error: null,
  };
}

const todayStatusPriority = { overdue: 0, pending: 1, completed: 2 };

function getEffectiveTodayStatus(workItem, now = new Date()) {
  const status = getWorkItemStatus(workItem, now);
  return status === 'completed' ? 'completed' : status === 'overdue' ? 'overdue' : 'pending';
}

function sortTodaysWorkItems(workItems, now = new Date()) {
  return [...(workItems || [])].sort((left, right) => {
    const statusDifference = todayStatusPriority[getEffectiveTodayStatus(left, now)] - todayStatusPriority[getEffectiveTodayStatus(right, now)];
    return statusDifference || compareWorkItemsChronologically(left, right, now);
  });
}

// The dashboard is today's view: everything due today, in every status, plus today's totals.
// Tasks still open from other days stay on it until they are closed, so assigned work is never hidden.
async function getUnifiedDashboardData({ now = new Date(), signal, client, employee } = {}) {
  const today = getWorkspaceDate(now, workspaceTimeZone);
  const [reportResponse, todayResponse, openTaskResponse, holidayDates, fmsItems] = await Promise.all([
    getWorkReport({ from: today, to: today, signal, client }),
    getWorkItemsPage({ dueDate: today, pageSize: 100, includeCount: false, signal, client }),
    getWorkItemsPage({ workType: 'task', openOnly: true, pageSize: 100, includeCount: false, signal, client }),
    getTodayHolidayDates(today, { signal, client }),
    // FMS steps show on the doer's own dashboard; directors and EAs follow them on the FMS page.
    employee && !canManageWork(employee.role) ? getFmsWorkItems({ employeeId: employee.id, today, client, signal }) : [],
  ]);
  const error = reportResponse.error || todayResponse.error || openTaskResponse.error || holidayDates.error;
  if (error) return { data: null, error };
  // Today's tasks are already in todayResponse (with follow-ups removed); add only other days.
  const otherOpenTasks = openTaskResponse.data.filter((task) => getWorkItemScheduledDate(task) !== today);
  return {
    data: {
      metrics: withFms(reportResponse.data.summary, fmsItems, now),
      todayItems: sortTodaysWorkItems([...withoutFollowUps(todayResponse.data, holidayDates.data), ...otherOpenTasks, ...fmsItems], now),
    },
    error: null,
  };
}

function withFms(metrics, fmsItems, now) {
  if (!fmsItems.length) return metrics;
  const fms = getWorkSummary(fmsItems, now);
  return { ...metrics, total: metrics.total + fms.total, pending: metrics.pending + fms.pending, overdue: metrics.overdue + fms.overdue, completed: metrics.completed + fms.completed };
}

async function getTodayHolidayDates(today, { signal, client }) {
  let query = (client || supabaseBrowser())
    .from('national_holidays')
    .select('holiday_date')
    .eq('country', 'India')
    .eq('is_active', true)
    .eq('holiday_date', today);
  if (signal) query = query.abortSignal(signal);
  const response = await query;
  return { data: new Set((response.data || []).map((holiday) => holiday.holiday_date)), error: response.error };
}

function withoutFollowUps(workItems, holidayDates) {
  return (workItems || []).map((workItem) => addFollowUpMetadata(workItem, holidayDates, workspaceTimeZone)).filter((workItem) => !workItem.isFollowUp);
}

function getWorkItemScheduledDate(workItem, timeZone = workspaceTimeZone) {
  if (workItem?.originalScheduledDate) return workItem.originalScheduledDate;
  if (workItem?.kind === 'checklist') return workItem.due_date || null;
  const dueDate = getTaskDueDateTime(workItem);
  return dueDate ? getWorkspaceDate(dueDate, timeZone) : null;
}

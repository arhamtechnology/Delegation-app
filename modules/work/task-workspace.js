import { canManageWork } from '../identity/roles.mjs';
import { getActiveEmployees } from '../identity/employee-directory';
import { getFollowUpWorkItems } from './follow-up-queries';
import { getWorkItemsPage } from './work-list-query';
import { getWorkReport } from './work-report';
import { getWorkItemStatus } from '../work-model/work-items.mjs';
import { WORK_PAGE_SIZE } from '../work-model/work-list.mjs';

export const workStatuses = ['pending', 'overdue', 'completed'];
const workTypes = ['task', 'checklist'];
const workPriorities = ['critical', 'high', 'normal'];

export function isValidDateFilter(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

// Same parsing for the server's searchParams and the browser's location.search.
export function parseTaskFilters(params) {
  const get = (key) => {
    const value = typeof params?.get === 'function' ? params.get(key) : params?.[key];
    return (Array.isArray(value) ? value[0] : value) || null;
  };
  return {
    employee: get('employee') || 'all',
    workType: workTypes.includes(get('workType')) ? get('workType') : 'all',
    status: workStatuses.includes(get('status')) ? get('status') : 'all',
    priority: workPriorities.includes(get('priority')) ? get('priority') : 'all',
    followUp: get('followUp') === '1' ? 'follow-up' : 'all',
    date: isValidDateFilter(get('date')) ? get('date') : '',
  };
}

export function getTaskListKey(employeeId, { page = 0, search = '', employee, workType, status, priority, date, followUp = 'all' }) {
  return [employeeId, [page, search, employee, workType, status, priority, date, followUp].join('|')];
}

// Follow-ups come from their own read model, then get the same filters and paging as the main list.
async function loadFollowUpTasksPage({ selectedEmployeeId, filters, page, pageSize = WORK_PAGE_SIZE, search, client }) {
  const response = await getFollowUpWorkItems({ employeeId: selectedEmployeeId || undefined, client });
  if (response.error) return { data: null, error: response.error };
  const query = search.trim().toLowerCase();
  const matches = (response.data || []).filter((workItem) => {
    const searchable = [workItem.title, workItem.category, workItem.assignee?.name, workItem.assignee?.email].filter(Boolean).join(' ').toLowerCase();
    return (filters.workType === 'all' || workItem.kind === filters.workType)
      && (filters.status === 'all' || getWorkItemStatus(workItem) === filters.status)
      && (filters.priority === 'all' || workItem.priority === filters.priority)
      && (!filters.date || workItem.originalScheduledDate === filters.date)
      && (!query || searchable.includes(query));
  });
  const summary = { total: matches.length, pending: 0, overdue: 0, completed: 0 };
  matches.forEach((workItem) => { const status = getWorkItemStatus(workItem); if (summary[status] !== undefined) summary[status] += 1; });
  return { data: { workItems: matches.slice(page * pageSize, (page + 1) * pageSize), total: matches.length, summary }, error: null };
}

export async function loadTasksWorkspace({ employee, client }) {
  const manager = canManageWork(employee.role);
  const employeeResponse = manager ? await getActiveEmployees({ client }) : { data: [employee], error: null };
  if (employeeResponse.error) return { data: null, error: employeeResponse.error };
  return { data: { role: employee.role, employeeId: employee.id, employees: employeeResponse.data || [] }, error: null };
}

// Each status section (overdue / pending / completed) pages on its own.
export const SECTION_PAGE_SIZE = 20;
export const taskSectionStatuses = ['overdue', 'pending', 'completed'];

export async function loadTasksPage({ role, employeeId, filters, page = 0, pageSize = WORK_PAGE_SIZE, withSummary = true, search = '', client, signal }) {
  const manager = canManageWork(role);
  const selectedEmployeeId = filters.employee === 'all' ? (!manager ? employeeId : null) : filters.employee;
  if (filters.followUp === 'follow-up') return loadFollowUpTasksPage({ selectedEmployeeId, filters, page, pageSize, search, client });
  const [workResponse, summaryResponse] = await Promise.all([
    getWorkItemsPage({ page, pageSize, search, employeeId: selectedEmployeeId, workType: filters.workType, status: filters.status, priority: filters.priority, dueDate: filters.date, includeCount: true, signal, client }),
    withSummary ? getWorkReport({ workType: filters.workType, status: filters.status, priority: filters.priority, employeeId: selectedEmployeeId, from: filters.date, to: filters.date, search, signal, client }) : Promise.resolve({ data: null, error: null }),
  ]);
  const error = workResponse.error || summaryResponse.error;
  if (error) return { data: null, error };
  const hasCount = workResponse.count !== null && workResponse.count !== undefined;
  return { data: { workItems: workResponse.data || [], total: hasCount ? workResponse.count : undefined, summary: summaryResponse.data?.summary }, error: null };
}

export async function loadTasksData({ employee, client, filters }) {
  const statuses = filters.status === 'all' ? taskSectionStatuses : [filters.status];
  const [workspace, ...lists] = await Promise.all([
    loadTasksWorkspace({ employee, client }),
    ...statuses.map((status) => loadTasksPage({ role: employee.role, employeeId: employee.id, filters: { ...filters, status }, pageSize: SECTION_PAGE_SIZE, withSummary: false, client })),
  ]);
  if (workspace.error) return workspace;
  const failed = lists.find((list) => list.error);
  if (failed) return failed;
  const sections = Object.fromEntries(statuses.map((status, index) => [status, { workItems: lists[index].data.workItems, total: lists[index].data.total ?? lists[index].data.workItems.length }]));
  return { data: { workspace: workspace.data, sections, filters }, error: null };
}

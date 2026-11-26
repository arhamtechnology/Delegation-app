import { supabaseBrowser } from '../../lib/supabase-browser';
import { workspaceTimeZone, getWorkspaceDate, getNextBusinessDate } from '../../lib/business-time';
import { getUnifiedWorkItemStatus } from '../work-model/work-summary.mjs';
import { getTaskDueDateTime, hasTaskDueTime } from '../work-model/work-items.mjs';
import { getTaskAssignee, isEligibleTaskAssignee } from '../identity/employee-directory';

const taskListSelect = 'id,title,description,priority,status,eta,start_date,category,assignee_id,completed_at,created_at,assignee:employees!tasks_assignee_id_fkey(name)';
const taskDetailSelect = 'id,title,description,priority,status,eta,start_date,category,instructions,proof_required,completion_notes,attachments,assignee_id,assigned_by_name,completed_at,created_at,updated_at,assignee:employees!tasks_assignee_id_fkey(name)';

function dateInputToIso(value, endOfDay = false) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateTimeInputToIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const date = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function applyTaskFilters(query, { assigneeId, priority, status, etaFrom, etaTo, nowIso = new Date().toISOString() } = {}) {
  if (assigneeId) query = query.eq('assignee_id', assigneeId);
  if (priority && priority !== 'all') query = query.eq('priority', priority);
  if (etaFrom) query = query.gte('eta', etaFrom);
  if (etaTo) query = query.lt('eta', etaTo);
  if (status === 'completed') query = completedTaskQuery(query);
  if (status === 'overdue') query = activeTaskQuery(query).lt('eta', nowIso);
  if (status === 'pending') query = activeTaskQuery(query).gte('eta', nowIso);
  return query;
}

function buildTaskListQuery(supabase, { limit, offset = 0, select, ...filters }) {
  let query = applyTaskFilters(supabase.from('tasks').select(select), filters);
  return query.order('updated_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1);
}

export async function getTasks({ limit = 100, offset = 0, select = taskListSelect, client, ...filters } = {}) {
  const supabase = client || supabaseBrowser();
  const response = await buildTaskListQuery(supabase, { limit, offset, select, ...filters });
  if (response.error && response.error.message?.includes('updated_at')) {
    let fallback = applyTaskFilters(supabase.from('tasks').select(select), filters);
    return fallback.order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1);
  }
  return response;
}

function activeTaskQuery(query) {
  return query.neq('status', 'closed').neq('status', 'not_required').is('completed_at', null);
}

function completedTaskQuery(query) {
  return query.or('status.in.(closed,not_required),completed_at.not.is.null');
}

function localDateNumber(value) {
  if (!value) return null;
  const stringValue = String(value);
  const dateOnly = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function getTaskStatus(task, now = new Date()) {
  return getUnifiedWorkItemStatus(task, now, 'task');
}

export { getTaskDueDateTime, hasTaskDueTime };

const businessDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: workspaceTimeZone, month: 'short', day: 'numeric' });
const businessDateYearFormat = new Intl.DateTimeFormat('en-US', { timeZone: workspaceTimeZone, month: 'short', day: 'numeric', year: 'numeric' });
const businessTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: workspaceTimeZone, hour: 'numeric', minute: '2-digit' });

// Formatted in the workspace time zone so server-rendered and browser-rendered labels always agree.
export function formatTaskDeadline(task, { relative = false, includeYear = false, now = new Date() } = {}) {
  const dueDate = getTaskDueDateTime(task);
  if (!dueDate) return 'No due date';
  const dueDay = getWorkspaceDate(dueDate, workspaceTimeZone);
  const today = getWorkspaceDate(now, workspaceTimeZone);
  const dateLabel = relative && dueDay === today
    ? 'Due today'
    : relative && dueDay === getNextBusinessDate(today)
      ? 'Due tomorrow'
      : `${relative ? 'Due ' : ''}${(includeYear ? businessDateYearFormat : businessDateFormat).format(dueDate)}`;
  if (!hasTaskDueTime(task)) return `${dateLabel} - time not specified`;
  return `${dateLabel} at ${businessTimeFormat.format(dueDate)}`;
}

export async function getTask(id, client) {
  return (client || supabaseBrowser()).from('tasks').select(taskDetailSelect).eq('id', id).single();
}

export async function createTask(payload, userId) {
  const supabase = supabaseBrowser();
  if (!payload.eta || !payload.due_time) {
    return { data: null, error: new Error('Please select a due date and due time.') };
  }
  if (!payload.assignee_id) {
    return { data: null, error: new Error('Choose an active employee who can receive delegated tasks.') };
  }
  const assigneeResponse = await getTaskAssignee(payload.assignee_id);
  if (assigneeResponse.error) return { data: null, error: assigneeResponse.error };
  if (!isEligibleTaskAssignee(assigneeResponse.data)) {
    return { data: null, error: new Error('Choose an active employee who can receive delegated tasks.') };
  }
  const eta = dateTimeInputToIso(payload.eta, payload.due_time);
  if (!eta) return { data: null, error: new Error('Please select a valid due date and due time.') };
  const record = {
    ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'due_time')),
    created_by: userId,
    status: 'pending',
    category: payload.category?.trim() || 'General',
    eta,
    start_date: dateInputToIso(payload.start_date),
    instructions: payload.instructions?.trim() || null,
    completion_notes: payload.completion_notes?.trim() || null,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  };
  const response = await supabase.from('tasks').insert(record);
  if (response.error && /category|instructions|start_date|completion_notes|attachments/i.test(response.error.message || '')) {
    const fallback = { ...record };
    delete fallback.category;
    delete fallback.instructions;
    delete fallback.start_date;
    delete fallback.completion_notes;
    delete fallback.attachments;
    return supabase.from('tasks').insert(fallback);
  }
  return response;
}

// Anyone can complete the tasks assigned to them; delegating managers use the task page.
export function canCompleteTask(employeeId, assigneeId) {
  return Boolean(employeeId) && employeeId === assigneeId;
}

export async function setTaskCompletion(id, completed) {
  const now = new Date().toISOString();
  const fields = completed
    ? { status: 'closed', completed_at: now, updated_at: now }
    : { status: 'pending', completed_at: null, updated_at: now };
  return supabaseBrowser().from('tasks').update(fields).eq('id', id);
}

export function taskIsOverdue(task) {
  return getTaskStatus(task) === 'overdue';
}

export function taskIsDueSoon(task) {
  if (getTaskStatus(task) !== 'pending' || !task.eta) return false;
  const due = localDateNumber(task.eta);
  const today = localDateNumber(new Date());
  if (due === null || today === null) return false;
  const dueDate = new Date(Math.floor(due / 10000), Math.floor((due % 10000) / 100) - 1, due % 100);
  const todayDate = new Date(Math.floor(today / 10000), Math.floor((today % 10000) / 100) - 1, today % 100);
  return dueDate.getTime() >= todayDate.getTime() && dueDate.getTime() - todayDate.getTime() <= 48 * 60 * 60 * 1000;
}

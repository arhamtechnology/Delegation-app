import { supabaseBrowser } from '../../lib/supabase-browser';
import { sortWorkItemsChronologically, toChecklistWorkItem, toTaskWorkItem } from '../work-model/work-items.mjs';
import { getWorkQueryError, normalizeWorkListRequest } from '../work-model/work-list.mjs';

export const workListSelect = 'id,kind,title,description,priority,category,employee_id,employee_name,employee_email,eta,due_date,due_at,source_status,completed_at,created_at,template_id,checklist_frequency,assigned_by_name';

export function fromWorkListRow(row) {
  const employee = row.employee_id ? { id: row.employee_id, name: row.employee_name, email: row.employee_email } : null;
  if (row.kind === 'checklist') {
    return toChecklistWorkItem({
      id: row.id,
      template_id: row.template_id,
      employee_id: row.employee_id,
      task: row.title,
      due_date: row.due_date,
      due_at: row.due_at,
      status: row.source_status,
      completed_at: row.completed_at,
      created_at: row.created_at,
      assigned_by_name: row.assigned_by_name,
      employee,
      template: row.checklist_frequency ? { frequency: row.checklist_frequency } : null,
    });
  }
  return toTaskWorkItem({
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    category: row.category,
    assignee_id: row.employee_id,
    eta: row.eta,
    status: row.source_status,
    completed_at: row.completed_at,
    created_at: row.created_at,
    assigned_by_name: row.assigned_by_name,
    assignee: employee,
  });
}

export async function getWorkItemsPage(input = {}) {
  const request = normalizeWorkListRequest(input);
  const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
  let query = (input.client || supabaseBrowser())
    .from('work_items')
    .select(workListSelect, request.includeCount ? { count: 'exact' } : {})
    .order('sort_group', { ascending: true })
    .order('sort_key', { ascending: true })
    .order('kind', { ascending: true })
    .order('title', { ascending: true })
    .order('id', { ascending: true })
    .range(request.from, request.to);

  if (request.employeeId) query = query.eq('employee_id', request.employeeId);
  if (request.workType !== 'all') query = query.eq('kind', request.workType);
  if (request.status !== 'all') query = query.eq('effective_status', request.status);
  if (input.openOnly) query = query.neq('effective_status', 'completed');
  if (request.priority !== 'all') query = query.eq('priority', request.priority);
  if (request.dueDate) query = query.eq('scheduled_date', request.dueDate);
  if (request.fromDate) query = query.gte('scheduled_date', request.fromDate);
  if (request.toDate) query = query.lte('scheduled_date', request.toDate);
  if (request.search) query = query.ilike('search_text', `%${request.search}%`);
  if (input.signal) query = query.abortSignal(input.signal);

  const response = await query;
  const durationMs = Math.round((typeof performance === 'undefined' ? Date.now() : performance.now()) - startedAt);
  if (process.env.NODE_ENV !== 'production' || durationMs >= 1500) {
    console.info('[performance] work list query', { durationMs, page: request.page, pageSize: request.pageSize, rowCount: response.data?.length || 0 });
  }
  if (response.error) return { data: [], count: response.count, error: getWorkQueryError(response.error), durationMs };
  return { data: sortWorkItemsChronologically((response.data || []).map(fromWorkListRow)), count: response.count, error: null, durationMs };
}

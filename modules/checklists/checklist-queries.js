import { supabaseBrowser } from '../../lib/supabase-browser';
import { getWorkQueryError } from '../work-model/work-list.mjs';
import { getBusinessDate } from './checklist-data';

export function getChecklistSchemaError(error) {
  const workQueryError = getWorkQueryError(error);
  if (workQueryError !== error) return workQueryError;
  if (error?.message && /(due_at|due_time|checklist_items|checklist_templates)/i.test(error.message) && /(column|relation|schema cache|does not exist)/i.test(error.message)) {
    const migration = /monthly_days/i.test(error.message) ? '006_checklist_monthly_days.sql' : '004_checklist_due_time.sql';
    return new Error(`Checklist database migration ${migration} is not applied. Apply the migration in Supabase, then retry.`);
  }
  return error;
}

export async function getChecklistTemplatesPage({ page = 0, pageSize = 40, search = '', employeeId, frequency = 'all', status = 'all', signal, includeCount = true, client } = {}) {
  const normalizedPageSize = Math.min(100, Math.max(1, Number(pageSize) || 40));
  const normalizedPage = Math.max(0, Number(page) || 0);
  let query = (client || supabaseBrowser())
    .from('checklist_template_list')
    .select('id,employee_id,task,frequency,weekday,day_of_month,monthly_days,start_date,due_time,active,created_at,updated_at,employee_name,employee_email,proof_required', includeCount ? { count: 'exact' } : {})
    .order('active', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(normalizedPage * normalizedPageSize, (normalizedPage + 1) * normalizedPageSize - 1);
  if (search.trim()) query = query.ilike('search_text', `%${search.trim().slice(0, 120)}%`);
  if (employeeId && employeeId !== 'all') query = query.eq('employee_id', employeeId);
  if (frequency && frequency !== 'all') query = query.eq('frequency', frequency);
  if (status === 'active') query = query.eq('active', true);
  if (status === 'inactive') query = query.eq('active', false);
  if (signal) query = query.abortSignal(signal);
  const response = await query;
  return response.error ? { ...response, error: getChecklistSchemaError(response.error) } : {
    ...response,
    data: (response.data || []).map(({ employee_name, employee_email, ...template }) => ({
      ...template,
      employee: { id: template.employee_id, name: employee_name, email: employee_email },
    })),
  };
}

export async function getChecklistItems({ limit = 200, offset = 0, dueDate, dueDateFrom, dueDateTo, includeDeactivated = false, employeeId, status, nowIso = new Date().toISOString(), select = 'id,template_id,employee_id,task,due_date,due_at,status,completed_at,completed_by,created_at,employee:employees!checklist_items_employee_id_fkey(id,name,email),template:checklist_templates!checklist_items_template_id_fkey(frequency,weekday,day_of_month,monthly_days,start_date,due_time)', client } = {}) {
  const businessDate = getBusinessDate(new Date(nowIso));
  let query = (client || supabaseBrowser())
    .from('checklist_items')
    .select(select)
    .order('due_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (dueDate) query = query.eq('due_date', dueDate);
  if (dueDateFrom) query = query.gte('due_date', dueDateFrom);
  if (dueDateTo) query = query.lte('due_date', dueDateTo);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (!includeDeactivated) query = query.neq('status', 'deactivated');
  if (status === 'completed') query = query.or('status.eq.completed,completed_at.not.is.null');
  if (status === 'overdue') query = query.neq('status', 'completed').is('completed_at', null).or(`due_at.lt.${nowIso},and(due_at.is.null,due_date.lt.${businessDate})`);
  if (status === 'pending') query = query.neq('status', 'completed').is('completed_at', null).or(`due_at.gte.${nowIso},and(due_at.is.null,due_date.gte.${businessDate})`);
  const response = await query;
  return response.error ? { ...response, error: getChecklistSchemaError(response.error) } : response;
}

export async function getChecklistDashboardData({ now = new Date(), client } = {}) {
  const supabase = client || supabaseBrowser();
  const nowIso = now.toISOString();
  const today = getBusinessDate(now);
  const baseCountQuery = () => supabase.from('checklist_items').select('id', { count: 'exact', head: true }).neq('status', 'deactivated');
  const totalQuery = baseCountQuery();
  const completedQuery = baseCountQuery().or('status.eq.completed,completed_at.not.is.null');
  const overdueQuery = baseCountQuery().neq('status', 'completed').is('completed_at', null).or(`due_at.lt.${nowIso},and(due_at.is.null,due_date.lt.${today})`);
  const pendingQuery = baseCountQuery().neq('status', 'completed').is('completed_at', null).or(`due_at.gte.${nowIso},and(due_at.is.null,due_date.gte.${today})`);
  const todayQuery = supabase
    .from('checklist_items')
    .select('id,template_id,employee_id,task,due_date,due_at,status,completed_at,completed_by,created_at,employee:employees!checklist_items_employee_id_fkey(id,name,email)')
    .eq('due_date', today)
    .neq('status', 'deactivated')
    .order('due_at', { ascending: true })
    .limit(500);
  const [totalResponse, completedResponse, overdueResponse, pendingResponse, todayResponse] = await Promise.all([
    totalQuery,
    completedQuery,
    overdueQuery,
    pendingQuery,
    todayQuery,
  ]);
  const responses = [totalResponse, completedResponse, overdueResponse, pendingResponse, todayResponse];
  const errorResponse = responses.find((response) => response.error);
  if (errorResponse) return { data: null, error: getChecklistSchemaError(errorResponse.error) };
  return {
    data: {
      metrics: {
        total: totalResponse.count || 0,
        completed: completedResponse.count || 0,
        overdue: overdueResponse.count || 0,
        pending: pendingResponse.count || 0,
      },
      todayItems: todayResponse.data || [],
    },
    error: null,
  };
}

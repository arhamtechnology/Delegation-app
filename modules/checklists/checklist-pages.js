import { canManageWork } from '../identity/roles.mjs';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { getChecklistDashboardData, getChecklistSchemaError, getChecklistTemplatesPage } from './checklist-queries';
import { WORK_PAGE_SIZE } from '../work-model/work-list.mjs';

const checklistDetailSelect = 'id,template_id,employee_id,task,due_date,due_at,status,completed_at,completed_by,created_at,employee:employees!checklist_items_employee_id_fkey(id,name,email),template:checklist_templates!checklist_items_template_id_fkey(id,frequency,weekday,day_of_month,monthly_days,start_date,due_time,proof_required,assigned_by_name)';

export async function loadChecklistDetail({ id, client }) {
  const supabase = client || supabaseBrowser();
  const [itemResponse, updatesResponse] = await Promise.all([
    supabase.from('checklist_items').select(checklistDetailSelect).eq('id', id).maybeSingle(),
    supabase.from('checklist_item_updates').select('id,update_type,remark,proof_url,created_at').eq('checklist_item_id', id).order('created_at', { ascending: false }),
  ]);
  const error = itemResponse.error || updatesResponse.error;
  if (error) return { data: null, error };
  return { data: { item: itemResponse.data || null, updates: updatesResponse.data || [] }, error: null };
}

export async function loadChecklistData({ employee, client, filters = {}, now = new Date() }) {
  const manager = canManageWork(employee.role);
  const supabase = client || supabaseBrowser();
  const { page = 0, search = '', employeeId = 'all', frequency = 'all', status = 'all' } = filters;
  const [templateResponse, employeeResponse, itemResponse] = await Promise.all([
    manager ? getChecklistTemplatesPage({ page, pageSize: WORK_PAGE_SIZE, search, employeeId, frequency, status, client: supabase }) : Promise.resolve({ data: [], count: 0, error: null }),
    manager ? supabase.from('employees').select('id,name,email,active,role').order('name') : Promise.resolve({ data: [], error: null }),
    getChecklistDashboardData({ now, client: supabase }),
  ]);
  const error = getChecklistSchemaError(itemResponse.error || templateResponse.error || employeeResponse.error);
  if (error) return { data: null, error };
  return {
    data: { employee, manager, items: itemResponse.data?.todayItems || [], metrics: itemResponse.data?.metrics || {}, templates: templateResponse.data || [], employees: employeeResponse.data || [], templateTotal: templateResponse.count || 0 },
    error: null,
  };
}

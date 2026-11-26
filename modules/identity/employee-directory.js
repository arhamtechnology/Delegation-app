import { supabaseBrowser } from '../../lib/supabase-browser';
import { onClearQueries } from '../../lib/query-cache';
import { canManageWork } from './roles.mjs';

export async function loadEmployeesData({ employee, client }) {
  const supabase = client || supabaseBrowser();
  const { data, error } = await supabase.from('employees').select('id,name,username,email,mobile,role,department_id,active,auth_user_id').order('name');
  if (error) return { data: null, error };
  return { data: { rows: data || [], currentRole: employee.role, currentEmployeeId: employee.id }, error: null };
}

let taskEmployeesCache = null;
let taskEmployeesRequest = null;
let taskAssigneesCache = null;
let taskAssigneesRequest = null;
const employeeListCacheTtl = 15000;

export function isEligibleTaskAssignee(employee) {
  return employee?.active === true && !canManageWork(employee.role);
}

// Server renders pass their own request-scoped client and skip the shared browser cache.
function loadTaskAssignees(supabase) {
  return supabase
    .from('employees')
    .select('id,name,email,active,role')
    .eq('active', true)
    .not('role', 'in', '("super_admin","assigner","ea")')
    .order('name')
    .then((response) => (response.error ? response : { ...response, data: (response.data || []).filter(isEligibleTaskAssignee) }));
}

export async function getTaskAssignees({ client } = {}) {
  if (client) return loadTaskAssignees(client);
  if (taskAssigneesCache && Date.now() - taskAssigneesCache.timestamp < employeeListCacheTtl) return taskAssigneesCache.response;
  if (!taskAssigneesRequest) {
    taskAssigneesRequest = loadTaskAssignees(supabaseBrowser())
      .then((result) => {
        taskAssigneesCache = { timestamp: Date.now(), response: result };
        return result;
      })
      .finally(() => { taskAssigneesRequest = null; });
  }
  return taskAssigneesCache && !taskAssigneesCache.response.error ? taskAssigneesCache.response : taskAssigneesRequest;
}

export async function getTaskAssignee(id) {
  return supabaseBrowser().from('employees').select('id,active,role').eq('id', id).maybeSingle();
}

function loadActiveEmployees(supabase) {
  return supabase.from('employees').select('id,name,active,role').eq('active', true).order('name');
}

export async function getActiveEmployees({ client } = {}) {
  if (client) return loadActiveEmployees(client);
  if (taskEmployeesCache && Date.now() - taskEmployeesCache.timestamp < employeeListCacheTtl) return taskEmployeesCache.response;
  if (!taskEmployeesRequest) {
    taskEmployeesRequest = loadActiveEmployees(supabaseBrowser())
      .then((response) => {
        taskEmployeesCache = { timestamp: Date.now(), response };
        return response;
      })
      .finally(() => { taskEmployeesRequest = null; });
  }
  // Stale-while-revalidate: serve the previous list while the refresh runs.
  return taskEmployeesCache && !taskEmployeesCache.response.error ? taskEmployeesCache.response : taskEmployeesRequest;
}

export function clearEmployeeDirectoryCache() {
  taskEmployeesCache = null;
  taskAssigneesCache = null;
}

onClearQueries(clearEmployeeDirectoryCache);

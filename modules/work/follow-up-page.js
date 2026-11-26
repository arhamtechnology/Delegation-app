import { canManageWork } from '../identity/roles.mjs';
import { getActiveEmployees } from '../identity/employee-directory';
import { getFollowUpWorkItems } from './follow-up-queries';

export async function loadFollowUpData({ employee, client }) {
  const manager = canManageWork(employee.role);
  const [workResponse, employeeResponse] = await Promise.all([
    getFollowUpWorkItems({ employeeId: manager ? undefined : employee.id, client }),
    manager ? getActiveEmployees({ client }) : Promise.resolve({ data: [employee], error: null }),
  ]);
  const error = workResponse.error || employeeResponse.error;
  if (error) return { data: null, error };
  return { data: { workItems: workResponse.data || [], employees: employeeResponse.data || [], manager }, error: null };
}

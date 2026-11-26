import { canManageWork } from '../identity/roles.mjs';
import { getTaskAssignees } from '../identity/employee-directory';
import { getWorkReport } from './work-report';

export async function loadMisData({ employee, client, filters = {}, signal }) {
  const manager = canManageWork(employee.role);
  const [assigneeResponse, reportResponse] = await Promise.all([
    manager ? getTaskAssignees({ client }) : Promise.resolve({ data: [employee], error: null }),
    getWorkReport({ ...filters, signal, client }),
  ]);
  const error = assigneeResponse.error || reportResponse.error;
  if (error) return { data: null, error };
  return { data: { employees: assigneeResponse.data || [], employeeRows: reportResponse.data.employees, counts: reportResponse.data.summary }, error: null };
}

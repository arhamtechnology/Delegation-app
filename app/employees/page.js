import { canManageWork } from '../../modules/identity/roles.mjs';
import EmployeesView from './EmployeesView';
import { loadEmployeesData } from '../../modules/identity/employee-directory';
import { withRenderTime } from '../../lib/render-freshness';
import { redirect } from 'next/navigation';
import { getServerSession } from '../../modules/identity/server-session';

export const metadata = { title: 'People' };

export default async function EmployeesPage() {
  const session = await getServerSession();
  // Managers only; doers are sent to their own work before any report query runs.
  if (session && !canManageWork(session.employee.role)) redirect('/tasks');
  const initial = session ? await loadEmployeesData({ employee: session.employee, client: session.client }).catch(() => null) : null;
  return <EmployeesView initialData={withRenderTime(initial?.data || null)} />;
}

import { canManageWork } from '../../modules/identity/roles.mjs';
import MisView from './MisView';
import { loadMisData } from '../../modules/work/mis';
import { withRenderTime } from '../../lib/render-freshness';
import { redirect } from 'next/navigation';
import { getServerSession } from '../../modules/identity/server-session';

export const metadata = { title: 'MIS reports' };

export default async function MisPage() {
  const session = await getServerSession();
  // Managers only; doers are sent to their own work before any report query runs.
  if (session && !canManageWork(session.employee.role)) redirect('/tasks');
  const initial = session ? await loadMisData({ employee: session.employee, client: session.client }).catch(() => null) : null;
  return <MisView initialData={withRenderTime(initial?.data || null)} />;
}

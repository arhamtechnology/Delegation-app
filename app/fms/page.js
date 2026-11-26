import { redirect } from 'next/navigation';
import FmsView from './FmsView';
import { canManageWork } from '../../modules/identity/roles.mjs';
import { loadFmsBoard } from '../../modules/fms/fms-data';
import { createSupabaseAdminClient } from '../../lib/supabase-server';
import { getServerSession } from '../../modules/identity/server-session';

export const metadata = { title: 'Order FMS' };

export default async function FmsPage() {
  const session = await getServerSession();
  // Directors and EAs only; doers see their FMS steps on their dashboard.
  if (session && !canManageWork(session.employee.role)) redirect('/dashboard');
  // No server session: the view loads in the browser instead.
  const initial = session ? await loadFmsBoard(createSupabaseAdminClient()).catch(() => null) : null;
  return <FmsView initialData={initial} />;
}

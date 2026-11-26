import { notFound, redirect } from 'next/navigation';
import FmsView from '../FmsView';
import { canManageWork } from '../../../modules/identity/roles.mjs';
import { loadFmsBoard } from '../../../modules/fms/fms-data';
import { fmsFlows } from '../../../modules/work-model/fms-flows.mjs';
import { createSupabaseAdminClient } from '../../../lib/supabase-server';
import { getServerSession } from '../../../modules/identity/server-session';

export async function generateMetadata({ params }) {
  return { title: fmsFlows[(await params).flow]?.title || 'FMS' };
}

export default async function FmsFlowPage({ params }) {
  const { flow: slug } = await params;
  const flow = fmsFlows[slug];
  if (!flow) notFound();
  const session = await getServerSession();
  // Directors and EAs only; doers see their FMS steps on their dashboard.
  if (session && !canManageWork(session.employee.role)) redirect('/dashboard');
  // No server session: the view loads in the browser instead.
  const initial = session ? await loadFmsBoard(createSupabaseAdminClient(), flow.process).catch(() => null) : null;
  return <FmsView flow={{ slug, ...flow }} initialData={initial} />;
}

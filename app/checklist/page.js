import ChecklistView from './ChecklistView';
import { loadChecklistData } from '../../modules/checklists/checklist-pages';
import { withRenderTime } from '../../lib/render-freshness';
import { getServerSession } from '../../modules/identity/server-session';

export const metadata = { title: 'Checklist' };

export default async function ChecklistPage() {
  const session = await getServerSession();
  const initial = session ? await loadChecklistData({ employee: session.employee, client: session.client }).catch(() => null) : null;
  return <ChecklistView initialData={withRenderTime(initial?.data || null)} />;
}

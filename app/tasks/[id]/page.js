import TaskDetailView from './TaskDetailView';
import { loadTaskDetail } from '../../../modules/tasks/task-detail';
import { withRenderTime } from '../../../lib/render-freshness';
import { getServerSession } from '../../../modules/identity/server-session';

export const metadata = { title: 'Task' };

export default async function TaskDetailPage({ params }) {
  const { id } = await params;
  const session = await getServerSession();
  const initial = session ? await loadTaskDetail({ id, client: session.client }).catch(() => null) : null;
  return <TaskDetailView key={id} id={id} initialData={withRenderTime(initial?.data?.task ? initial.data : null)} initialEmployee={session?.employee || null} />;
}

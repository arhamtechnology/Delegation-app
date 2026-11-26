import NotificationsView from './NotificationsView';
import { loadNotificationsPage } from '../../modules/notifications/inbox';
import { withRenderTime } from '../../lib/render-freshness';
import { getServerSession } from '../../modules/identity/server-session';

export const metadata = { title: 'Inbox' };

export default async function NotificationsPage() {
  const session = await getServerSession();
  const initial = session ? await loadNotificationsPage({ employee: session.employee, client: session.client }).catch(() => null) : null;
  return <NotificationsView initialData={withRenderTime(initial?.data || null)} />;
}

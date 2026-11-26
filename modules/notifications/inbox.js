import { supabaseBrowser } from '../../lib/supabase-browser';

export const NOTIFICATION_PAGE_SIZE = 30;

function notificationType(kind) {
  if (kind === 'assignment') return 'task_created';
  if (kind === 'update') return 'task_updated';
  return kind || 'task_updated';
}

export async function loadNotificationsPage({ employee, client, view = 'all', page = 0 }) {
  const supabase = client || supabaseBrowser();
  function buildQuery(select) {
    let query = supabase.from('notifications').select(select, { count: 'exact' })
      .eq('recipient_employee_id', employee.id)
      .order('created_at', { ascending: false })
      .range(page * NOTIFICATION_PAGE_SIZE, (page + 1) * NOTIFICATION_PAGE_SIZE - 1);
    if (view === 'unread') query = query.is('read_at', null);
    if (view === 'read') query = query.not('read_at', 'is', null);
    return query;
  }
  let result = await buildQuery('id,task_id,kind,title,body,entity_type,entity_id,read_at,created_at');
  if (result.error && /entity_type|entity_id|schema cache|column/i.test(result.error.message || '')) result = await buildQuery('id,task_id,kind,title,body,read_at,created_at');
  if (result.error) return { data: null, error: result.error };
  return {
    data: {
      employee,
      totalPages: Math.max(1, Math.ceil((result.count || 0) / NOTIFICATION_PAGE_SIZE)),
      notifications: (result.data || []).map((item) => ({
        id: item.id,
        type: notificationType(item.kind),
        title: item.title,
        description: item.body || 'A workspace notification is waiting for your attention.',
        taskId: item.task_id,
        entityType: item.entity_type,
        entityId: item.entity_id,
        date: item.created_at,
        readAt: item.read_at,
      })),
    },
    error: null,
  };
}

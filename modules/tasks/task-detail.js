import { supabaseBrowser } from '../../lib/supabase-browser';
import { getTask } from './task-data';

export async function loadTaskDetail({ id, client }) {
  const supabase = client || supabaseBrowser();
  const [taskResponse, updatesResponse] = await Promise.all([
    getTask(id, supabase),
    supabase.from('task_updates').select('id,update_type,remark,proof_url,created_at').eq('task_id', id).order('created_at', { ascending: false }),
  ]);
  if (taskResponse.error && taskResponse.error.code !== 'PGRST116') return { data: null, error: taskResponse.error };
  return { data: { task: taskResponse.data || null, updates: updatesResponse.data || [] }, error: null };
}

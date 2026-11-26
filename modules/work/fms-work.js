import { localDateTimeToIso } from '../../lib/business-time';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { fmsFlowTitle } from '../work-model/fms-flows.mjs';

// A doer's FMS steps (ERP sales orders) as dashboard work items: open ones from any day, plus those
// done today. Read only: the ERP closes them. Any failure returns none, so tasks and checklists still load.
export async function getFmsWorkItems({ employeeId, today, client, signal }) {
  const db = client || supabaseBrowser();
  const startOfToday = new Date(localDateTimeToIso(today, '00:00')).toISOString();
  let steps = db.from('fms_steps').select('process,code,name,eta_minutes,doer_id').eq('doer_id', employeeId);
  let items = db.from('fms_items').select('key,process,step,order_no,customer,ref,started_at,done_at')
    .eq('cancelled', false).or(`done_at.is.null,done_at.gte.${startOfToday}`).order('started_at').limit(500);
  if (signal) {
    steps = steps.abortSignal(signal);
    items = items.abortSignal(signal);
  }
  const [stepResponse, itemResponse] = await Promise.all([steps, items]);
  if (stepResponse.error || itemResponse.error) return [];
  const mine = new Map(stepResponse.data.map((step) => [`${step.process}|${step.code}`, step]));
  return itemResponse.data.flatMap((item) => {
    const step = mine.get(`${item.process}|${item.step}`);
    if (!step) return [];
    const eta = new Date(Date.parse(item.started_at) + step.eta_minutes * 60000).toISOString();
    return [{
      id: item.key,
      kind: 'fms',
      sourceType: 'fms',
      title: `${step.name} · ${item.order_no}${item.customer ? ` · ${item.customer}` : ''}`,
      description: item.ref ? `${item.step === 'transport' ? 'Invoice' : 'Dispatch'} ${item.ref}` : null,
      category: fmsFlowTitle(item.process),
      priority: 'normal',
      status: item.done_at ? 'completed' : 'pending',
      eta,
      dueDate: eta,
      completed_at: item.done_at,
      completedAt: item.done_at,
      assignee_id: employeeId,
      employeeId,
    }];
  });
}

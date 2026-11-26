import { canManageWork } from '../identity/roles.mjs';
import { done, fail } from '../../lib/actor';
import { dueAt, itemStatus } from './fms.mjs';

const itemSelect = 'key,process,step,order_no,customer,ref,started_at,done_at';
const recentMs = 7 * 24 * 60 * 60000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One flow's FMS page (directors and EAs): steps with their doers, open work and work finished in the last 7 days. */
export async function loadFmsBoard(admin, process, now = new Date()) {
  const [steps, open, recent, employees] = await Promise.all([
    admin.from('fms_steps').select('process,code,name,seq,eta_minutes,doer_id,doer:employees!fms_steps_doer_id_fkey(name)').eq('process', process).order('seq'),
    admin.from('fms_items').select(itemSelect).eq('process', process).is('done_at', null).eq('cancelled', false).order('started_at').limit(1000),
    admin.from('fms_items').select(itemSelect).eq('process', process).gte('done_at', new Date(now.getTime() - recentMs).toISOString()).order('done_at', { ascending: false }).limit(1000),
    admin.from('employees').select('id,name').eq('active', true).order('name'),
  ]);
  for (const result of [steps, open, recent, employees]) if (result.error) throw result.error;
  const stepRows = steps.data.map(({ doer, ...step }) => ({ ...step, doerName: doer?.name || null }));
  const byKey = new Map(stepRows.map((step) => [`${step.process}|${step.code}`, step]));
  const items = [...open.data, ...recent.data].flatMap((item) => {
    const step = byKey.get(`${item.process}|${item.step}`);
    if (!step) return [];
    return [{ ...item, stepName: step.name, seq: step.seq, doerName: step.doerName, due_at: dueAt(item, step), status: itemStatus(item, step, now) }];
  });
  return { steps: stepRows, employees: employees.data, items, loadedAt: now.toISOString() };
}

/** Change a step's doer and ETA. Applies to open work at once: due times are worked out from the step. */
export async function updateFmsStep(admin, actor, payload) {
  if (!canManageWork(actor.role)) return fail('Only directors and EAs can change FMS steps.', 403);
  const eta = Number(payload?.eta_minutes);
  const doerId = payload?.doer_id || null;
  if (!Number.isInteger(eta) || eta < 5 || eta > 43200) return fail('ETA must be between 5 minutes and 30 days.', 400);
  if (doerId && !uuidPattern.test(doerId)) return fail('Pick a valid doer.', 400);
  if (doerId) {
    const { data, error } = await admin.from('employees').select('id').eq('id', doerId).eq('active', true).maybeSingle();
    if (error) return fail('The doer could not be checked.', 500);
    if (!data) return fail('That employee is not active.', 400);
  }
  const { data, error } = await admin.from('fms_steps')
    .update({ eta_minutes: eta, doer_id: doerId, updated_at: new Date().toISOString(), updated_by: actor.employeeId })
    .eq('process', String(payload?.process || '')).eq('code', String(payload?.code || ''))
    .select('code').maybeSingle();
  if (error) return fail('The FMS step could not be saved.', 500);
  if (!data) return fail('That FMS step was not found.', 404);
  return done({ success: true });
}

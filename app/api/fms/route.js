import { authorizeChecklistEmployee, checklistApiError } from '../../../modules/checklists/checklist-server';
import { actorFromAuthorization, ruleResponse } from '../../../lib/actor';
import { loadFmsBoard, updateFmsStep } from '../../../modules/fms/fms-data';
import { canManageWork } from '../../../modules/identity/roles.mjs';
import { fmsFlows } from '../../../modules/work-model/fms-flows.mjs';

export const runtime = 'nodejs';

export async function GET(request) {
  const authorization = await authorizeChecklistEmployee(request, 'You must be signed in to view FMS.');
  if (authorization.response) return authorization.response;
  if (!canManageWork(authorization.employee.role)) return checklistApiError('FMS is for directors and EAs.', 403);
  const process = new URL(request.url).searchParams.get('process');
  if (!Object.values(fmsFlows).some((flow) => flow.process === process)) return checklistApiError('Unknown FMS flow.', 400);
  try {
    return Response.json({ success: true, ...(await loadFmsBoard(authorization.admin, process)) });
  } catch (error) {
    console.error('FMS board load failed.', { code: error?.code, message: error?.message });
    return checklistApiError('FMS could not be loaded.', 500);
  }
}

export async function PATCH(request) {
  const authorization = await authorizeChecklistEmployee(request, 'You must be signed in to change FMS steps.');
  if (authorization.response) return authorization.response;
  let payload;
  try { payload = await request.json(); } catch { return checklistApiError('The FMS request could not be read.', 400); }
  return ruleResponse(await updateFmsStep(authorization.admin, actorFromAuthorization(authorization), payload));
}

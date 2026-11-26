import { actorFromAuthorization, ruleResponse } from '../../../../lib/actor';
import { deleteTemplatesInBulk } from '../../../../modules/checklists/checklist-bulk-rules';
import { authorizeChecklistManager, checklistApiError } from '../../../../modules/checklists/checklist-server';

export async function POST(request) {
  const authorization = await authorizeChecklistManager(request);
  if (authorization.response) return authorization.response;
  let payload;
  try { payload = await request.json(); } catch { return checklistApiError('The bulk delete request could not be read.', 400); }
  return ruleResponse(await deleteTemplatesInBulk(authorization.admin, actorFromAuthorization(authorization), payload));
}

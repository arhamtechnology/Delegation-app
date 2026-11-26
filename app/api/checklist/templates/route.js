import { authorizeChecklistManager, checklistApiError } from '../../../../modules/checklists/checklist-server';
import { actorFromAuthorization, ruleResponse } from '../../../../lib/actor';
import { createTemplate, deleteTemplate, updateTemplate } from '../../../../modules/checklists/checklist-template-rules';

export const runtime = 'nodejs';

export async function POST(request) {
  const authorization = await authorizeChecklistManager(request);
  if (authorization.response) return authorization.response;
  let payload;
  try { payload = await request.json(); } catch { return checklistApiError('The checklist request could not be read.', 400); }
  return ruleResponse(await createTemplate(authorization.admin, actorFromAuthorization(authorization), payload));
}

export async function PATCH(request) {
  const authorization = await authorizeChecklistManager(request);
  if (authorization.response) return authorization.response;
  let payload;
  try { payload = await request.json(); } catch { return checklistApiError('The checklist request could not be read.', 400); }
  return ruleResponse(await updateTemplate(authorization.admin, actorFromAuthorization(authorization), payload));
}

export async function DELETE(request) {
  const authorization = await authorizeChecklistManager(request);
  if (authorization.response) return authorization.response;
  let payload;
  try { payload = await request.json(); } catch { return checklistApiError('The checklist deletion request could not be read.', 400); }
  return ruleResponse(await deleteTemplate(authorization.admin, actorFromAuthorization(authorization), payload));
}

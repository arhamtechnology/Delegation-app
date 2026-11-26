import { actorFromAuthorization, ruleResponse } from '../../../lib/actor';
import { deleteTask } from '../../../modules/tasks/task-rules';
import { authorizeTaskManager, taskApiError } from '../../../modules/tasks/task-server';

export async function DELETE(request) {
  const authorization = await authorizeTaskManager(request);
  if (authorization.response) return authorization.response;

  let payload;
  try { payload = await request.json(); } catch { return taskApiError('The task deletion request could not be read.', 400); }
  return ruleResponse(await deleteTask(authorization.admin, actorFromAuthorization(authorization), payload));
}

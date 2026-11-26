import { authorizeChecklistEmployee, checklistApiError } from '../../../../modules/checklists/checklist-server';
import { getWorkspaceDate } from '../../../../lib/business-time';
import { loadAssignedChecklists } from '../../../../modules/checklists/assigned-checklists.mjs';

export const runtime = 'nodejs';

const timeZone = process.env.CHECKLIST_TIMEZONE || 'Asia/Kolkata';

// Uses the service role because employees cannot read their own leave through RLS; returns only the caller's rows.
export async function GET(request) {
  const authorization = await authorizeChecklistEmployee(request);
  if (authorization.response) return authorization.response;
  const today = getWorkspaceDate(new Date(), timeZone);
  try {
    return Response.json({ success: true, today, checklists: await loadAssignedChecklists(authorization.admin, authorization.employee.id, today) });
  } catch (error) {
    console.error('Assigned checklists could not be loaded.', { code: error.code, message: error.message });
    return checklistApiError('Your assigned checklists could not be loaded.', 500);
  }
}

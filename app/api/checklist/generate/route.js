import { createSupabaseAdminClient, createSupabaseUserClient, getBearerToken } from '../../../../lib/supabase-server';
import { generateChecklistItems } from '../../../../modules/checklists/checklist-generation';

function responseError(message, status) {
  return Response.json({ success: false, created: 0, skipped: 0, error: message }, { status });
}

async function authorize(request) {
  const token = getBearerToken(request);
  if (!token) return { error: responseError('Checklist generation is protected.', 401) };
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { mode: 'cron' };

  let userClient;
  try {
    userClient = createSupabaseUserClient(token);
  } catch {
    return { error: responseError('Server authentication is not configured.', 503) };
  }
  const { data: { user } = {}, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return { error: responseError('Your session is invalid or has expired.', 401) };
  const { data: employee, error } = await userClient.from('employees').select('role,active').eq('auth_user_id', user.id).maybeSingle();
  if (error) return { error: responseError('Your workspace role could not be verified.', 500) };
  // Any active employee may trigger it: generation takes no input and is idempotent, and the dashboard
  // relies on it to fill in today's checklist when the daily cron missed (e.g. a database outage).
  if (!employee || employee.active === false) return { error: responseError('Only active employees can trigger generation.', 403) };
  return { mode: 'employee' };
}

async function handler(request) {
  const authorization = await authorize(request);
  if (authorization.error) return authorization.error;
  try {
    return Response.json({ success: true, ok: true, ...(await generateChecklistItems(createSupabaseAdminClient())) });
  } catch (error) {
    console.error('Checklist generation failed.', { code: error.code, message: error.message });
    if (/(due_at|due_time|monthly_days|checklist_items|checklist_templates|national_holidays|employee_non_working_days)/i.test(error.message || '') && /(column|relation|schema cache|does not exist)/i.test(error.message || '')) {
      if (/(national_holidays|employee_non_working_days)/i.test(error.message || '')) return responseError('Checklist migration checklist_direct_non_working_days.sql is not applied.', 500);
      return responseError(/monthly_days/i.test(error.message || '') ? 'Checklist database migration 006_checklist_monthly_days.sql is not applied.' : 'Checklist database migration 004_checklist_due_time.sql is not applied.', 500);
    }
    return responseError('Checklist generation failed. Check the server logs for the database error.', 500);
  }
}

export const GET = handler;
export const POST = handler;

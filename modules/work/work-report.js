import { supabaseBrowser } from '../../lib/supabase-browser';
import { getWorkQueryError, validateWorkReportPayload } from '../work-model/work-list.mjs';

function getWorkReportFilterDiagnostic({ workType, status, priority, employeeId, from, to, search }) {
  return {
    workType,
    status,
    priority,
    hasEmployeeFilter: Boolean(employeeId),
    hasFromDate: Boolean(from),
    hasToDate: Boolean(to),
    hasSearch: Boolean(String(search || '').trim()),
  };
}

export async function getWorkReport({ workType = 'all', status = 'all', priority = 'all', employeeId, from, to, search, signal, client } = {}) {
  let query = (client || supabaseBrowser()).rpc('get_work_report', {
    p_work_type: workType,
    p_status: status,
    p_from: from || null,
    p_to: to || null,
    p_search: String(search || '').trim().slice(0, 120) || null,
    p_priority: priority,
    p_employee_id: employeeId || null,
  });
  if (signal) query = query.abortSignal(signal);
  const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
  const response = await query;
  const durationMs = Math.round((typeof performance === 'undefined' ? Date.now() : performance.now()) - startedAt);
  const filters = getWorkReportFilterDiagnostic({ workType, status, priority, employeeId, from, to, search });
  if (response.error) {
    const error = getWorkQueryError(response.error);
    console.error('[mis] get_work_report failed', {
      query: 'get_work_report',
      durationMs,
      filters,
      code: response.error.code || null,
      message: response.error.message || 'Unknown database error',
      details: response.error.details || null,
      hint: response.error.hint || null,
    });
    return { data: null, error, durationMs };
  }

  const report = validateWorkReportPayload(response.data);
  if (report.error) {
    console.error('[mis] get_work_report returned an invalid payload', {
      query: 'get_work_report',
      durationMs,
      filters,
      hasSummary: Boolean(response.data?.summary),
      employeeRowCount: Array.isArray(response.data?.employees) ? response.data.employees.length : null,
    });
    return { data: null, error: report.error, durationMs };
  }

  const diagnostic = { query: 'get_work_report', durationMs, filters, total: report.data.summary.total, employeeRowCount: report.data.employees.length };
  if (report.data.summary.total === 0) console.warn('[mis] get_work_report returned zero visible rows', diagnostic);
  else if (process.env.NODE_ENV !== 'production' || durationMs >= 1500) console.info('[mis] get_work_report completed', diagnostic);
  return { data: report.data, error: null, durationMs };
}

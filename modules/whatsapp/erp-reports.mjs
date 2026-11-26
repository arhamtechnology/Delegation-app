// Director asks for an ERP report (check-in, weekly or monthly sales): forwarded to the ERP's
// wa-reports edge function, which answers with the message text. The ERP decides who may ask.

const subject = /\b(check ?-?ins?|attendance|hazri|sales)\b/;
const reportWord = /\b(report|summary|weekly|monthly|week|month|hafte|mahine)\b/;
// Task wording means this is a Delegation request, not a report request.
const taskWord = /\b(task|assign|remind|create|add|due|tomorrow|delete|close|cancel)\b|#\d/;

/** Short, whole-message requests only: a wrong forward costs more than one extra model call. */
export function isErpReportRequest(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9\s#-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60 || taskWord.test(t)) return false;
  if (/^(erp )?reports?$/.test(t)) return true;
  return subject.test(t) && (reportWord.test(t) || /^(check ?-?ins?|attendance)( (today|yesterday|kal))?$/.test(t));
}

/** @returns {Promise<string[]>} message texts to send back */
export async function fetchErpReport({ chatId, text }, fetchImpl = fetch) {
  const { ERP_REPORTS_URL, ERP_FORWARD_SECRET } = process.env;
  if (!ERP_REPORTS_URL || !ERP_FORWARD_SECRET) return ['ERP reports are not configured.'];
  const response = await fetchImpl(ERP_REPORTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wa-forward': ERP_FORWARD_SECRET },
    body: JSON.stringify({ chatId, text }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`ERP reports failed with status ${response.status}.`);
  const body = await response.json();
  return Array.isArray(body.messages) && body.messages.length ? body.messages.map(String) : ['No report returned.'];
}

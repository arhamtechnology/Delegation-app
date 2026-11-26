import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchErpReport, isErpReportRequest } from '../modules/whatsapp/erp-reports.mjs';

test('erp reports 1: report requests are forwarded, task wording is not', () => {
  for (const text of ['check-in report', 'Checkin report yesterday', 'weekly sales report', 'sales report this month', 'monthly sales', 'attendance', 'reports']) {
    assert.equal(isErpReportRequest(text), true, text);
  }
  for (const text of ['create task sales report for Ravi due friday', '#12 done', 'overdue tasks', 'mis report', 'remind Varun to send the sales report', '']) {
    assert.equal(isErpReportRequest(text), false, text);
  }
});

test('erp reports 2: the forward carries the secret and returns the messages', async () => {
  process.env.ERP_REPORTS_URL = 'https://erp.example/functions/v1/wa-reports';
  process.env.ERP_FORWARD_SECRET = 's3';
  let seen;
  const fake = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ ok: true, messages: ['hello'] }) };
  };
  assert.deepEqual(await fetchErpReport({ chatId: '1@c.us', text: 'check-in report' }, fake), ['hello']);
  assert.equal(seen.init.headers['x-wa-forward'], 's3');
  assert.deepEqual(JSON.parse(seen.init.body), { chatId: '1@c.us', text: 'check-in report' });
  const failing = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => fetchErpReport({ chatId: '1@c.us', text: 'x' }, failing), /status 500/);
});

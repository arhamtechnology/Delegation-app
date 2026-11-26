import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFmsMessages, dueAt, feedRowToItem, fetchFmsFeed, itemStatus, planFmsAlerts } from '../modules/fms/fms.mjs';

const steps = new Map([
  ['approval', { name: 'Order approval', eta_minutes: 120, doer_id: 'tuk', doerName: 'Tukeshwar' }],
  ['invoice', { name: 'Invoice', eta_minutes: 180, doer_id: null, doerName: null }],
]);
const start = '2026-11-26T04:00:00.000Z'; // 9:30 AM India
const item = { key: 'approval:o1', step: 'approval', order_no: 'OD-29', customer: 'Sharma Traders', ref: null, started_at: start };
const at = (minutes) => new Date(Date.parse(start) + minutes * 60000);
const stages = (minutes, list = [item]) => planFmsAlerts(list, steps, at(minutes)).map((alert) => alert.stage);

test('fms 1: due time and status follow the step ETA', () => {
  const step = steps.get('approval');
  assert.equal(dueAt(item, step), '2026-11-26T06:00:00.000Z');
  assert.equal(itemStatus(item, step, at(119)), 'pending');
  assert.equal(itemStatus(item, step, at(121)), 'overdue');
  assert.equal(itemStatus({ ...item, done_at: at(100).toISOString() }, step, at(500)), 'done');
  assert.equal(itemStatus({ ...item, done_at: at(130).toISOString() }, step, at(500)), 'late');
  assert.equal(itemStatus({ ...item, cancelled: true }, step, at(10)), 'cancelled');
});

test('fms 2: alerts at start, 30 min before the ETA, at the ETA and 1 hour after, never for stale work', () => {
  assert.deepEqual(stages(1), ['assigned']);
  assert.deepEqual(stages(31), []);
  assert.deepEqual(stages(95), ['due_soon']);
  assert.deepEqual(stages(120), ['overdue']);
  assert.deepEqual(stages(181), ['escalated']);
  assert.deepEqual(stages(300), []);
  assert.deepEqual(planFmsAlerts([{ ...item, step: 'unknown' }], steps, at(1)), []);
});

test('fms 3: EAs get every stage, directors only the escalation, doers nothing', () => {
  const invoice = { ...item, key: 'invoice:d1', step: 'invoice', ref: 'DSP-7' };
  const fresh = [...planFmsAlerts([item], steps, at(1)), ...planFmsAlerts([invoice], steps, at(1))];
  const late = planFmsAlerts([item], steps, at(181));
  const messages = buildFmsMessages([...fresh, ...late], ['92222@c.us'], ['93333@c.us'], 'Order FMS');
  assert.deepEqual(messages.map((message) => message.chatId).sort(), ['92222@c.us', '93333@c.us']);
  const ea = messages.find((message) => message.chatId === '92222@c.us').text;
  const director = messages.find((message) => message.chatId === '93333@c.us').text;
  assert.match(ea, /🆕 Order FMS · New pending work/);
  assert.match(ea, /Step: Invoice\nOrder: OD-29 · Sharma Traders\nDispatch: DSP-7/);
  assert.match(ea, /Doer: Not assigned/);
  assert.match(ea, /Still pending 1 hour[^]*Doer: Tukeshwar/);
  assert.doesNotMatch(director, /New pending work/);
  assert.match(director, /Still pending 1 hour/);
  // A director who is also an EA hears once.
  assert.equal(buildFmsMessages(late, ['92222@c.us'], ['92222@c.us']).length, 1);
});

test('fms 4: feed rows are validated and the feed call carries the secret', async () => {
  assert.equal(feedRowToItem({ key: 'x', step: 'bogus', order_id: 'o', order_no: '1', started_at: start }, 'sales_order', start), null);
  const row = feedRowToItem({ key: 'approval:o', step: 'approval', order_id: 'o', order_no: 'OD-1', started_at: start, done_at: null, cancelled: false }, 'sales_order', start);
  assert.equal(row.process, 'sales_order');
  assert.equal(row.done_at, null);

  delete process.env.ERP_FMS_URL;
  assert.equal(await fetchFmsFeed({ from: start, since: start }), null);
  process.env.ERP_FMS_URL = 'https://erp.example/functions/v1/fms-feed';
  process.env.ERP_FORWARD_SECRET = 's3';
  let seen;
  const steps = await fetchFmsFeed({ from: start, since: start }, async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ ok: true, steps: [{ key: 'a' }] }) };
  });
  assert.equal(seen.init.headers['x-wa-forward'], 's3');
  assert.deepEqual(JSON.parse(seen.init.body), { from: start, since: start });
  assert.equal(steps.length, 1);
  await assert.rejects(fetchFmsFeed({ from: start, since: start }, async () => ({ ok: false, status: 401 })), /401/);
});

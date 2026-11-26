import assert from 'node:assert/strict';
import test from 'node:test';
import { startDashboardAutoRefresh } from '../modules/work/dashboard-refresh.mjs';

test('dashboard refreshes on its timer and on notifications while visible, then cleans up', () => {
  let tick;
  let refreshes = 0;
  const browser = new EventTarget();
  browser.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  browser.setInterval = (callback, delay) => {
    assert.equal(delay, 15_000);
    tick = callback;
    return 1;
  };
  browser.clearInterval = (timer) => {
    assert.equal(timer, 1);
    tick = undefined;
  };
  const stop = startDashboardAutoRefresh(() => { refreshes += 1; }, browser);

  tick();
  browser.dispatchEvent(new Event('notifications:changed'));
  assert.equal(refreshes, 2);

  browser.document.visibilityState = 'hidden';
  browser.document.dispatchEvent(new Event('visibilitychange'));
  tick();
  browser.dispatchEvent(new Event('notifications:changed'));
  assert.equal(refreshes, 2);

  browser.document.visibilityState = 'visible';
  browser.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(refreshes, 3);

  stop();
  assert.equal(tick, undefined);
  browser.document.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('notifications:changed'));
  assert.equal(refreshes, 3);
});

const refreshIntervalMs = 15_000;

export function startDashboardAutoRefresh(refresh, browser = window) {
  const refreshWhenVisible = () => {
    if (browser.document.visibilityState === 'visible') refresh();
  };

  const timer = browser.setInterval(refreshWhenVisible, refreshIntervalMs);
  browser.addEventListener('notifications:changed', refreshWhenVisible);
  browser.document.addEventListener('visibilitychange', refreshWhenVisible);

  return () => {
    browser.clearInterval(timer);
    browser.removeEventListener('notifications:changed', refreshWhenVisible);
    browser.document.removeEventListener('visibilitychange', refreshWhenVisible);
  };
}

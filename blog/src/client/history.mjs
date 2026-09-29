export const NAV_STATE = '__siteNav';

function entry(win, scroll = null) {
  return {
    key: win.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    url: win.location.href,
    scroll,
  };
}

export function ensureHistory(win = window) {
  const state = win.history.state || {};
  if (!state[NAV_STATE] || state[NAV_STATE].url !== win.location.href) {
    win.history.replaceState({
      ...state,
      [NAV_STATE]: entry(win, [win.scrollX, win.scrollY]),
    }, '', win.location.href);
  }
  return win.history.state;
}

export function saveScroll(win = window) {
  const state = ensureHistory(win);
  win.history.replaceState({
    ...state,
    [NAV_STATE]: { ...state[NAV_STATE], scroll: [win.scrollX, win.scrollY] },
  }, '', win.location.href);
}

export function writeHistory(mode, state, url, win = window) {
  if (mode !== 'push' && mode !== 'replace') return;
  if (mode === 'push') saveScroll(win);
  const current = ensureHistory(win);
  const target = new URL(url, win.location.href);
  const nav = mode === 'push' ? entry(win) : current[NAV_STATE];
  win.history[`${mode}State`]({
    ...current,
    ...state,
    [NAV_STATE]: { ...nav, url: target.href },
  }, '', target.href);
  win.dispatchEvent(new win.Event('site:history-change'));
}

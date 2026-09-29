import { NAV_STATE, ensureHistory, saveScroll, writeHistory } from './history.mjs';
import { mountPageEffects } from './page-effects.mjs';

export const CACHE_TTL = 5 * 60 * 1000;
export const REQUEST_TIMEOUT = 15000;
const META = 'meta[name="description"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"],script[type="application/ld+json"]';

function deadline(work, milliseconds, onTimeout = () => {}) {
  let timer;
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error('Navigation timed out'));
      }, milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Only the seven public section paths can enter this cache or its two-worker queue.
export function createPageCache({ routes, load, now = Date.now, ttl = CACHE_TTL, timeout = REQUEST_TIMEOUT }) {
  const entries = new Map();
  const queue = [];
  let running = 0;
  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift();
      running++;
      const controller = new AbortController();
      deadline(Promise.resolve().then(() => load(job.path, controller.signal)), timeout, () => controller.abort())
        .then((value) => {
          job.value = value;
          job.expires = now() + ttl;
          job.resolve(value);
        }, (error) => {
          if (entries.get(job.path) === job) entries.delete(job.path);
          job.reject(error);
        })
        .finally(() => { running--; pump(); });
    }
  }
  return {
    seed(path, value) {
      if (routes.includes(path)) entries.set(path, { value, expires: now() + ttl });
    },
    get(path, priority = false) {
      if (!routes.includes(path)) return Promise.reject(new Error('Unsupported section'));
      let entry = entries.get(path);
      if (entry?.expires > now()) return Promise.resolve(entry.value);
      if (entry?.promise && !entry.expires) {
        const index = queue.indexOf(entry);
        if (priority && index >= 0) queue.unshift(...queue.splice(index, 1));
        return entry.promise;
      }
      entry = { path, expires: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      entries.set(path, entry);
      if (priority) queue.unshift(entry);
      else queue.push(entry);
      pump();
      return entry.promise;
    },
  };
}

export function readPage(doc, path, manifest) {
  const incoming = JSON.parse(doc.querySelector('#site-navigation-data')?.textContent || 'null');
  if (!incoming || incoming.version !== manifest.version
      || JSON.stringify(incoming.routes) !== JSON.stringify(manifest.routes)
      || JSON.stringify(incoming.preloads) !== JSON.stringify(manifest.preloads)) {
    throw Object.assign(new Error('Incompatible release'), { code: 'VERSION' });
  }
  const main = doc.querySelector('#main-content');
  if (!main || doc.querySelectorAll('#main-content').length !== 1 || main.dataset.pagePath !== path || !doc.title) {
    throw new Error('Invalid section document');
  }
  // DOMParser parses noscript as markup; adopting its fallback styles would hide
  // the interactive jobs controls even though scripting is enabled here.
  for (const node of main.querySelectorAll('script:not([type="application/json"]),noscript')) node.remove();
  return { main, title: doc.title, metadata: [...doc.head.querySelectorAll(META)] };
}

export function canPrefetch(connection) {
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType);
}

export async function startNavigation({
  win = window,
  loadModule = (url) => import(url),
  mountEffects = mountPageEffects,
  timeout = REQUEST_TIMEOUT,
} = {}) {
  const doc = win.document;
  const gate = win.siteNavigation;
  const manifest = JSON.parse(doc.querySelector('#site-navigation-data').textContent);
  const routes = Object.keys(manifest.routes);
  let currentMain = doc.getElementById('main-content');
  let committedUrl = win.location.href;
  let committedState = ensureHistory(win);
  let sequence = 0;
  let pending = false;
  let loadingTimer;
  let scrollFrame;
  const previousScrollRestoration = win.history.scrollRestoration;
  win.history.scrollRestoration = 'manual';

  const warmedModules = new Map();
  const failedModules = new Set();
  async function warmModule(url, signal) {
    if (!warmedModules.has(url)) {
      const work = win.fetch(url, { cache: failedModules.has(url) ? 'reload' : 'force-cache', credentials: 'same-origin', signal })
        .then(async (response) => {
          if (!response.ok || !/(?:java|ecma)script/i.test(response.headers.get('content-type') || '')) {
            throw new Error('Module resource unavailable');
          }
          await response.arrayBuffer();
          failedModules.delete(url);
        })
        .catch((error) => { warmedModules.delete(url); failedModules.add(url); throw error; });
      warmedModules.set(url, work);
    }
    return warmedModules.get(url);
  }
  async function modulesFor(path) {
    return Promise.all((manifest.routes[path] || []).map(loadModule));
  }
  const cache = createPageCache({
    routes,
    timeout,
    load: async (path, signal) => {
      const response = await win.fetch(path, {
        signal, cache: 'no-cache', credentials: 'same-origin',
        headers: { Accept: 'text/html' }, priority: 'low',
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')
          || (response.url && (new URL(response.url).origin !== win.location.origin || new URL(response.url).pathname !== path))) {
        throw new Error(`Section request failed: ${response.status}`);
      }
      const page = readPage(new win.DOMParser().parseFromString(await response.text(), 'text/html'), path, manifest);
      // A failed native import is sticky in Chromium. Warm the complete hashed graph
      // before importing, so ordinary offline/404 failures can be retried.
      for (const entry of manifest.routes[path]) {
        for (const url of manifest.preloads?.[entry] || []) await warmModule(url, signal);
      }
      page.modules = await modulesFor(path);
      if (page.modules.some((module) => typeof module.prepare !== 'function')) throw new Error('Invalid section module');
      return page;
    },
  });
  const initialModules = await deadline(modulesFor(win.location.pathname), timeout);
  if (routes.includes(win.location.pathname)) {
    const page = readPage(doc.cloneNode(true), win.location.pathname, manifest);
    cache.seed(win.location.pathname, { ...page, modules: initialModules });
  }
  let cleanup = mount(currentMain, initialModules, false);
  committedUrl = win.location.href;
  committedState = ensureHistory(win);

  function mount(main, modules, soft) {
    const mounts = modules.map((module) => module.prepare(main));
    const dispose = mounts.map((mountIsland) => mountIsland());
    dispose.push(mountEffects(main, { soft }));
    return () => dispose.reverse().forEach((unmount) => unmount());
  }

  function remember() {
    if (new URL(committedUrl).pathname !== win.location.pathname) return;
    committedUrl = win.location.href;
    committedState = ensureHistory(win);
  }

  function position(url, state, id) {
    const apply = () => {
      if (sequence !== id) return;
      const scroll = state?.[NAV_STATE]?.scroll;
      if (scroll) win.scrollTo({ left: scroll[0], top: scroll[1], behavior: 'instant' });
      else if (url.hash) {
        let hash;
        try { hash = decodeURIComponent(url.hash.slice(1)); } catch { return; }
        doc.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    apply();
    // React URL restoration and anchor paging commit before the second positioning pass.
    win.requestAnimationFrame(() => win.requestAnimationFrame(apply));
  }

  async function navigate(href, { pop = false, state = null } = {}) {
    const url = new URL(href, committedUrl);
    if (url.origin !== win.location.origin || !routes.includes(url.pathname)) return false;
    const id = ++sequence;
    pending = true;
    clearTimeout(loadingTimer);
    gate.status('');
    loadingTimer = setTimeout(() => gate.status('正在加载页面…', 'loading'), 180);
    try {
      if (url.pathname === new URL(committedUrl).pathname) {
        if (!pop && url.href !== win.location.href) {
          writeHistory('push', {}, url.href, win);
          win.dispatchEvent(new win.PopStateEvent('popstate', { state: win.history.state }));
        }
        position(url, pop ? state : null, id);
        remember();
        gate.status('');
        return true;
      }
      const page = await deadline(cache.get(url.pathname, true), timeout);
      if (id !== sequence) return false;
      const main = doc.importNode(page.main, true);
      const mounts = page.modules.map((module) => module.prepare(main, {
        restoreScroll: Boolean(pop && state?.[NAV_STATE]?.scroll),
      }));
      // Nothing visible is removed until HTML, modules, and bootstrap data are ready.
      // Save the outgoing scroll before unmounting can shorten the document.
      if (!pop) writeHistory('push', {}, url.href, win);
      win.dispatchEvent(new win.Event('site:before-swap'));
      cleanup();
      currentMain.replaceWith(main);
      currentMain = main;
      doc.title = page.title;
      doc.head.querySelectorAll(META).forEach((node) => node.remove());
      page.metadata.forEach((node) => doc.head.append(doc.importNode(node, true)));
      for (const link of doc.querySelectorAll('#main-nav a[href]')) {
        const active = new URL(link.href).pathname === url.pathname;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      const dispose = mounts.map((mountIsland) => mountIsland());
      dispose.push(mountEffects(main, { soft: true }));
      cleanup = () => dispose.reverse().forEach((unmount) => unmount());
      main.classList.add('page-content-enter');
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
      committedUrl = win.location.href;
      committedState = ensureHistory(win);
      position(url, pop ? state : null, id);
      gate.status('');
      win.dispatchEvent(new win.Event('site:after-swap'));
      return true;
    } catch (error) {
      if (id !== sequence) return false;
      if (win.location.href !== committedUrl) win.history.replaceState(committedState, '', committedUrl);
      gate.status(error.code === 'VERSION'
        ? '网站已更新，当前页面已保留。请刷新以使用新版本。'
        : '页面加载失败，当前页面已保留。请检查网络后重试。',
      error.code === 'VERSION' ? 'version' : 'error', url.href);
      return false;
    } finally {
      if (id === sequence) {
        pending = false;
        clearTimeout(loadingTimer);
      }
    }
  }

  function onPop(event) {
    if (new URL(committedUrl).pathname !== win.location.pathname) {
      // Old islands must not normalize the new section's query string.
      event.stopImmediatePropagation();
      void navigate(win.location.href, { pop: true, state: event.state });
    } else {
      sequence++;
      pending = false;
      clearTimeout(loadingTimer);
      gate.status('');
      const url = new URL(win.location.href);
      position(url, event.state, sequence);
      win.queueMicrotask(remember);
    }
  }
  function onScroll() {
    win.cancelAnimationFrame(scrollFrame);
    scrollFrame = win.requestAnimationFrame(() => {
      if (pending || win.location.href !== committedUrl) return;
      saveScroll(win);
      committedState = win.history.state;
    });
  }
  const warm = (path) => {
    // An explicit focus/touch intention is allowed even with data saving enabled.
    void cache.get(path, true).catch(() => {});
  };
  function prefetch() {
    if (!canPrefetch(win.navigator.connection)) return;
    const run = () => {
      if (!canPrefetch(win.navigator.connection)) return;
      for (const path of [...new Set(['/terms/', '/jobs/', '/blog/', ...routes])]) {
        if (path !== win.location.pathname) void cache.get(path).catch(() => {});
      }
    };
    if (win.requestIdleCallback) win.requestIdleCallback(run, { timeout: 2000 });
    else win.setTimeout(run, 200);
  }
  win.addEventListener('popstate', onPop, true);
  win.addEventListener('site:history-change', remember);
  win.addEventListener('hashchange', remember);
  win.addEventListener('scroll', onScroll, { passive: true });
  gate.start((href) => void navigate(href), warm);
  if (doc.readyState === 'complete') prefetch();
  else win.addEventListener('load', prefetch, { once: true });
  return {
    navigate, cache,
    dispose() {
      sequence++;
      clearTimeout(loadingTimer);
      win.cancelAnimationFrame(scrollFrame);
      cleanup();
      win.removeEventListener('popstate', onPop, true);
      win.removeEventListener('site:history-change', remember);
      win.removeEventListener('hashchange', remember);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('load', prefetch);
      win.history.scrollRestoration = previousScrollRestoration;
    },
  };
}

if (typeof window !== 'undefined' && window.siteNavigation) {
  startNavigation().catch(() => {
    window.siteNavigation.status('页面组件加载失败，当前页面已保留。请刷新后重试。', 'startup');
  });
}

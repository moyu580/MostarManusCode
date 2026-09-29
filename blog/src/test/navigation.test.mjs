import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPageCache, canPrefetch, readPage, startNavigation } from '../client/navigation.mjs';
import { installNavigationGate } from '../client/navigation-bootstrap.mjs';
import { NAV_STATE, writeHistory } from '../client/history.mjs';
import { mountBlog } from '../client/page-effects.mjs';

const routes = ['/', '/blog/', '/projects/', '/about/', '/friends/', '/terms/', '/jobs/'];
const manifest = { version: 'test-release', routes: Object.fromEntries(routes.map((path) => [path, []])) };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function html(path, version = manifest.version, extra = '') {
  return `<!doctype html><html><head><title>${path}</title>
    <meta name="description" content="${path}">
    <script id="site-navigation-data" type="application/json">${JSON.stringify({ ...manifest, version })}</script>
    </head><body><header id="site-header"><nav id="main-nav">${routes.map((route) => `<a href="${route}">${route}</a>`).join('')}</nav></header>
    <main id="main-content" data-page-path="${path}"><h1>${path}</h1>${extra}</main>
    <footer>footer</footer><div id="global-search-root"></div><div id="mmw-root">conversation</div>
    <div id="navigation-status" hidden><span data-nav-message></span><button data-nav-retry hidden>Retry</button><button data-nav-refresh hidden>Refresh</button></div></body></html>`;
}
function response(path, version) {
  return { ok: true, headers: new Headers({ 'content-type': 'text/html' }), url: `https://example.com${path}`, text: async () => html(path, version) };
}
function domAt(path = '/') {
  const dom = new JSDOM(html(path), { url: `https://example.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(`(${installNavigationGate})(${JSON.stringify(routes)})`);
  Object.defineProperty(dom.window.navigator, 'connection', { value: { saveData: true } });
  dom.window.scrollTo = ({ top = 0, left = 0 }) => {
    dom.window.scrollY = top;
    dom.window.scrollX = left;
  };
  return dom;
}

it('bounds cache to public paths, deduplicates inflight work, expires and revalidates', async () => {
  let now = 0, calls = 0;
  const pending = deferred();
  const cache = createPageCache({ routes, now: () => now, ttl: 100, load: () => { calls++; return calls === 1 ? pending.promise : 'new'; } });
  const a = cache.get('/terms/');
  const b = cache.get('/terms/', true);
  assert.equal(a, b);
  pending.resolve('old');
  assert.equal(await a, 'old');
  assert.equal(await cache.get('/terms/'), 'old');
  assert.equal(calls, 1);
  now = 101;
  assert.equal(await cache.get('/terms/'), 'new');
  assert.equal(calls, 2);
  await assert.rejects(cache.get('/blog/article/'), /Unsupported/);
});

it('uses two workers, promotes intent, and retries after timeout without accepting late data', async () => {
  const jobs = [], pending = [];
  const cache = createPageCache({ routes, timeout: 60, load: (path, signal) => {
    jobs.push(path);
    const work = deferred();
    pending.push({ ...work, signal });
    return work.promise;
  } });
  const first = cache.get('/terms/');
  const firstFailure = assert.rejects(first, /timed out/);
  const second = cache.get('/jobs/');
  const secondFailure = assert.rejects(second, /timed out/);
  const last = cache.get('/about/');
  const promoted = cache.get('/blog/', true);
  await tick();
  assert.deepEqual(jobs, ['/terms/', '/jobs/']);
  await firstFailure;
  await secondFailure;
  await tick();
  assert.deepEqual(jobs, ['/terms/', '/jobs/', '/blog/', '/about/']);
  assert.ok(pending[0].signal.aborted);
  pending[2].resolve('blog');
  pending[3].resolve('about');
  await Promise.all([last, promoted]);
  const retry = cache.get('/terms/');
  await tick();
  pending[0].resolve('late');
  pending[4].resolve('retry');
  assert.equal(await retry, 'retry');
  assert.equal(await cache.get('/terms/'), 'retry');
});

it('rejects mismatched versions, invalid main paths, and non-HTML response bodies', async () => {
  const dom = domAt();
  const parse = (text) => new dom.window.DOMParser().parseFromString(text, 'text/html');
  assert.throws(() => readPage(parse(html('/terms/', 'next')), '/terms/', manifest), { code: 'VERSION' });
  assert.throws(() => readPage(parse(html('/jobs/')), '/terms/', manifest), /Invalid/);
  const parsed = readPage(parse(html('/jobs/', manifest.version, '<noscript><style>.jobs-switch-row{display:none}</style></noscript><script>throw 1</script>')), '/jobs/', manifest);
  assert.equal(parsed.main.querySelectorAll('noscript,style,script').length, 0);
  const runtime = await startNavigation({ win: dom.window, mountEffects: () => () => {} });
  dom.window.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }) });
  assert.equal(await runtime.navigate('/terms/'), false);
  assert.equal(dom.window.document.querySelector('h1').textContent, '/');
  runtime.dispose();
  dom.window.close();
});

it('head gate queues only the last click and leaves modified, download, article and hash links native', () => {
  const dom = domAt();
  const win = dom.window;
  const received = [];
  win.document.querySelector('a[href="/terms/"]').click();
  win.document.querySelector('a[href="/jobs/"]').click();
  assert.equal(win.location.pathname, '/');
  win.siteNavigation.start((url) => received.push(url), () => {});
  assert.deepEqual(received, ['https://example.com/jobs/']);
  const check = (href, options = {}, attrs = {}) => {
    const link = win.document.createElement('a');
    link.href = href;
    Object.entries(attrs).forEach(([key, value]) => link.setAttribute(key, value));
    win.document.body.append(link);
    const event = new win.MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...options });
    // Check cancellation without allowing jsdom's native navigation task.
    win.document.addEventListener('click', (e) => { event.intercepted = e.defaultPrevented; e.preventDefault(); }, { once: true });
    link.dispatchEvent(event);
    assert.equal(event.intercepted, false);
    link.remove();
  };
  check('/about/', { ctrlKey: true });
  check('/about/', {}, { target: '_blank' });
  check('/about/', {}, { download: '' });
  check('/blog/article/');
  check('#main-content');
  check('https://other.example/');
  dom.window.close();
});

it('holds document, shell and old main during loading; only the latest request commits', async () => {
  const dom = domAt();
  const win = dom.window;
  const first = deferred(), second = deferred();
  win.fetch = (path) => path === '/terms/' ? first.promise : second.promise;
  const mounted = [], disposed = [];
  const runtime = await startNavigation({ win, mountEffects: (main) => {
    mounted.push(main.dataset.pagePath);
    return () => disposed.push(main.dataset.pagePath);
  } });
  const shell = [win.document, win.document.documentElement, win.document.body, win.document.querySelector('header'), win.document.querySelector('footer'), win.document.querySelector('#mmw-root')];
  const main = win.document.querySelector('main');
  const a = runtime.navigate('/terms/?q=ROS#ros');
  const b = runtime.navigate('/jobs/?tab=jobs&page=2');
  await tick();
  assert.equal(win.document.querySelector('main'), main);
  assert.equal(win.location.pathname, '/');
  assert.deepEqual(disposed, []);
  second.resolve(response('/jobs/'));
  assert.equal(await b, true);
  first.resolve(response('/terms/'));
  assert.equal(await a, false);
  assert.equal(win.location.pathname + win.location.search, '/jobs/?tab=jobs&page=2');
  assert.deepEqual(mounted, ['/', '/jobs/']);
  assert.deepEqual(disposed, ['/']);
  assert.deepEqual(shell, [win.document, win.document.documentElement, win.document.body, win.document.querySelector('header'), win.document.querySelector('footer'), win.document.querySelector('#mmw-root')]);
  assert.equal(win.document.querySelector('#main-nav a[aria-current]').getAttribute('href'), '/jobs/');
  assert.equal(win.document.title, '/jobs/');
  assert.equal(win.document.querySelector('meta[name="description"]').content, '/jobs/');
  runtime.dispose();
  assert.deepEqual(disposed, ['/', '/jobs/']);
  dom.window.close();
});

it('timeout, offline, 404, and module failure keep the old main; retry succeeds', async () => {
  for (const failure of ['timeout', 'offline', '404', 'module']) {
    const dom = domAt();
    const win = dom.window;
    if (failure === 'module') {
      const data = win.document.querySelector('#site-navigation-data');
      const payload = JSON.parse(data.textContent);
      payload.routes['/terms/'] = ['/assets/terms-HASH.js'];
      data.textContent = JSON.stringify(payload);
      win.fetch = async () => ({ ...response('/terms/'), text: async () => html('/terms/').replace(JSON.stringify(manifest), JSON.stringify(payload)) });
    } else {
      win.fetch = () => failure === 'timeout' ? new Promise(() => {})
        : failure === 'offline' ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: false, status: 404 });
    }
    let failModule = true;
    const runtime = await startNavigation({
      win, timeout: 35, mountEffects: () => () => {},
      loadModule: async () => { if (failModule) throw new Error('module'); return { prepare: () => () => () => {} }; },
    });
    const main = win.document.querySelector('main');
    assert.equal(await runtime.navigate('/terms/'), false, failure);
    assert.equal(win.document.querySelector('main'), main);
    assert.equal(win.location.pathname, '/');
    assert.equal(win.document.querySelector('[data-nav-retry]').hidden, false);
    await tick();
    failModule = false;
    if (failure !== 'module') win.fetch = async () => response('/terms/');
    assert.equal(await runtime.navigate('/terms/'), true, `${failure}: retry`);
    runtime.dispose();
    dom.window.close();
  }
});

it('new release shows refresh instead of mixing modules or navigating away', async () => {
  const dom = domAt();
  dom.window.fetch = async () => response('/terms/', 'new-release');
  const runtime = await startNavigation({ win: dom.window, mountEffects: () => () => {} });
  assert.equal(await runtime.navigate('/terms/'), false);
  assert.equal(dom.window.document.querySelector('[data-nav-refresh]').hidden, false);
  assert.equal(dom.window.document.querySelector('[data-nav-retry]').hidden, true);
  assert.equal(dom.window.location.pathname, '/');
  runtime.dispose();
  dom.window.close();
});

it('shares history namespace with filters and restores cross-section back/forward and scroll', async () => {
  const dom = domAt();
  const win = dom.window;
  win.fetch = async (path) => response(path);
  const runtime = await startNavigation({ win, mountEffects: () => () => { win.scrollY = 0; } });
  await runtime.navigate('/terms/?category=ROS&page=2');
  writeHistory('push', { page: 3, unrelated: 'kept' }, '/terms/?category=ROS&page=3', win);
  assert.ok(win.history.state[NAV_STATE]);
  win.scrollY = 380;
  await runtime.navigate('/jobs/?tab=jobs&page=2');
  win.history.back();
  await tick();
  await tick();
  await tick();
  assert.equal(win.location.pathname + win.location.search, '/terms/?category=ROS&page=3');
  assert.equal(win.scrollY, 380);
  assert.equal(win.history.state.unrelated, 'kept');
  assert.equal(win.document.querySelector('main').dataset.pagePath, '/terms/');
  win.history.forward();
  await tick();
  await tick();
  assert.equal(win.location.pathname + win.location.search, '/jobs/?tab=jobs&page=2');
  const main = win.document.querySelector('main');
  await runtime.navigate('/jobs/?tab=stack');
  assert.equal(win.document.querySelector('main'), main, 'same-section state changes must not remount');
  runtime.dispose();
  dom.window.close();
});

it('failed history traversal restores the committed URL without adding a history entry', async () => {
  const dom = domAt();
  const win = dom.window;
  win.history.replaceState({ custom: true }, '', '/terms/');
  win.history.pushState({}, '', '/');
  win.fetch = async () => { throw new Error('offline'); };
  const runtime = await startNavigation({ win, mountEffects: () => () => {} });
  const length = win.history.length;
  win.history.back();
  await tick();
  await tick();
  assert.equal(win.location.pathname, '/');
  assert.equal(win.history.length, length);
  assert.equal(win.document.querySelector('main').dataset.pagePath, '/');
  runtime.dispose();
  dom.window.close();
});

it('blog cleanup removes click/history listeners and preserves unrelated history state', () => {
  const dom = domAt('/blog/');
  const win = dom.window;
  const main = win.document.querySelector('main');
  main.innerHTML = '<div id="filters"><button data-filter="debug">debug</button></div><div id="post-grid"><a class="card" data-cat="debug"></a></div><div id="empty-state"></div><div id="filter-result"></div>';
  win.history.replaceState({ custom: 'stay' }, '', win.location.href);
  const dispose = mountBlog(main, win);
  main.querySelector('button').click();
  assert.equal(win.history.state.custom, 'stay');
  assert.ok(win.history.state[NAV_STATE]);
  dispose();
  win.history.replaceState({}, '', '/jobs/?tab=jobs');
  main.querySelector('button').click();
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  assert.equal(win.location.pathname + win.location.search, '/jobs/?tab=jobs');
  dom.window.close();
});

it('does not automatically prefetch on data-saving or 2G connections', () => {
  assert.equal(canPrefetch({ saveData: true, effectiveType: '4g' }), false);
  assert.equal(canPrefetch({ effectiveType: 'slow-2g' }), false);
  assert.equal(canPrefetch({ effectiveType: '2g' }), false);
  assert.equal(canPrefetch({ effectiveType: '4g' }), true);
  assert.equal(canPrefetch(), true);
});

// Run with: playwright-cli run-code --filename src/test/navigation-regression.browser.js
async (page) => {
  const origin = await page.evaluate(() => location.origin);
  const browser = page.context().browser();
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  async function fresh(mobile = false, javaScriptEnabled = true) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, javaScriptEnabled,
    });
    await context.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
      Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
    });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    return { context, tab, errors };
  }
  async function navigate(tab, path) {
    const menu = tab.locator('#nav-toggle');
    const mobile = await menu.isVisible();
    if (mobile && await menu.getAttribute('aria-expanded') !== 'true') await menu.tap();
    const link = tab.locator(`#main-nav a[href="${path}"]`);
    if (mobile) await link.tap();
    else await link.click();
    await tab.waitForFunction((path) => location.pathname === path && document.querySelector('main').dataset.pagePath === path, path);
  }
  async function run(name, callback, mobile = false, javaScriptEnabled = true) {
    const fixture = await fresh(mobile, javaScriptEnabled);
    try {
      const result = await callback(fixture);
      results.push({ name, ...result });
    } catch (error) {
      await fixture.tab.screenshot({ path: `output/playwright/${name}-failure.png` });
      const state = await fixture.tab.evaluate(() => ({
        url: location.href, title: document.title,
        status: document.querySelector('#navigation-status')?.textContent,
        main: document.querySelector('main')?.innerText.slice(0, 300),
      }));
      throw new Error(`${name}: ${error.message}; state: ${JSON.stringify(state)}; errors: ${fixture.errors.join(', ')}; passed: ${results.map((result) => result.name).join(', ')}`);
    } finally { await fixture.context.close(); }
  }
  await run('early-queued-navigation', async ({ tab }) => {
    await tab.route('**/assets/navigation-*.js', async (route) => { await tab.waitForTimeout(1800); await route.continue(); });
    await tab.goto(origin + '/', { waitUntil: 'commit' });
    await tab.locator('#main-nav').waitFor({ state: 'visible' });
    await tab.evaluate(() => { window.__doc = document; });
    await tab.locator('#main-nav a[href="/terms/"]').click();
    await tab.locator('#main-nav a[href="/jobs/"]').click();
    await tab.waitForFunction(() => location.pathname === '/jobs/' && document.querySelector('#jobs-count')?.textContent.includes('第 1'));
    check(await tab.evaluate(() => document === window.__doc), 'early clicks replaced document');
    return { final: await tab.url() };
  });
  await run('offline-retry', async ({ tab, context }) => {
    await tab.goto(origin + '/');
    await context.setOffline(true);
    await tab.locator('#main-nav a[href="/terms/"]').click();
    await tab.locator('[data-nav-retry]').waitFor({ state: 'visible' });
    check(await tab.evaluate(() => location.pathname === '/' && document.querySelector('main').dataset.pagePath === '/'), 'offline lost old page');
    await context.setOffline(false);
    await tab.locator('[data-nav-retry]').click();
    await tab.waitForFunction(() => location.pathname === '/terms/' && document.querySelectorAll('#terms-pagination button').length > 0);
    return { retried: true };
  });
  await run('module-failure-retry', async ({ tab }) => {
    await tab.route('**/assets/terms-*.js', (route) => route.abort('failed'));
    await tab.goto(origin + '/');
    await tab.locator('#main-nav a[href="/terms/"]').click();
    await tab.locator('[data-nav-retry]').waitFor({ state: 'visible' });
    check(await tab.evaluate(() => location.pathname === '/' && document.querySelector('main').dataset.pagePath === '/'), 'module failure removed old page');
    await tab.unroute('**/assets/terms-*.js');
    await tab.locator('[data-nav-retry]').click();
    await tab.waitForFunction(() => location.pathname === '/terms/' && document.querySelectorAll('#terms-pagination button').length > 0);
    return { retried: true };
  });
  await run('new-release', async ({ tab }) => {
    await tab.route('**/terms/', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/"version":"[^"]+"/, '"version":"new-release"') });
    });
    await tab.goto(origin + '/');
    await tab.locator('#main-nav a[href="/terms/"]').click();
    await tab.locator('[data-nav-refresh]').waitFor({ state: 'visible' });
    check(await tab.evaluate(() => location.pathname === '/'), 'version mismatch changed URL');
    return { refreshRequired: true };
  });
  for (const mobile of [false, true]) {
    await run(mobile ? 'mobile-controls-history' : 'desktop-controls-history', async ({ tab }) => {
      const errors = [];
      tab.on('pageerror', (error) => errors.push(error.message));
      await tab.goto(origin + '/');
      await tab.evaluate(() => { window.__shell = [document, document.documentElement, document.body, document.querySelector('#mmw-root')]; });
      await navigate(tab, '/terms/');
      await tab.locator('#ros2 details summary').click();
      await tab.getByRole('button', { name: 'ROS 2 基础', exact: true }).click();
      await tab.getByRole('button', { name: '全部', exact: true }).click();
      check(await tab.locator('#ros2 details').getAttribute('open') !== null, 'category changes reset details');
      await tab.locator('#terms-search').fill('ROS');
      check(await tab.locator('#terms-search').evaluate((node) => node === document.activeElement), 'search lost focus');
      await tab.locator('#terms-search').fill('');
      await tab.getByRole('button', { name: '第 2 页', exact: true }).click();
      await tab.waitForFunction(() => location.search.includes('page=2'));
      await tab.evaluate(() => window.scrollTo({ top: 430, behavior: 'instant' }));
      await tab.waitForTimeout(80);
      const scroll = await tab.evaluate(() => scrollY);
      await navigate(tab, '/jobs/');
      await tab.getByRole('button', { name: '岗位 JD', exact: true }).click();
      await tab.getByRole('button', { name: '第 2 页', exact: true }).click();
      await tab.waitForFunction(() => location.search.includes('tab=jobs') && location.search.includes('page=2'));
      await navigate(tab, '/blog/');
      await tab.locator('[data-filter="debug"]').click();
      await tab.locator('details.rx-filter-more summary').click();
      check(await tab.locator('details.rx-filter-more').getAttribute('open') !== null, 'details did not open');
      await tab.goBack();
      await tab.waitForFunction(() => location.pathname === '/blog/' && !location.search);
      await tab.goBack();
      await tab.waitForFunction(() => location.pathname === '/jobs/' && document.querySelector('#jobs-count')?.textContent.includes('第 2'));
      await tab.goBack();
      await tab.goBack();
      await tab.goBack();
      await tab.waitForFunction(() => location.pathname === '/terms/' && document.querySelector('#terms-count')?.textContent.includes('第 2'));
      await tab.waitForTimeout(200);
      const restoredScroll = await tab.evaluate(() => scrollY);
      check(Math.abs(restoredScroll - scroll) < 4, `cross-section scroll not restored: ${scroll} -> ${restoredScroll}`);
      const main = await tab.evaluateHandle(() => document.querySelector('main'));
      await tab.goBack();
      await tab.waitForFunction(() => !location.search);
      check(await main.evaluate((node) => node === document.querySelector('main')), 'same-section history remounted main');
      await tab.getByRole('button', { name: '打开全站搜索', exact: true }).click();
      await tab.getByPlaceholder('搜索文章、项目和专业术语').fill('求职专栏');
      await tab.getByPlaceholder('搜索文章、项目和专业术语').press('Enter');
      await tab.waitForFunction(() => location.pathname === '/jobs/' && document.querySelector('#jobs-explorer-root'));
      for (const path of ['/projects/', '/about/', '/friends/', '/']) await navigate(tab, path);
      check(await tab.evaluate(() => window.__shell.every((node, index) => node === [document, document.documentElement, document.body, document.querySelector('#mmw-root')][index])), 'shell changed during controls');
      check(errors.length === 0, errors.join(', '));
      return { scrollRestored: scroll, errors };
    }, mobile);
  }
  await run('hash-deeplink-history', async ({ tab }) => {
    await tab.goto(origin + '/terms/#ros2');
    await tab.locator('#ros2').waitFor({ state: 'visible' });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await tab.waitForTimeout(100);
    const previousScroll = await tab.evaluate(() => scrollY);
    await navigate(tab, '/jobs/');
    await tab.goBack();
    await tab.waitForFunction(() => location.pathname === '/terms/' && document.querySelector('#terms-explorer-root'));
    await tab.waitForTimeout(400);
    const restored = await tab.evaluate(() => scrollY);
    check(Math.abs(previousScroll - restored) < 4, `hash history scroll ${previousScroll} -> ${restored}`);
    return { previousScroll, restored };
  });
  await run('ai-request-survives-navigation', async ({ tab }) => {
    let complete;
    const responseReady = new Promise((resolve) => { complete = resolve; });
    await tab.route('**/api/chat/stream', async (route) => {
      await responseReady;
      await route.fulfill({
        status: 200, contentType: 'text/event-stream',
        body: 'event: chatId\ndata: navigation-test\n\nevent: message\ndata: Navigation preserved this reply.\n\nevent: done\ndata: [DONE]\n\n',
      });
    });
    await tab.goto(origin + '/');
    await tab.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await tab.locator('.mmw-input').fill('navigation test');
    await tab.locator('.mmw-send').click();
    await tab.evaluate(() => { window.__assistant = document.querySelector('#mmw-root'); });
    await navigate(tab, '/terms/');
    check(await tab.evaluate(() => document.querySelector('#mmw-root') === window.__assistant && document.querySelector('.mmw-input').disabled), 'AI request or node lost');
    complete();
    await tab.waitForFunction(() => document.querySelector('#mmw-root').textContent.includes('Navigation preserved this reply.') && !document.querySelector('.mmw-input').disabled);
    await tab.locator('.mmw-input').fill('unsent draft');
    await navigate(tab, '/jobs/');
    check(await tab.locator('.mmw-input').inputValue() === 'unsent draft', 'AI draft lost');
    return { responseAndDraftPreserved: true };
  });
  await run('no-javascript', async ({ tab }) => {
    await tab.goto(origin + '/terms/');
    check(await tab.locator('.term-card').count() > 10, 'static terms missing');
    await tab.goto(origin + '/jobs/');
    check(await tab.locator('#jobs-jobs-panel').isVisible(), 'noscript jobs panel missing');
    check(await tab.locator('.job-card').count() > 4, 'static jobs missing');
    return { staticReadable: true };
  }, false, false);
  return results;
}

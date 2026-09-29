// Run with: playwright-cli run-code --filename src/test/navigation.browser.js
// Uses the origin of the already-open preview/production tab.
async (page) => {
  const origin = await page.evaluate(() => location.origin);
  const browser = page.context().browser();
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };

  async function contextFor({ mobile = true, prefetch = false, reduced = false, light = false, javaScriptEnabled = true } = {}) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, colorScheme: light ? 'light' : 'dark',
      reducedMotion: reduced ? 'reduce' : 'no-preference', javaScriptEnabled,
    });
    await context.addInitScript(({ prefetch, light }) => {
      localStorage.setItem('theme', light ? 'light' : 'dark');
      if (!prefetch) Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true });
    }, { prefetch, light });
    return context;
  }
  async function nav(tab, path) {
    if (await tab.locator('#nav-toggle').isVisible() && !(await tab.locator('#main-nav').getAttribute('class')).includes('open')) {
      await tab.locator('#nav-toggle').click();
    }
    await tab.locator(`#main-nav a[href="${path}"]`).click();
  }
  async function ready(tab) {
    await tab.waitForFunction(() => document.querySelector('#global-search-root button') && window.siteNavigation);
  }

  async function transitionCase(name, options = {}) {
    const context = await contextFor(options);
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    const requests = [];
    tab.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }));
    if (options.delayHtml) {
      await tab.route('**/terms/', async (route) => { await tab.waitForTimeout(5500); await route.continue(); });
    }
    if (options.delayModule) {
      await tab.route('**/assets/terms-*.js', async (route) => { await tab.waitForTimeout(1500); await route.continue(); });
    }
    try {
      await tab.goto(origin + '/');
      await ready(tab);
      if (options.prefetch && !options.delayHtml) {
        await tab.waitForFunction(() => {
          const urls = performance.getEntriesByType('resource').map((item) => item.name);
          return ['/terms/', '/jobs/', '/blog/', '/projects/', '/about/', '/friends/']
            .every((path) => urls.includes(location.origin + path)) && urls.some((url) => /\/terms-[A-Z0-9]+\.js$/.test(url));
        });
      }
      await tab.evaluate(() => {
        const nodes = [document, document.documentElement, document.body, document.querySelector('header'), document.querySelector('footer'), document.querySelector('#mmw-root')];
        const old = document.querySelector('main');
        window.__navigationAudit = { frames: [], nodes, old, started: 0, committed: 0, done: false };
        document.addEventListener('click', (event) => {
          if (!event.target.closest('a[href="/terms/"]')) return;
          const audit = window.__navigationAudit;
          audit.started = performance.now();
          const sample = () => {
            const changed = document.querySelector('main') !== old;
            if (changed && !audit.committed) audit.committed = performance.now();
            audit.frames.push({
              at: performance.now() - audit.started, changed,
              oldConnected: old.isConnected,
              shell: nodes.every((node, index) => node === [document, document.documentElement, document.body, document.querySelector('header'), document.querySelector('footer'), document.querySelector('#mmw-root')][index]),
              html: getComputedStyle(document.documentElement).backgroundColor,
              body: getComputedStyle(document.body).backgroundColor,
              overflow: document.documentElement.scrollWidth > innerWidth,
            });
            if (audit.committed && performance.now() - audit.committed > 200) audit.done = true;
            else requestAnimationFrame(sample);
          };
          sample();
        }, { capture: true, once: false });
      });
      const cdp = await context.newCDPSession(tab);
      const frames = [];
      cdp.on('Page.screencastFrame', (frame) => {
        frames.push(frame.data);
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      });
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: options.mobile === false ? 1440 : 390, maxHeight: options.mobile === false ? 1000 : 844, everyNthFrame: 1 });
      await nav(tab, '/terms/');
      if (options.delayHtml || options.delayModule) {
        await tab.waitForTimeout(300);
        check(await tab.evaluate(() => window.__navigationAudit.old.isConnected), `${name}: old main removed while loading`);
        await tab.screenshot({ path: `output/playwright/${name}-waiting.png` });
      }
      await tab.waitForFunction(() => window.__navigationAudit?.done, null, { timeout: 20000 });
      await cdp.send('Page.stopScreencast');
      const audit = await tab.evaluate(() => {
        const a = window.__navigationAudit;
        return {
          elapsed: a.committed - a.started, samples: a.frames.length,
          shellStable: a.frames.every((frame) => frame.shell),
          oldHeld: a.frames.every((frame) => frame.changed || frame.oldConnected),
          dark: a.frames.every((frame) => frame.html === 'rgb(20, 18, 16)' && frame.body === 'rgb(20, 18, 16)'),
          overflow: a.frames.some((frame) => frame.overflow),
          animations: document.querySelector('main').getAnimations().length,
          documents: performance.getEntriesByType('navigation').length,
          loadEnd: performance.getEntriesByType('navigation')[0].loadEventEnd,
          sectionFetchStart: Math.min(...performance.getEntriesByType('resource')
            .filter((entry) => ['/terms/', '/jobs/', '/blog/', '/projects/', '/about/', '/friends/'].includes(new URL(entry.name).pathname))
            .map((entry) => entry.startTime)),
        };
      });
      // Inspect actual captured pixels, including the entire bottom band and both edges.
      const pixels = { frames: frames.length, maxWhiteFraction: 0, maxBottomWhiteFraction: 0 };
      for (let start = 0; start < frames.length; start += 16) {
        const batch = await tab.evaluate(async (encoded) => {
        let maxWhiteFraction = 0, maxBottomWhiteFraction = 0;
        for (const data of encoded) {
          const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
          const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(image.width, image.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const values = ctx.getImageData(0, 0, image.width, image.height).data;
          let white = 0, count = 0, bottomWhite = 0, bottomCount = 0;
          for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
              const bottom = y >= image.height - 24;
              if (!bottom && x >= 4 && x < image.width - 4) continue;
              const i = (y * image.width + x) * 4;
              const bright = values[i] > 235 && values[i + 1] > 235 && values[i + 2] > 235;
              count++;
              if (bright) white++;
              if (bottom) { bottomCount++; if (bright) bottomWhite++; }
            }
          }
          maxWhiteFraction = Math.max(maxWhiteFraction, white / count);
          maxBottomWhiteFraction = Math.max(maxBottomWhiteFraction, bottomWhite / bottomCount);
          image.close();
        }
        return { frames: encoded.length, maxWhiteFraction, maxBottomWhiteFraction };
        }, frames.slice(start, start + 16));
        pixels.maxWhiteFraction = Math.max(pixels.maxWhiteFraction, batch.maxWhiteFraction);
        pixels.maxBottomWhiteFraction = Math.max(pixels.maxBottomWhiteFraction, batch.maxBottomWhiteFraction);
      }
      check(audit.shellStable && audit.oldHeld && !audit.overflow && audit.documents === 1, `${name}: navigation invariant ${JSON.stringify(audit)}`);
      check(options.light || audit.dark, `${name}: canvas changed color`);
      check(options.light || (pixels.frames > 0 && pixels.maxBottomWhiteFraction < 0.05 && pixels.maxWhiteFraction < 0.05), `${name}: white edge pixels ${JSON.stringify(pixels)}`);
      check(!options.reduced || audit.animations === 0, `${name}: reduced motion animated`);
      check(!options.prefetch || options.delayHtml || audit.elapsed <= 200, `${name}: prefetched navigation exceeded 200ms (${audit.elapsed})`);
      check(!options.prefetch || audit.sectionFetchStart >= audit.loadEnd, `${name}: prefetch competed with initial load`);
      check(errors.length === 0, `${name}: ${errors.join(', ')}`);
      check(!requests.some((request) => /\/api\/chat/.test(request.url)), `${name}: prefetch called AI`);
      await tab.screenshot({ path: `output/playwright/${name}-settled.png` });
      results.push({ name, ...audit, pixels, errors, documentRequests: requests.filter((request) => request.type === 'document').length });
    } finally {
      await context.close();
    }
  }

  await transitionCase('mobile-cold');
  await transitionCase('mobile-slow-html', { delayHtml: true });
  await transitionCase('mobile-prefetch-pending', { prefetch: true, delayHtml: true });
  await transitionCase('mobile-slow-module', { delayModule: true });
  await transitionCase('mobile-prefetched', { prefetch: true });
  await transitionCase('desktop-prefetched', { mobile: false, prefetch: true });
  await transitionCase('mobile-reduced', { reduced: true });
  await transitionCase('desktop-light', { mobile: false, light: true });
  return results;
}

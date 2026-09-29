import { writeHistory } from './history.mjs';

export function createPageFrames(win = window) {
  const frames = new Set();
  let active = true;
  const pathname = win.location.pathname;
  return {
    request(callback) {
      if (!active) return;
      const id = win.requestAnimationFrame(() => {
        frames.delete(id);
        if (active && win.location.pathname === pathname) callback();
      });
      frames.add(id);
    },
    dispose() {
      active = false;
      frames.forEach((id) => win.cancelAnimationFrame(id));
      frames.clear();
    },
  };
}

export function scrollResultsIntoView(target) {
  if (!target) return;
  const top = target.getBoundingClientRect().top;
  const header = document.getElementById('site-header')?.getBoundingClientRect().bottom || 0;
  if (top < header || top >= innerHeight) {
    target.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
}

export function mountBlog(main, win = window) {
  const grid = main.querySelector('#post-grid');
  if (!grid) return () => {};
  const buttons = [...main.querySelectorAll('#filters button[data-filter]')];
  const valid = buttons.map((button) => button.dataset.filter);
  const cards = [...grid.querySelectorAll('.card')];
  const empty = main.querySelector('#empty-state');
  const status = main.querySelector('#filter-result');

  function restore() {
    if (win.location.pathname !== '/blog/') return;
    const requested = new URLSearchParams(win.location.search).get('cat') || '';
    const cat = valid.includes(requested) ? requested : '';
    let count = 0;
    for (const card of cards) {
      const show = !cat || card.dataset.cat === cat;
      card.style.display = show ? '' : 'none';
      if (show) count++;
    }
    for (const button of buttons) {
      const active = button.dataset.filter === cat;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    empty.style.display = count ? 'none' : '';
    grid.style.display = count ? '' : 'none';
    status.textContent = !count ? '没有找到符合条件的文章' : cat ? `显示 ${count} 篇文章` : `共 ${count} 篇笔记`;
    const url = cat ? `/blog/?cat=${encodeURIComponent(cat)}` : '/blog/';
    if (win.location.pathname + win.location.search !== url) {
      writeHistory('replace', { cat }, url + win.location.hash, win);
    }
  }
  function click(event) {
    const button = event.target.closest('#filters button[data-filter]');
    if (!button || !main.contains(button)) return;
    const current = new URLSearchParams(win.location.search).get('cat') || '';
    const cat = current === button.dataset.filter ? '' : button.dataset.filter;
    writeHistory('push', { cat }, cat ? `/blog/?cat=${encodeURIComponent(cat)}` : '/blog/', win);
    restore();
  }
  restore();
  main.addEventListener('click', click);
  win.addEventListener('popstate', restore);
  return () => {
    main.removeEventListener('click', click);
    win.removeEventListener('popstate', restore);
  };
}

export function mountPageEffects(main, { soft = false } = {}) {
  const disposers = [mountBlog(main)];
  const profile = main.querySelector('.rx-profile');
  const toggle = profile?.querySelector('.rxp-toggle');
  if (toggle) {
    const onClick = () => {
      const expanded = profile.classList.toggle('rx-profile-details-open');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '收起方向与技能' : '查看方向与技能';
    };
    toggle.addEventListener('click', onClick);
    disposers.push(() => toggle.removeEventListener('click', onClick));
  }
  const agentStatus = main.querySelector('[data-agent-status]');
  if (agentStatus) {
    const controller = new AbortController();
    const label = agentStatus.querySelector('span');
    const dot = main.querySelector('[data-agent-status-dot]');
    const set = (state, text) => {
      if (controller.signal.aborted) return;
      agentStatus.dataset.state = state;
      if (dot) dot.dataset.state = state;
      if (label) label.textContent = text;
    };
    const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(location.hostname);
    let timer;
    if (local || location.protocol === 'file:') {
      set('offline', '部署后检测助手状态');
    } else {
      timer = setTimeout(() => {
        set('offline', '助手暂时离线');
        controller.abort();
      }, 3500);
      fetch('/api/health', { headers: { Accept: 'text/plain' }, cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok || (await response.text()).trim().toLowerCase() !== 'ok') throw new Error('health');
          set('online', '助手在线');
        })
        .catch(() => set('offline', '助手暂时离线'))
        .finally(() => clearTimeout(timer));
    }
    disposers.push(() => { clearTimeout(timer); controller.abort(); });
  }
  // Soft navigation has its own subtle fade; never hide freshly committed content.
  if (!soft && !matchMedia('(prefers-reduced-motion:reduce)').matches && typeof IntersectionObserver === 'function') {
    const elements = [...main.querySelectorAll('.section,.card,.spotlight,.award-card,.rx-profile,.rx-card')];
    const observer = new IntersectionObserver((entries) => {
      for (const item of entries) {
        if (item.isIntersecting) { item.target.classList.add('visible'); observer.unobserve(item.target); }
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    for (const element of elements) { element.classList.add('reveal'); observer.observe(element); }
    const timer = setTimeout(() => elements.forEach((element) => element.classList.add('visible')), 900);
    disposers.push(() => { observer.disconnect(); clearTimeout(timer); });
  }
  return () => disposers.reverse().forEach((dispose) => dispose());
}

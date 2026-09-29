// Serialized into the head: this function must not depend on imported bindings.
export function installNavigationGate(routes) {
  if (window.siteNavigation) return;
  var queued = null;
  var handler = null;
  var warm = null;
  var loadingTimer;
  var startupTimer;
  var retryUrl = null;

  function target(href) {
    try {
      var url = new URL(href, location.href);
      if (url.origin !== location.origin || url.username || url.password) return null;
      if (routes.indexOf(url.pathname) < 0) return null;
      return url;
    } catch (e) { return null; }
  }

  function status(message, kind, url) {
    var node = document.getElementById('navigation-status');
    if (!node) return;
    retryUrl = url || null;
    node.hidden = !message;
    node.querySelector('[data-nav-message]').textContent = message || '';
    node.querySelector('[data-nav-retry]').hidden = kind !== 'error';
    node.querySelector('[data-nav-refresh]').hidden = kind !== 'version' && kind !== 'startup';
  }

  function navigate(href) {
    var url = target(href);
    if (!url) return false;
    if (handler) {
      handler(url.href);
    } else {
      queued = url.href;
      clearTimeout(loadingTimer);
      clearTimeout(startupTimer);
      loadingTimer = setTimeout(function () { status('正在准备页面…', 'loading'); }, 180);
      startupTimer = setTimeout(function () {
        status('页面组件加载失败，当前页面已保留。请刷新后重试。', 'startup');
      }, 15000);
    }
    return true;
  }

  function anchor(event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return null;
    return link;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.target.closest('[data-nav-retry]') && retryUrl) { navigate(retryUrl); return; }
    if (event.target.closest('[data-nav-refresh]')) { location.reload(); return; }
    var link = anchor(event);
    if (!link || link.getAttribute('href').charAt(0) === '#') return;
    var url = target(link.href);
    if (!url) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash && !queued) return;
    event.preventDefault();
    navigate(url.href);
  });

  function intent(event) {
    var link = anchor(event);
    var url = link && target(link.href);
    if (url && warm && url.pathname !== location.pathname) warm(url.pathname);
  }
  document.addEventListener('pointerover', intent, { passive: true });
  document.addEventListener('touchstart', intent, { passive: true });
  document.addEventListener('focusin', intent);

  window.siteNavigation = {
    navigate: navigate,
    status: status,
    start: function (onNavigate, onWarm) {
      handler = onNavigate;
      warm = onWarm;
      clearTimeout(loadingTimer);
      clearTimeout(startupTimer);
      status('');
      var next = queued;
      queued = null;
      if (next) handler(next);
    },
  };
}

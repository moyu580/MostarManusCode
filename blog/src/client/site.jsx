import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Command } from 'cmdk';
import { writeHistory } from './history.mjs';
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  FileText,
  FolderKanban,
  ListTree,
  Search,
  X,
} from 'lucide-react';

const TYPE_META = {
  page: { label: '页面', icon: Compass },
  post: { label: '学习笔记', icon: FileText },
  project: { label: '项目', icon: FolderKanban },
  term: { label: '专业术语', icon: BookOpen },
};

const TYPE_ORDER = ['page', 'post', 'project', 'term'];

function useCodeCopy() {
  useEffect(() => {
    async function handleClick(event) {
      const button = event.target.closest('[data-copy-code]');
      if (!button) return;

      const block = button.closest('.code-block');
      const code = block?.querySelector('pre code');
      if (!code) return;

      const originalLabel = button.textContent;
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        button.textContent = '已复制';
        button.classList.add('is-copied');
      } catch {
        button.textContent = '复制失败';
      }

      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('is-copied');
      }, 1600);
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);
}

function SearchResult({ item, onSelect }) {
  const meta = TYPE_META[item.type] || TYPE_META.page;
  const Icon = meta.icon;

  return (
    <Command.Item
      className="search-command__item"
      value={`${item.type}:${item.title}:${item.href}`}
      keywords={item.keywords || []}
      onSelect={() => onSelect(item.href)}
    >
      <span className="search-command__item-icon" aria-hidden="true">
        <Icon size={17} strokeWidth={1.9} />
      </span>
      <span className="search-command__item-copy">
        <strong>{item.title}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
      <ArrowUpRight className="search-command__item-arrow" size={15} aria-hidden="true" />
    </Command.Item>
  );
}

function GlobalSearchCommand() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useCodeCopy();

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));

    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open || items.length || loading || loadError) return;

    const controller = new AbortController();
    setLoading(true);
    fetch('/search-index.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`search index ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoadError(false);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setLoadError(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open]);

  const groups = useMemo(
    () => TYPE_ORDER.map((type) => ({
      type,
      items: items.filter((item) => item.type === type),
    })).filter((group) => group.items.length),
    [items]
  );

  return (
    <>
      <button
        className="site-search-trigger"
        type="button"
        aria-label="打开全站搜索"
        onClick={() => setOpen(true)}
      >
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <span className="site-search-trigger__label">搜索</span>
        <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="全站搜索"
        className="search-command"
      >
        <div className="search-command__input-row">
          <Search size={19} strokeWidth={2} aria-hidden="true" />
          <Command.Input autoFocus placeholder="搜索文章、项目和专业术语" />
          <button
            className="search-command__close"
            type="button"
            aria-label="关闭搜索"
            onClick={() => setOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <Command.List className="search-command__list">
          {loading ? <Command.Loading className="search-command__state">正在加载搜索索引...</Command.Loading> : null}
          {loadError ? <div className="search-command__state">搜索索引暂时不可用，请稍后重试。</div> : null}
          {!loading && !loadError ? <Command.Empty className="search-command__state">没有找到匹配内容</Command.Empty> : null}
          {groups.map((group) => (
            <Command.Group key={group.type} heading={TYPE_META[group.type].label}>
              {group.items.map((item) => <SearchResult key={`${item.type}:${item.href}`} item={item} onSelect={(href) => {
                setOpen(false);
                if (!window.siteNavigation?.navigate(href)) window.location.assign(href);
              }} />)}
            </Command.Group>
          ))}
        </Command.List>
        <div className="search-command__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </Command.Dialog>
    </>
  );
}

function ArticleNavigator() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const headings = useMemo(
    () => Array.from(document.querySelectorAll('.prose h2[id], .prose h3[id]')).map((heading) => ({
      id: heading.id,
      level: heading.tagName === 'H3' ? 3 : 2,
      text: heading.textContent.trim(),
      element: heading,
    })),
    []
  );

  useEffect(() => {
    if (!headings.length) return undefined;

    let frame = 0;
    function updateActiveHeading() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        let current = headings[0];
        for (const heading of headings) {
          if (heading.element.getBoundingClientRect().top <= 112) current = heading;
          else break;
        }
        setActiveId(current.id);
      });
    }

    updateActiveHeading();
    window.addEventListener('scroll', updateActiveHeading, { passive: true });
    window.addEventListener('resize', updateActiveHeading);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateActiveHeading);
      window.removeEventListener('resize', updateActiveHeading);
    };
  }, [headings]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  if (headings.length < 2) return null;

  function navigateTo(event, heading) {
    event.preventDefault();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    writeHistory('replace', {}, `#${heading.id}`);
    heading.element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    setActiveId(heading.id);
    setOpen(false);
  }

  const links = headings.map((heading) => (
    <a
      key={heading.id}
      className={`article-toc__link article-toc__link--level-${heading.level}${activeId === heading.id ? ' is-active' : ''}`}
      href={`#${heading.id}`}
      aria-current={activeId === heading.id ? 'location' : undefined}
      onClick={(event) => navigateTo(event, heading)}
    >
      {heading.text}
    </a>
  ));

  return (
    <>
      <nav className="article-toc" aria-label="本文目录">
        <div className="article-toc__title"><ListTree size={16} aria-hidden="true" />本文目录</div>
        <div className="article-toc__links">{links}</div>
      </nav>
      <button
        className="article-toc-toggle"
        type="button"
        aria-label={open ? '关闭文章目录' : '打开文章目录'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={19} aria-hidden="true" /> : <ListTree size={19} aria-hidden="true" />}
      </button>
      <div className={`article-toc-mobile${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
        <div className="article-toc-mobile__head">
          <span>本文目录</span>
          <small>{headings.length} 个章节</small>
        </div>
        <nav aria-label="移动端文章目录">{links}</nav>
      </div>
    </>
  );
}

const searchRoot = document.getElementById('global-search-root');
if (searchRoot) createRoot(searchRoot).render(<GlobalSearchCommand />);

const articleNavigatorRoot = document.getElementById('article-navigator-root');
if (articleNavigatorRoot) {
  const root = createRoot(articleNavigatorRoot);
  root.render(<ArticleNavigator />);
  window.addEventListener('site:before-swap', () => root.unmount(), { once: true });
}

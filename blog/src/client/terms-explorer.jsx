import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NAV_STATE, writeHistory } from './history.mjs';
import { createPageFrames, scrollResultsIntoView } from './page-effects.mjs';
import { getCompactPaginationItems, parsePaginationJump } from '../pagination.mjs';
import {
  TERMS_PER_PAGE,
  buildTermsUrl,
  clampTermsPage,
  formatTermsCountText,
  groupGlossarySearchResults,
  parsePageParam,
  resolveHashTarget,
  termIdFromHash,
  termsTotalPages,
} from '../terms.mjs';

function readBootstrap(main) {
  const node = main.querySelector('#terms-data');
  if (!node) return null;
  try {
    const payload = JSON.parse(node.textContent || 'null');
    if (!payload || !Array.isArray(payload.terms)) return null;
    return {
      terms: payload.terms,
      categories: Array.isArray(payload.categories) ? payload.categories : [],
      perPage: Number(payload.perPage) > 0 ? Number(payload.perPage) : TERMS_PER_PAGE,
    };
  } catch {
    return null;
  }
}

function readUrlState(categories) {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const rawCategory = params.get('category') || '';
  const pageInfo = parsePageParam(params.get('page'));

  let category = 'all';
  let normalized = pageInfo.normalized;
  if (rawCategory && !categories.includes(rawCategory)) {
    category = 'all';
    normalized = true;
  } else if (rawCategory) {
    category = rawCategory;
  }

  if (query.trim() && params.has('page')) normalized = true;

  return { query, category, page: pageInfo.page, normalized };
}

function TermCard({ term, glossaryById, pulse, onRelatedClick }) {
  const relatedParts = [];
  (term.related || []).forEach((ref, index) => {
    if (index > 0) relatedParts.push(<span key={`sep-${ref}`}>{', '}</span>);
    const target = glossaryById.get(ref);
    relatedParts.push(
      target ? (
        <a key={ref} href={`#${ref}`} className="term-link" onClick={(event) => onRelatedClick(event, ref)}>
          {target.term}
        </a>
      ) : (
        <span key={ref}>{ref}</span>
      ),
    );
  });

  return (
    <article id={term.id} className={`term-card${pulse ? ' term-card--hash-target animate-pulse' : ''}`}>
      <header className="term-header">
        <h2 className="term-name">{term.term}</h2>
        {(term.aliases || []).length ? (
          <span className="term-aliases">({term.aliases.join('、')})</span>
        ) : null}
        {term.fullName ? <span className="term-fullname">{term.fullName}</span> : null}
      </header>
      <div className="term-body">
        <span className="term-cat badge-cat badge-note">{term.category}</span>
        <p className="term-summary">{term.summary}</p>
        {(term.details || []).length ? (
          <details className="term-details">
            <summary>详细解释</summary>
            <ul>
              {term.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {relatedParts.length ? (
          <div className="term-related">
            <span className="term-label">关联:</span> {relatedParts}
          </div>
        ) : null}
        {(term.articleRefs || []).length ? (
          <div className="term-refs">
            <span className="term-label">相关文章:</span>{' '}
            {term.articleRefs.map((ref, index) => (
              <React.Fragment key={ref}>
                {index > 0 ? ' ' : null}
                <a href={ref}>查看</a>
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Pagination({ page, totalPages, onPageChange, onAnnounce }) {
  const jumpInputRef = useRef(null);

  if (totalPages <= 1) {
    return <nav id="terms-pagination" className="terms-pagination" aria-label="术语分页" hidden />;
  }

  const pageItems = getCompactPaginationItems(page, totalPages);
  const lastPage = pageItems.pop();

  const go = (nextPage) => {
    if (nextPage === page) return;
    onPageChange(nextPage);
  };

  const onJumpSubmit = (event) => {
    event.preventDefault();
    const input = jumpInputRef.current;
    const next = parsePaginationJump(input ? input.value : '', totalPages);
    if (next === null) {
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        input.select();
      }
      onAnnounce(`请输入 1 到 ${totalPages} 的整数页码`);
      return;
    }
    if (input) input.setAttribute('aria-invalid', 'false');
    if (next === page) {
      onAnnounce(`当前已是第 ${next} 页`);
      return;
    }
    go(next);
  };

  const pageButton = (label, target, options = {}) => (
    <button
      type="button"
      className="terms-page-btn"
      data-page={String(target)}
      aria-controls="terms-results"
      aria-label={options.ariaLabel || label}
      disabled={Boolean(options.disabled)}
      aria-current={options.current ? 'page' : undefined}
      onClick={() => {
        if (options.disabled || options.current) return;
        go(target);
      }}
    >
      {label}
    </button>
  );

  return (
    <nav id="terms-pagination" className="terms-pagination" aria-label="术语分页">
      {pageButton('上一页', page - 1, { ariaLabel: '上一页', disabled: page <= 1 })}
      {pageItems.map((item, index) => (
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="terms-page-ellipsis" aria-hidden="true">…</span>
        ) : (
          <React.Fragment key={item}>
            {pageButton(String(item), item, {
              ariaLabel: `第 ${item} 页`,
              current: item === page,
            })}
          </React.Fragment>
        )
      ))}
      <form
        className="terms-page-jump"
        noValidate
        data-total-pages={String(totalPages)}
        aria-label="跳至指定页"
        onSubmit={onJumpSubmit}
      >
        <label className="terms-page-jump-label" htmlFor="terms-page-jump-input">跳至</label>
        <input
          id="terms-page-jump-input"
          ref={jumpInputRef}
          className="terms-page-jump-input"
          type="text"
          inputMode="numeric"
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          pattern="[1-9]\d*"
          placeholder="页码"
          aria-label={`页码，范围 1 至 ${totalPages}`}
          aria-invalid="false"
          onChange={(event) => event.currentTarget.setAttribute('aria-invalid', 'false')}
        />
        <span className="terms-page-jump-suffix" aria-hidden="true">页</span>
        <button type="submit" className="terms-page-btn terms-page-jump-submit" aria-label="跳转到输入页码">
          跳转
        </button>
      </form>
      {pageButton(String(lastPage), lastPage, {
        ariaLabel: `第 ${lastPage} 页（最后一页）`,
        current: lastPage === page,
      })}
      {pageButton('下一页', page + 1, { ariaLabel: '下一页', disabled: page >= totalPages })}
    </nav>
  );
}

function TermsExplorer({ terms, categories, perPage, frames }) {
  const glossaryById = useMemo(() => new Map(terms.map((item) => [item.id, item])), [terms]);
  const initial = useMemo(() => readUrlState(categories), [categories]);
  const [query, setQuery] = useState(initial.query);
  const [category, setCategory] = useState(initial.category);
  const [page, setPage] = useState(initial.page);
  const [pulseId, setPulseId] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const navigationIdRef = useRef(0);
  const stateRef = useRef({ query: initial.query, category: initial.category, page: initial.page });

  const groups = useMemo(
    () => groupGlossarySearchResults(terms, query, category, categories),
    [terms, query, category, categories],
  );
  const isSearch = groups.isSearch;
  const totalPages = isSearch ? 0 : termsTotalPages(groups.results.length, perPage);
  const currentPage = isSearch ? 1 : clampTermsPage(page, totalPages || 1);

  stateRef.current = { query, category, page: currentPage, isSearch };

  const visibleTerms = useMemo(() => {
    if (isSearch) return groups.results;
    const firstIndex = (currentPage - 1) * perPage;
    return groups.results.slice(firstIndex, firstIndex + perPage);
  }, [groups.results, isSearch, currentPage, perPage]);

  const countText = formatTermsCountText({
    isSearch,
    strongest: groups.strongest,
    related: groups.related,
    results: groups.results,
    page: currentPage,
    totalPages: totalPages || 1,
    perPage,
  });

  const announce = useCallback((message) => {
    setAnnouncement(message);
  }, []);

  const resolvePageFor = useCallback((queryValue, categoryValue, requestedPage) => {
    const resultGroup = groupGlossarySearchResults(terms, queryValue, categoryValue, categories);
    const total = resultGroup.isSearch ? 0 : termsTotalPages(resultGroup.results.length, perPage);
    const nextPage = resultGroup.isSearch ? 1 : clampTermsPage(requestedPage, total || 1);
    return { resultGroup, nextPage, isSearch: resultGroup.isSearch };
  }, [terms, categories, perPage]);

  /** 单次状态提交 + 单次历史写入；termId 必须显式传入，避免读到过期 location.hash。 */
  const commitState = useCallback((next, mode, termId = null) => {
    if (location.pathname !== '/terms/') return;
    const resolvedTermId = termId !== null ? termIdFromHash(termId) : termIdFromHash(window.location.hash);
    const { nextPage, isSearch: nextIsSearch } = resolvePageFor(next.query, next.category, next.page);

    setQuery(next.query);
    setCategory(next.category);
    setPage(nextPage);

    if (mode === 'push' || mode === 'replace') {
      const url = buildTermsUrl({
        query: next.query,
        category: next.category,
        page: nextPage,
        isSearch: nextIsSearch,
        termId: resolvedTermId,
      });
      writeHistory(mode, {
        q: next.query,
        category: next.category,
        page: nextPage,
        term: resolvedTermId,
      }, url);
    }
  }, [resolvePageFor]);

  // Pulse cleanup: animationend + timer (reduced-motion keeps the static highlight until timer)
  useEffect(() => {
    if (!pulseId) return undefined;
    const card = document.getElementById(pulseId);
    if (!card) return undefined;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setPulseId((current) => (current === pulseId ? null : current));
    };

    const timer = window.setTimeout(finish, 1250);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!reduced) {
      card.addEventListener('animationend', finish, { once: true });
    }

    return () => {
      finished = true;
      window.clearTimeout(timer);
      card.removeEventListener('animationend', finish);
    };
  }, [pulseId]);

  const highlightAndAnnounce = useCallback((termId, termName) => {
    const navigationId = ++navigationIdRef.current;
    frames.request(() => {
      if (navigationId !== navigationIdRef.current) return;
      const target = document.getElementById(termId);
      if (!target) return;
      target.scrollIntoView({ block: 'start', inline: 'nearest' });

      const siteHeader = document.getElementById('site-header');
      let framesRemaining = 180;
      let previousTop = null;

      const checkAlignment = () => {
        if (navigationId !== navigationIdRef.current || !target.isConnected) return;
        const targetTop = target.getBoundingClientRect().top;
        const headerBottom = siteHeader ? siteHeader.getBoundingClientRect().bottom : 0;
        const aligned = targetTop >= headerBottom - 2 && targetTop <= headerBottom + 10;
        const settled = previousTop !== null && Math.abs(targetTop - previousTop) <= 0.5;
        if ((aligned && settled) || framesRemaining <= 0) {
          setPulseId(termId);
          announce(`已定位到术语：${termName}`);
          return;
        }
        previousTop = targetTop;
        framesRemaining -= 1;
        frames.request(checkAlignment);
      };

      frames.request(checkAlignment);
    });
  }, [announce]);

  const scrollToTerm = useCallback((rawHash, options = {}) => {
    const termId = termIdFromHash(rawHash);
    if (!termId) return false;

    let activeQuery = stateRef.current.query;
    let activeCategory = stateRef.current.category;
    let activePage = stateRef.current.page;
    let { resultGroup } = resolvePageFor(activeQuery, activeCategory, activePage);
    let resolved = resolveHashTarget({
      terms,
      filteredTerms: resultGroup.results,
      termId,
      isSearch: resultGroup.isSearch,
      perPage,
    });

    if (resolved.status === 'invalid' || resolved.status === 'missing') return false;

    let filtersChanged = false;
    if (resolved.status === 'hidden') {
      if (!options.revealHidden) {
        announce('当前筛选已隐藏该术语');
        return false;
      }
      activeQuery = '';
      activeCategory = 'all';
      activePage = 1;
      resultGroup = groupGlossarySearchResults(terms, activeQuery, activeCategory, categories);
      resolved = resolveHashTarget({
        terms,
        filteredTerms: resultGroup.results,
        termId,
        isSearch: resultGroup.isSearch,
        perPage,
      });
      if (resolved.status !== 'ok') return false;
      filtersChanged = true;
    }

    if (!resultGroup.isSearch && resolved.targetPage !== activePage) {
      activePage = resolved.targetPage;
      filtersChanged = true;
    }

    // 关联链接：一次 push；hash 浏览：一次 replace；筛选被揭开/翻页时也只写一次。
    const mode = options.historyMode || (filtersChanged ? 'replace' : null);
    commitState(
      { query: activeQuery, category: activeCategory, page: activePage },
      mode,
      termId,
    );

    if (options.scroll !== false) {
      frames.request(() => {
        highlightAndAnnounce(termId, resolved.term.term);
      });
    }
    return true;
  }, [terms, categories, perPage, announce, commitState, highlightAndAnnounce, resolvePageFor]);

  const onRelatedClick = useCallback((event, ref) => {
    event.preventDefault();
    scrollToTerm(ref, { revealHidden: true, historyMode: 'push' });
  }, [scrollToTerm]);

  useEffect(() => {
    const siteHeader = document.getElementById('site-header');
    const root = document.documentElement;
    const updateHeaderHeight = () => {
      if (siteHeader?.getBoundingClientRect) {
        const height = Math.round(siteHeader.getBoundingClientRect().height);
        if (height > 0) root.style.setProperty('--header-height', `${height}px`);
      }
    };
    updateHeaderHeight();
    let observer;
    let usedFallback = false;
    if (siteHeader && typeof ResizeObserver !== 'undefined') {
      try {
        observer = new ResizeObserver(updateHeaderHeight);
        observer.observe(siteHeader);
      } catch {
        usedFallback = true;
        window.addEventListener('resize', updateHeaderHeight, { passive: true });
      }
    } else {
      usedFallback = true;
      window.addEventListener('resize', updateHeaderHeight, { passive: true });
    }
    return () => {
      if (observer) observer.disconnect();
      if (usedFallback) window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  useEffect(() => {
    const restoreFromUrl = (allowHistoryWrite) => {
      if (location.pathname !== '/terms/') return;
      const next = readUrlState(categories);
      const { nextPage } = resolvePageFor(next.query, next.category, next.page);
      const shouldNormalize = next.normalized || nextPage !== next.page;
      commitState(
        { query: next.query, category: next.category, page: nextPage },
        allowHistoryWrite && shouldNormalize ? 'replace' : null,
        termIdFromHash(window.location.hash),
      );
    };

    restoreFromUrl(true);

    const onPopState = (event) => {
      if (location.pathname !== '/terms/') return;
      restoreFromUrl(true);
      frames.request(() => {
        scrollToTerm(window.location.hash, { revealHidden: false, scroll: !event.state?.[NAV_STATE]?.scroll });
      });
    };
    const onHashChange = () => {
      frames.request(() => {
        scrollToTerm(window.location.hash, { revealHidden: false, historyMode: 'replace' });
      });
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    frames.request(() => {
      scrollToTerm(window.location.hash, { revealHidden: false, historyMode: 'replace', scroll: !frames.restoreScroll });
    });

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [categories, commitState, resolvePageFor, scrollToTerm]);

  const onSearchInput = (event) => {
    commitState({ query: event.target.value, category, page: 1 }, 'replace');
  };

  const onCategoryClick = (nextCategory) => {
    commitState({ query, category: nextCategory, page: 1 }, 'push');
  };

  const onClear = (event) => {
    event.preventDefault();
    commitState({ query: '', category: 'all', page: 1 }, 'push');
  };

  const onPageChange = (nextPage) => {
    commitState({ query, category, page: nextPage }, 'push');
    frames.request(() => {
      const target = document.getElementById('terms-results') || document.getElementById('terms-list');
      scrollResultsIntoView(target);
    });
  };

  const showPrimary = isSearch && groups.strongest.length > 0;
  const showRelated = isSearch && groups.related.length > 0;
  const showPagedList = !isSearch && groups.results.length > 0;
  const showEmpty = groups.results.length === 0;

  const renderCard = (term) => (
    <TermCard
      key={term.id}
      term={term}
      glossaryById={glossaryById}
      pulse={pulseId === term.id}
      onRelatedClick={onRelatedClick}
    />
  );

  // 不重复输出宿主 section 的 id/class，避免 createRoot 后出现重复 id
  return (
    <>
      <h1 className="terms-title">专业术语</h1>
      <p className="terms-intro">面向机器人、ROS 2、导航、语音交互与具身智能学习者的可查询术语参考。</p>

      <div className="terms-search-wrap">
        <label htmlFor="terms-search" className="terms-search-label">搜索术语</label>
        <p id="terms-search-hint" className="terms-search-hint">优先匹配术语名、英文全称和别名；摘要中的命中会显示为“相关内容”。</p>
        <input
          type="search"
          id="terms-search"
          className="terms-search"
          placeholder="优先搜索术语名、英文名或别名"
          autoComplete="off"
          aria-describedby="terms-search-hint terms-count"
          value={query}
          onChange={onSearchInput}
        />
      </div>

      <div id="terms-categories" role="group" aria-label="按分类筛选" className="terms-cats">
        <button
          type="button"
          data-category="all"
          className={category === 'all' ? 'active' : ''}
          aria-pressed={category === 'all'}
          aria-controls="terms-results"
          onClick={() => onCategoryClick('all')}
        >
          全部
        </button>
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            data-category={item}
            className={category === item ? 'active' : ''}
            aria-pressed={category === item}
            aria-controls="terms-results"
            onClick={() => onCategoryClick(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" id="terms-count" className="terms-count">{countText}</div>

      <div id="terms-empty" className="terms-empty" hidden={!showEmpty}>
        <p>未找到匹配术语</p>
        <button type="button" id="terms-clear-btn" className="btn btn-outline" onClick={onClear}>清除筛选</button>
      </div>

      <div id="terms-results" className="terms-results">
        <div id="terms-list" className="terms-grid" hidden={!showPagedList}>
          {showPagedList ? visibleTerms.map(renderCard) : null}
        </div>

        <section id="terms-primary-section" className="terms-search-section" aria-labelledby="terms-primary-title" hidden={!showPrimary}>
          <div className="terms-search-section-head">
            <h2 id="terms-primary-title" className="terms-search-section-title">最强相关术语</h2>
            <p id="terms-primary-copy" className="terms-search-section-copy">按术语名匹配</p>
          </div>
          <div id="terms-primary-list" className="terms-grid">
            {showPrimary ? groups.strongest.map(renderCard) : null}
          </div>
        </section>

        <section id="terms-related-section" className="terms-search-section terms-related-results" aria-labelledby="terms-related-title" hidden={!showRelated}>
          <div className="terms-search-section-head">
            <h2 id="terms-related-title" className="terms-search-section-title">相关内容</h2>
            <p id="terms-related-copy" className="terms-search-section-copy">术语摘要中的相关匹配</p>
          </div>
          <div id="terms-related-list" className="terms-grid">
            {showRelated ? groups.related.map(renderCard) : null}
          </div>
        </section>
      </div>

      <Pagination
        page={currentPage}
        totalPages={isSearch ? 0 : totalPages}
        onPageChange={onPageChange}
        onAnnounce={announce}
      />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </div>
    </>
  );
}

export function prepare(main, { restoreScroll = false } = {}) {
  const bootstrap = readBootstrap(main);
  const rootEl = main.querySelector('#terms-explorer-root');
  if (!bootstrap || !rootEl) throw new Error('Invalid terms page');
  return () => {
    const frames = createPageFrames();
    frames.restoreScroll = restoreScroll;
    const root = createRoot(rootEl);
    flushSync(() => root.render(<TermsExplorer {...bootstrap} frames={frames} />));
    return () => { frames.dispose(); root.unmount(); };
  };
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { writeHistory } from './history.mjs';
import { createPageFrames, scrollResultsIntoView } from './page-effects.mjs';
import { getCompactPaginationItems, parsePaginationJump } from '../pagination.mjs';
import {
  JOBS_PER_PAGE,
  STACK_PER_PAGE,
  buildJobsUrl,
  clampJobsPage,
  jobsTotalPages,
  pageForIndex,
  readJobsUrlState,
} from '../jobs.mjs';

function readBootstrap(main) {
  const node = main.querySelector('#jobs-data');
  if (!node) return null;
  try {
    const payload = JSON.parse(node.textContent || 'null');
    if (!payload || !Array.isArray(payload.techStack) || !Array.isArray(payload.positions)) return null;
    return payload;
  } catch {
    return null;
  }
}

function formatJobsCountText({ tab, count, page, totalPages, perPage }) {
  if (count === 0) return '暂无数据';
  const firstIndex = (page - 1) * perPage;
  const lastIndex = Math.min(firstIndex + perPage, count);
  const noun = tab === 'jobs' ? '个在招岗位' : '项技术栈';
  return `显示 ${firstIndex + 1}–${lastIndex} / 共 ${count} ${noun}，第 ${page} / ${totalPages} 页`;
}

/** 经典拨杆开关:中间滑轨 + 两侧可点板块名。role="switch" 的选中态表示“岗位 JD”板块。 */
function SwitchRow({ tab, onTabChange }) {
  const stackActive = tab === 'stack';
  const flip = () => onTabChange(stackActive ? 'jobs' : 'stack');

  return (
    <div className="jobs-switch-row" role="group" aria-label="求职专栏板块切换">
      <button
        type="button"
        className={`jobs-tab-label${stackActive ? ' active' : ''}`}
        aria-pressed={stackActive}
        onClick={() => onTabChange('stack')}
      >
        技术栈需求
      </button>
      <button
        type="button"
        className={`jobs-toggle${stackActive ? '' : ' is-on'}`}
        role="switch"
        aria-checked={!stackActive}
        aria-label={stackActive ? '切换到岗位 JD 板块' : '切换到技术栈需求板块'}
        onClick={flip}
      >
        <span className="jobs-toggle-knob" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`jobs-tab-label${stackActive ? '' : ' active'}`}
        aria-pressed={!stackActive}
        onClick={() => onTabChange('jobs')}
      >
        岗位 JD
      </button>
    </div>
  );
}

function StackCard({ item, totalPositions, pulse, onRelatedClick }) {
  const relatedLinks = (item.related || []).map((ref, index) => (
    <React.Fragment key={ref}>
      {index > 0 ? <span className="jobs-tag-sep">·</span> : null}
      <a href={`#${ref}`} className="term-link" onClick={(event) => onRelatedClick(event, ref)}>
        {ref}
      </a>
    </React.Fragment>
  ));

  return (
    <article id={item.id} className={`term-card tech-card${pulse ? ' term-card--hash-target animate-pulse' : ''}`}>
      <header className="term-header">
        <span className="tech-rank" aria-hidden="true">{item.rank}</span>
        <h2 className="term-name">{item.name}</h2>
        <span className="term-fullname">{item.category}</span>
      </header>
      <div className="term-body">
        <div className="tech-demand" aria-label={`要求该技术栈的岗位 ${item.count} / ${totalPositions}，占比 ${item.percent}%`}>
          <div className="tech-demand-track" aria-hidden="true">
            <div className="tech-demand-fill" style={{ width: `${item.percent}%` }} />
          </div>
          <span className="tech-demand-text">{item.count} / {totalPositions} · {item.percent}%</span>
        </div>
        <p className="term-summary">{item.summary}</p>
        {relatedLinks.length ? (
          <div className="term-related">
            <span className="term-label">关联:</span> {relatedLinks}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function JobCard({ position }) {
  return (
    <article id={position.id} className="term-card job-card">
      <header className="term-header">
        <h2 className="term-name">{position.title}</h2>
        <span className={`job-tier job-tier--${position.tier === '强推' ? 'strong' : 'ok'}`}>{position.tier}</span>
      </header>
      <div className="term-body">
        <div className="job-company">
          <span className="job-company-name">{position.company}</span>
          <span className="job-score" aria-label={`匹配分 ${position.matchScore}`}>匹配分 {position.matchScore}</span>
        </div>
        <div className="job-meta">
          <span>💰 {position.salary}</span>
          <span>📍 {position.location}</span>
          <span>🎓 {position.degree}</span>
          {position.scale ? <span>🏢 {position.scale}</span> : null}
        </div>
        <p className="term-summary job-jd">{position.jd}</p>
        {(position.stack || []).length ? (
          <div className="term-related job-stack-tags">
            {(position.stack || []).map((name) => (
              <span key={name} className="tag">{name}</span>
            ))}
          </div>
        ) : null}
        <div className="term-refs">
          <a href={position.url} target="_blank" rel="noopener noreferrer">查看原始岗位页 ↗</a>
        </div>
      </div>
    </article>
  );
}

function Pagination({ idPrefix, page, totalPages, onPageChange, onAnnounce }) {
  const jumpInputRef = useRef(null);

  if (totalPages <= 1) {
    return <nav id={`${idPrefix}-pagination`} className="terms-pagination" aria-label="求职专栏分页" hidden />;
  }

  const pageItems = getCompactPaginationItems(page, totalPages);
  const lastPage = pageItems.pop();

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
    onPageChange(next);
  };

  const pageButton = (label, target, options = {}) => (
    <button
      type="button"
      className="terms-page-btn"
      data-page={String(target)}
      aria-controls="jobs-results"
      aria-label={options.ariaLabel || label}
      disabled={Boolean(options.disabled)}
      aria-current={options.current ? 'page' : undefined}
      onClick={() => {
        if (options.disabled || options.current) return;
        onPageChange(target);
      }}
    >
      {label}
    </button>
  );

  return (
    <nav id={`${idPrefix}-pagination`} className="terms-pagination" aria-label="求职专栏分页">
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
        <label className="terms-page-jump-label" htmlFor={`${idPrefix}-page-jump-input`}>跳至</label>
        <input
          id={`${idPrefix}-page-jump-input`}
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

function JobsExplorer({ data, frames }) {
  const { techStack, positions, dataAsOf } = data;
  const stackById = useMemo(() => new Map(techStack.map((item) => [item.id, item])), [techStack]);

  const initial = useMemo(
    () => readJobsUrlState(window.location.search, { stackCount: techStack.length, jobsCount: positions.length }),
    [techStack.length, positions.length],
  );
  const [tab, setTab] = useState(initial.tab);
  const [stackPage, setStackPage] = useState(initial.tab === 'stack' ? initial.page : 1);
  const [jobsPage, setJobsPage] = useState(initial.tab === 'jobs' ? initial.page : 1);
  const [pulseId, setPulseId] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const navigationIdRef = useRef(0);

  const stackTotalPages = jobsTotalPages(techStack.length, STACK_PER_PAGE);
  const jobsTotalPagesCount = jobsTotalPages(positions.length, JOBS_PER_PAGE);
  const totalPages = tab === 'jobs' ? jobsTotalPagesCount : stackTotalPages;
  const page = clampJobsPage(tab === 'jobs' ? jobsPage : stackPage, totalPages);

  const visibleStack = useMemo(() => {
    const firstIndex = (clampJobsPage(stackPage, stackTotalPages) - 1) * STACK_PER_PAGE;
    return techStack.slice(firstIndex, firstIndex + STACK_PER_PAGE);
  }, [techStack, stackPage, stackTotalPages]);

  const visibleJobs = useMemo(() => {
    const firstIndex = (clampJobsPage(jobsPage, jobsTotalPagesCount) - 1) * JOBS_PER_PAGE;
    return positions.slice(firstIndex, firstIndex + JOBS_PER_PAGE);
  }, [positions, jobsPage, jobsTotalPagesCount]);

  const announce = useCallback((message) => {
    setAnnouncement(message);
  }, []);

  /** 单次状态提交 + 单次历史写入。 */
  const commitState = useCallback((nextTab, nextStackPage, nextJobsPage, mode) => {
    if (location.pathname !== '/jobs/') return;
    const nextTotalPages = nextTab === 'jobs' ? jobsTotalPagesCount : stackTotalPages;
    const nextPage = clampJobsPage(nextTab === 'jobs' ? nextJobsPage : nextStackPage, nextTotalPages);

    setTab(nextTab);
    setStackPage(nextTab === 'stack' ? nextPage : nextStackPage);
    setJobsPage(nextTab === 'jobs' ? nextPage : nextJobsPage);

    if (mode === 'push' || mode === 'replace') {
      writeHistory(mode, { tab: nextTab, page: nextPage }, buildJobsUrl({ tab: nextTab, page: nextPage }));
    }
  }, [jobsTotalPagesCount, stackTotalPages]);

  // Pulse cleanup: animationend + timer（与术语页一致）。
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

  const scrollAndPulse = useCallback((targetId, label) => {
    const navigationId = ++navigationIdRef.current;
    frames.request(() => {
      if (navigationId !== navigationIdRef.current) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
      setPulseId(targetId);
      if (label) announce(label);
    });
  }, [announce]);

  const onTabChange = (nextTab) => {
    if (nextTab === tab) return;
    commitState(nextTab, 1, 1, 'push');
    announce(nextTab === 'jobs' ? '已切换到岗位 JD 板块' : '已切换到技术栈需求板块');
    frames.request(() => {
      scrollResultsIntoView(document.getElementById('jobs-results'));
    });
  };

  const onPageChange = (nextPage) => {
    commitState(
      tab,
      tab === 'jobs' ? stackPage : nextPage,
      tab === 'jobs' ? nextPage : jobsPage,
      'push',
    );
    announce(`已切换到第 ${nextPage} 页`);
    frames.request(() => {
      scrollResultsIntoView(document.getElementById('jobs-results'));
    });
  };

  const onStackRelatedClick = useCallback((event, refId) => {
    event.preventDefault();
    const target = stackById.get(refId);
    if (!target) return;
    const targetPage = pageForIndex(techStack.findIndex((item) => item.id === refId), STACK_PER_PAGE);
    const currentPage = clampJobsPage(stackPage, stackTotalPages);
    if (targetPage !== currentPage) {
      commitState('stack', targetPage, jobsPage, 'push');
    }
    scrollAndPulse(refId, `已定位到技术栈：${target.name}`);
  }, [stackById, techStack, stackPage, stackTotalPages, jobsPage, commitState, scrollAndPulse]);

  // URL 状态恢复 + 前进/后退。
  useEffect(() => {
    const restoreFromUrl = (allowHistoryWrite) => {
      if (location.pathname !== '/jobs/') return;
      const next = readJobsUrlState(window.location.search, { stackCount: techStack.length, jobsCount: positions.length });
      commitState(next.tab, next.tab === 'stack' ? next.page : 1, next.tab === 'jobs' ? next.page : 1, allowHistoryWrite && next.normalized ? 'replace' : null);
    };

    restoreFromUrl(true);
    const onPopState = () => restoreFromUrl(true);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [techStack.length, positions.length, commitState]);

  // 同步真实 header 高度到 --header-height（卡片锚点对齐用）。
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

  const countText = formatJobsCountText({
    tab,
    count: tab === 'jobs' ? positions.length : techStack.length,
    page,
    totalPages,
    perPage: tab === 'jobs' ? JOBS_PER_PAGE : STACK_PER_PAGE,
  });

  const stackPanelActive = tab === 'stack';
  const jobsPanelActive = tab === 'jobs';

  return (
    <>
      <div className="jobs-head">
        <div className="jobs-head-copy">
          <h1 className="terms-title">求职专栏</h1>
          <p className="terms-intro">杭州机器人实习求职市场速览：技术栈需求优先级与本科可投岗位 JD 一一对应。</p>
        </div>
        <span className="jobs-asof" role="note" aria-label={`数据截止 ${dataAsOf}`}>
          <span className="jobs-asof-dot" aria-hidden="true" />
          数据截止 {dataAsOf}
        </span>
      </div>

      <SwitchRow tab={tab} onTabChange={onTabChange} />

      <div role="status" aria-live="polite" id="jobs-count" className="terms-count">{countText}</div>

      <div id="jobs-results">
        <section
          id="jobs-stack-panel"
          className="jobs-panel"
          role="tabpanel"
          aria-labelledby="jobs-stack-panel-title"
          hidden={!stackPanelActive}
        >
          <h2 id="jobs-stack-panel-title" className="jobs-panel-title">技术栈需求优先级 <small>按要求的岗位数量排序</small></h2>
          <div className="terms-grid jobs-grid">
            {visibleStack.map((item) => (
              <StackCard
                key={item.id}
                item={item}
                totalPositions={positions.length}
                pulse={pulseId === item.id}
                onRelatedClick={onStackRelatedClick}
              />
            ))}
          </div>
        </section>

        <section
          id="jobs-jobs-panel"
          className="jobs-panel"
          role="tabpanel"
          aria-labelledby="jobs-jobs-panel-title"
          hidden={!jobsPanelActive}
        >
          <h2 id="jobs-jobs-panel-title" className="jobs-panel-title">在招岗位 JD <small>第一梯队（强推）在前，与公司一一对应</small></h2>
          <div className="terms-grid jobs-grid">
            {visibleJobs.map((position) => (
              <JobCard key={position.id} position={position} />
            ))}
          </div>
        </section>
      </div>

      <Pagination
        idPrefix="jobs"
        page={page}
        totalPages={totalPages}
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

export function prepare(main) {
  const bootstrap = readBootstrap(main);
  const rootEl = main.querySelector('#jobs-explorer-root');
  if (!bootstrap || !rootEl) throw new Error('Invalid jobs page');
  return () => {
    const frames = createPageFrames();
    const root = createRoot(rootEl);
    flushSync(() => root.render(<JobsExplorer data={bootstrap} frames={frames} />));
    return () => { frames.dispose(); root.unmount(); };
  };
}

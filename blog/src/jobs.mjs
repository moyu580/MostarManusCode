// 求职专栏共享纯逻辑:构建内联数据校验、URL 状态与分页计算。
// 与 terms.mjs 同层:build.mjs(SSR)与 client/jobs-explorer.jsx(island)共用。
export const STACK_PER_PAGE = 5;
export const JOBS_PER_PAGE = 4;
export const JOBS_TABS = ['stack', 'jobs'];
export const DEFAULT_JOBS_TAB = 'stack';

const ID_PATTERN = /^[a-z0-9_-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function requireFields(entry, fields, label) {
  for (const field of fields) {
    if (!isNonEmptyString(entry[field])) {
      throw new Error(`jobs ${entry.id || '?'}: missing/invalid ${field} (${label})`);
    }
  }
}

/**
 * 校验 jobs.json 内联载荷;任何字段缺失或引用悬空直接抛错,避免构建出坏页。
 * 返回 id 集合供测试与调用方复用。
 */
export function validateJobsData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('jobs data must be an object');
  }
  if (!isNonEmptyString(data.dataAsOf) || !DATE_PATTERN.test(data.dataAsOf)) {
    throw new Error('jobs data: missing/invalid dataAsOf (expected YYYY-MM-DD)');
  }
  if (!Array.isArray(data.techStack) || data.techStack.length === 0) {
    throw new Error('jobs data: techStack must be a non-empty array');
  }
  if (!Array.isArray(data.positions) || data.positions.length === 0) {
    throw new Error('jobs data: positions must be a non-empty array');
  }

  const stackIds = new Set();
  let previousRank = 0;
  for (const item of data.techStack) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('jobs data: every techStack entry must be an object');
    }
    if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) {
      throw new Error(`jobs techStack: missing/invalid id`);
    }
    if (stackIds.has(item.id)) throw new Error(`jobs techStack: duplicate id "${item.id}"`);
    stackIds.add(item.id);

    requireFields(item, ['name', 'category', 'summary'], 'techStack');
    if (!Number.isSafeInteger(item.rank) || item.rank !== previousRank + 1) {
      throw new Error(`jobs techStack ${item.id}: rank must ascend from 1 without gaps`);
    }
    previousRank = item.rank;
    if (!Number.isSafeInteger(item.count) || item.count < 1) {
      throw new Error(`jobs techStack ${item.id}: count must be a positive integer`);
    }
    if (!Number.isSafeInteger(item.percent) || item.percent < 0 || item.percent > 100) {
      throw new Error(`jobs techStack ${item.id}: percent must be 0-100`);
    }
    if (!isStringArray(item.related)) {
      throw new Error(`jobs techStack ${item.id}: related must be an array of ids`);
    }
  }

  for (const item of data.techStack) {
    for (const ref of item.related) {
      if (!stackIds.has(ref)) {
        throw new Error(`jobs techStack ${item.id}: unknown related id "${ref}"`);
      }
    }
  }

  const positionIds = new Set();
  for (const item of data.positions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('jobs data: every position entry must be an object');
    }
    if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) {
      throw new Error(`jobs positions: missing/invalid id`);
    }
    if (positionIds.has(item.id)) throw new Error(`jobs positions: duplicate id "${item.id}"`);
    positionIds.add(item.id);

    requireFields(
      item,
      ['title', 'company', 'salary', 'location', 'degree', 'scale', 'tier', 'jd', 'url'],
      'positions',
    );
    if (!item.url.startsWith('https://')) {
      throw new Error(`jobs positions ${item.id}: url must be https://`);
    }
    if (!Number.isSafeInteger(item.matchScore) || item.matchScore < 0) {
      throw new Error(`jobs positions ${item.id}: matchScore must be a non-negative integer`);
    }
    if (!isStringArray(item.stack)) {
      throw new Error(`jobs positions ${item.id}: stack must be an array of names`);
    }
  }

  return { stackIds, positionIds };
}

/** tab 规范化:非法值回落到默认板块,并标记需要清理 URL。 */
export function normalizeJobsTab(tab) {
  return JOBS_TABS.includes(tab) ? tab : DEFAULT_JOBS_TAB;
}

export function jobsTotalPages(count, perPage) {
  const pageSize = Number(perPage) > 0 ? Number(perPage) : 1;
  return count > 0 ? Math.ceil(count / pageSize) : 1;
}

export function clampJobsPage(page, totalPages) {
  let numericPage = Number(page);
  if (!Number.isSafeInteger(numericPage)) numericPage = 1;
  const total = Math.max(Number(totalPages) || 0, 1);
  return Math.min(Math.max(numericPage, 1), total);
}

/**
 * 板块内页码 URL:
 *   stack 第 1 页 -> /jobs/
 *   stack 第 2 页 -> /jobs/?page=2
 *   jobs  第 1 页 -> /jobs/?tab=jobs
 *   jobs  第 3 页 -> /jobs/?tab=jobs&page=3
 */
export function buildJobsUrl({ tab = DEFAULT_JOBS_TAB, page = 1 } = {}) {
  const normalizedTab = normalizeJobsTab(tab);
  const normalizedPage = clampJobsPage(page, Number.MAX_SAFE_INTEGER);
  const params = new URLSearchParams();
  if (normalizedTab !== DEFAULT_JOBS_TAB) params.set('tab', normalizedTab);
  if (normalizedPage > 1) params.set('page', String(normalizedPage));
  const qs = params.toString();
  return `/jobs/${qs ? `?${qs}` : ''}`;
}

/** 解析 URL 中的板块与页码;normalized 标记输入需要被 replaceState 清理。 */
export function readJobsUrlState(search, { stackCount, jobsCount } = {}) {
  const params = new URLSearchParams(search || '');
  const rawTab = params.get('tab');
  const tab = normalizeJobsTab(rawTab);
  const perPage = tab === 'jobs' ? JOBS_PER_PAGE : STACK_PER_PAGE;
  const totalPages = jobsTotalPages(tab === 'jobs' ? jobsCount : stackCount, perPage);

  let normalized = rawTab !== null && rawTab !== tab;
  const rawPage = params.get('page');
  let page = 1;
  if (rawPage !== null) {
    if (/^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage))) {
      page = clampJobsPage(Number(rawPage), totalPages);
      if (String(page) !== rawPage) normalized = true;
    } else {
      page = 1;
      normalized = true;
    }
  }
  if (tab === DEFAULT_JOBS_TAB && page === 1 && (params.has('tab') || params.has('page'))) {
    normalized = true;
  }

  return { tab, page, normalized };
}

/** 关联标签跳转:目标条目在当前板块列表中的下标 -> 落点页码。 */
export function pageForIndex(index, perPage) {
  const pageSize = Number(perPage) > 0 ? Number(perPage) : 1;
  return Math.floor(index / pageSize) + 1;
}

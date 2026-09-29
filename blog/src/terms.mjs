export const TERMS_PER_PAGE = 10;

export function normalizeTermsText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeTermsFilterState(query, category, validCategories) {
  const categories = validCategories instanceof Set ? validCategories : new Set(validCategories || []);
  const normalizedCategory = typeof category === 'string' && categories.has(category) ? category : 'all';

  return {
    query: typeof query === 'string' ? query.trim() : '',
    category: normalizedCategory,
  };
}

export function getTermNameMatchRank(term, query) {
  const search = normalizeTermsText(query);
  if (!search) return Number.POSITIVE_INFINITY;

  const fieldRank = (value, offset) => {
    const field = normalizeTermsText(value);
    if (!field) return Number.POSITIVE_INFINITY;
    if (field === search) return offset;
    if (field.startsWith(search)) return offset + 1;
    return field.includes(search) ? offset + 2 : Number.POSITIVE_INFINITY;
  };

  return Math.min(
    fieldRank(term?.term, 0),
    fieldRank(term?.fullName, 3),
    ...(term?.aliases || []).map((alias) => fieldRank(alias, 6)),
  );
}

export function matchesGlossaryRelatedContent(term, query) {
  const search = normalizeTermsText(query);
  if (!search) return false;

  const fields = [term?.summary];
  return fields.some((field) => typeof field === 'string' && normalizeTermsText(field).includes(search));
}

export function groupGlossarySearchResults(entries, query, category, validCategories) {
  const state = normalizeTermsFilterState(query, category, validCategories);
  const search = normalizeTermsText(state.query);
  const scopedEntries = entries.filter((term) => state.category === 'all' || term.category === state.category);

  if (!search) {
    return {
      state,
      isSearch: false,
      strongest: [],
      related: [],
      results: scopedEntries,
    };
  }

  const rankedEntries = scopedEntries.map((term, index) => ({
    term,
    index,
    rank: getTermNameMatchRank(term, search),
  }));
  const strongest = rankedEntries
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ term }) => term);
  const strongestIds = new Set(strongest.map((term) => term.id));
  const related = rankedEntries
    .filter(({ term }) => !strongestIds.has(term.id) && matchesGlossaryRelatedContent(term, search))
    .map(({ term }) => term);

  return {
    state,
    isSearch: true,
    strongest,
    related,
    results: [...strongest, ...related],
  };
}

export function filterGlossary(entries, query, category, validCategories) {
  return groupGlossarySearchResults(entries, query, category, validCategories).results;
}

export function termIdFromHash(value) {
  if (typeof value !== 'string') return '';
  let raw = value.charAt(0) === '#' ? value.slice(1) : value;
  if (!raw) return '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return '';
  }
  return /^[a-z0-9_-]+$/.test(raw) ? raw : '';
}

export function parsePageParam(rawPage) {
  if (rawPage === null || rawPage === undefined) return { page: 1, normalized: false };
  const value = String(rawPage);
  if (!/^[1-9]\d*$/.test(value)) return { page: 1, normalized: true };
  const page = Number(value);
  if (!Number.isSafeInteger(page)) return { page: 1, normalized: true };
  return { page, normalized: page === 1 };
}

export function clampTermsPage(page, totalPages) {
  let numericPage = Number(page);
  if (!Number.isSafeInteger(numericPage)) numericPage = 1;
  const total = Math.max(Number(totalPages) || 0, 1);
  return Math.min(Math.max(numericPage, 1), total);
}

export function buildTermsUrl({ query = '', category = 'all', page = 1, isSearch = false, termId = '' } = {}) {
  const params = new URLSearchParams();
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  const normalizedCategory = typeof category === 'string' ? category : 'all';
  const normalizedPage = Number(page) || 1;

  if (trimmedQuery) params.set('q', trimmedQuery);
  if (normalizedCategory && normalizedCategory !== 'all') params.set('category', normalizedCategory);
  if (!isSearch && normalizedPage > 1) params.set('page', String(normalizedPage));

  const qs = params.toString();
  const safeTermId = termIdFromHash(termId || '');
  const hash = safeTermId ? `#${encodeURIComponent(safeTermId)}` : '';
  return `/terms/${qs ? `?${qs}` : ''}${hash}`;
}

/**
 * 解析 hash 目标应落在哪一页 / 是否被筛选隐藏。
 * 卡片 hidden 可能是筛选隐藏或位于另一页，必须以筛选结果为准。
 */
export function resolveHashTarget({ terms = [], filteredTerms = [], termId = '', isSearch = false, perPage = TERMS_PER_PAGE } = {}) {
  const safeId = termIdFromHash(termId);
  if (!safeId) return { status: 'invalid' };

  const term = terms.find((item) => item.id === safeId);
  if (!term) return { status: 'missing' };

  const targetIndex = filteredTerms.findIndex((item) => item.id === safeId);
  if (targetIndex === -1) return { status: 'hidden', term };

  const pageSize = Number(perPage) > 0 ? Number(perPage) : TERMS_PER_PAGE;
  const targetPage = isSearch ? 1 : Math.floor(targetIndex / pageSize) + 1;
  return { status: 'ok', term, targetIndex, targetPage };
}

export function formatTermsCountText({ isSearch = false, strongest = [], related = [], results = [], page = 1, totalPages = 1, perPage = TERMS_PER_PAGE } = {}) {
  const total = results.length;

  if (isSearch) {
    if (total === 0) return '无匹配结果';
    if (strongest.length && related.length) {
      return `找到 ${total} 个结果：${strongest.length} 个术语名匹配，${related.length} 个相关内容`;
    }
    if (strongest.length) return `找到 ${total} 个术语名匹配`;
    return `找到 ${total} 个相关内容（术语名未直接匹配）`;
  }

  if (total === 0) return '无匹配结果';
  const pageSize = Number(perPage) > 0 ? Number(perPage) : TERMS_PER_PAGE;
  const safeTotalPages = Math.max(Number(totalPages) || 1, 1);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), safeTotalPages);
  const firstIndex = (safePage - 1) * pageSize;
  const lastIndex = Math.min(firstIndex + pageSize, total);
  return `显示 ${firstIndex + 1}–${lastIndex} / 共 ${total} 个术语，第 ${safePage} / ${safeTotalPages} 页`;
}

export function termsTotalPages(resultCount, perPage = TERMS_PER_PAGE) {
  const pageSize = Number(perPage) > 0 ? Number(perPage) : TERMS_PER_PAGE;
  return resultCount > 0 ? Math.ceil(resultCount / pageSize) : 1;
}

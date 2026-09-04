/**
 * 为术语页生成紧凑页码。
 * 始终保留前两页、当前页和最后一页，并用 ellipsis 表示中间缺口。
 */
export function getCompactPaginationItems(currentPage, totalPages) {
  const total = Number(totalPages);
  if (!Number.isSafeInteger(total) || total < 1) return [];

  let current = Number(currentPage);
  if (!Number.isSafeInteger(current)) current = 1;
  current = Math.min(Math.max(current, 1), total);

  if (total <= 4) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const visiblePages = [...new Set([1, 2, current, total])]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
  const items = [];

  visiblePages.forEach((page, index) => {
    const previousPage = visiblePages[index - 1];
    if (index > 0 && page - previousPage > 1) items.push('ellipsis');
    items.push(page);
  });

  return items;
}

/**
 * 严格解析页码跳转输入；不接受 0、前导零、小数、指数或越界页码。
 */
export function parsePaginationJump(rawValue, totalPages) {
  const total = Number(totalPages);
  if (!Number.isSafeInteger(total) || total < 1) return null;

  const value = String(rawValue ?? '').trim();
  if (!/^[1-9]\d*$/.test(value)) return null;

  const page = Number(value);
  if (!Number.isSafeInteger(page) || page > total) return null;
  return page;
}

/** 通用客户端分页：纯函数，供表格 / 列表与分页条共用。 */

export interface PageSlice<T> {
  /** 当前页的条目。 */
  items: T[];
  /** 实际生效的页码（已夹到 1..pageCount）。 */
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** 当前页首条在全量中的序号（从 1 起；空列表为 0）。 */
  from: number;
  /** 当前页末条在全量中的序号（空列表为 0）。 */
  to: number;
}

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** 把页码夹到合法范围；非有限数一律回到第 1 页。 */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.trunc(pageSize) : 1;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const effective = clampPage(page, pageCount);
  const start = (effective - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: effective,
    pageCount,
    pageSize: size,
    total,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

export type PageWindowItem = number | "gap";

/**
 * 分页条要显示的页码：首尾页常驻，当前页前后各 `siblings` 页，其余折叠成 "gap"（省略号）。
 * 结果长度固定（页数足够多时恒为 siblings * 2 + 5），翻页时分页条宽度不会跳动；
 * 页数不多时直接全部列出。
 */
export function pageWindow(
  page: number,
  pageCount: number,
  siblings = 1,
): PageWindowItem[] {
  const count = Math.max(1, Math.trunc(pageCount));
  const current = clampPage(page, count);
  // 首、尾、当前 + 两侧邻居 + 两个省略位
  const slots = siblings * 2 + 5;
  if (count <= slots) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  const start = Math.max(
    Math.min(current - siblings, count - siblings * 2 - 2),
    3,
  );
  const end = Math.min(
    Math.max(current + siblings, siblings * 2 + 3),
    count - 2,
  );

  const result: PageWindowItem[] = [1];
  // 紧贴首页时省略位让给第 2 页，保证长度不变
  result.push(start > 3 ? "gap" : 2);
  for (let value = start; value <= end; value += 1) result.push(value);
  result.push(end < count - 2 ? "gap" : count - 1);
  result.push(count);
  return result;
}

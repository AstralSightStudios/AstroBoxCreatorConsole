import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { Button, Select } from "~/components/ScaleAwareThemes";
import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  pageWindow,
  paginate,
  type PageSlice,
} from "~/logic/pagination";

interface UsePaginationOptions {
  /** 初始每页条数，默认 20。 */
  pageSize?: number;
  /**
   * 筛选条件的指纹。它一变，页码自动回到第 1 页——
   * 用「渲染时派生」代替 effect，避免先闪一帧旧页码的空表。
   */
  resetKey?: string;
}

/**
 * 客户端分页状态。数据变少导致页码越界时由 `paginate` 夹回，无需手动处理。
 */
export function usePagination<T>(
  items: readonly T[],
  { pageSize: initialPageSize = 20, resetKey = "" }: UsePaginationOptions = {},
) {
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [state, setState] = useState({ page: 1, key: resetKey });
  const requestedPage = state.key === resetKey ? state.page : 1;

  const slice = useMemo(
    () => paginate(items, requestedPage, pageSize),
    [items, requestedPage, pageSize],
  );
  const setPage = useCallback(
    (page: number) => setState({ page, key: resetKey }),
    [resetKey],
  );
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size);
      setState({ page: 1, key: resetKey });
    },
    [resetKey],
  );

  return { slice, setPage, pageSize, setPageSize };
}

interface PagerProps {
  slice: PageSlice<unknown>;
  onPageChange: (page: number) => void;
  /** 传入后显示「每页 N 条」选择器。 */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  /** 进行批量操作等场景下锁住翻页。 */
  disabled?: boolean;
  className?: string;
}

/** 列表底部分页条：显示区间 + 页码（带省略）+ 每页条数。条目不超过一页且无需调页大小时不渲染。 */
export function Pager({
  slice,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  disabled = false,
  className = "",
}: PagerProps) {
  const smallestOption = pageSizeOptions[0] ?? slice.pageSize;
  const canResize = Boolean(onPageSizeChange);
  if (slice.total === 0) return null;
  if (slice.pageCount <= 1 && (!canResize || slice.total <= smallestOption)) {
    return null;
  }

  const sizes = pageSizeOptions.includes(slice.pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, slice.pageSize].sort((a, b) => a - b);

  return (
    <nav
      aria-label="分页"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-white/55 ${className}`}
    >
      <span>
        显示 {slice.from}–{slice.to} / {slice.total}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">每页</span>
            <Select.Root
              size="1"
              value={String(slice.pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
              disabled={disabled}
            >
              <Select.Trigger variant="soft" color="gray" />
              <Select.Content position="popper">
                {sizes.map((size) => (
                  <Select.Item key={size} value={String(size)}>
                    {size} 条
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </div>
        )}

        {slice.pageCount > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="1"
              variant="soft"
              color="gray"
              aria-label="上一页"
              disabled={disabled || slice.page <= 1}
              onClick={() => onPageChange(slice.page - 1)}
            >
              <CaretLeftIcon size={12} />
            </Button>
            {pageWindow(slice.page, slice.pageCount).map((item, index) =>
              item === "gap" ? (
                <span key={`gap-${index}`} className="px-1 text-white/35">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  size="1"
                  variant={item === slice.page ? "solid" : "soft"}
                  color={item === slice.page ? undefined : "gray"}
                  aria-label={`第 ${item} 页`}
                  aria-current={item === slice.page ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => onPageChange(item)}
                  className="min-w-7"
                >
                  {item}
                </Button>
              ),
            )}
            <Button
              size="1"
              variant="soft"
              color="gray"
              aria-label="下一页"
              disabled={disabled || slice.page >= slice.pageCount}
              onClick={() => onPageChange(slice.page + 1)}
            >
              <CaretRightIcon size={12} />
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}

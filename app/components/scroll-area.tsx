import type { PartialOptions } from "overlayscrollbars";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentProps,
} from "overlayscrollbars-react";

/** 与页面主滚动区（`app/components/transition/page-transition.tsx`）保持一致的滚动条观感。 */
const BASE_SCROLLBARS: PartialOptions["scrollbars"] = {
  theme: "os-theme-light",
  autoHide: "scroll",
  autoHideDelay: 700,
};

/** 纵向滚动，横向裁掉（弹窗、浮层内的列表默认用这个）。 */
export const SCROLL_AREA_OPTIONS: PartialOptions = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: BASE_SCROLLBARS,
};

/** 双向滚动（代码块、宽表格、原始尺寸图片预览等横向会溢出的场景）。 */
export const SCROLL_AREA_HORIZONTAL_OPTIONS: PartialOptions = {
  overflow: { x: "scroll", y: "scroll" },
  scrollbars: BASE_SCROLLBARS,
};

export interface ScrollAreaProps
  extends Omit<OverlayScrollbarsComponentProps, "options"> {
  /** 是否允许横向滚动（默认只纵向）。 */
  horizontal?: boolean;
  /** 覆盖默认配置，优先于 `horizontal`。 */
  options?: PartialOptions;
}

/**
 * 沉浸式（overlay）滚动容器。滚动条浮在内容之上、滚动时出现、静止 700ms 后淡出，
 * 与页面主滚动条同一套样式。高度约束（`max-h-*` / `min-h-0 flex-1`）写在本组件的
 * `className` 上，内层子元素只负责内容排版。
 */
export function ScrollArea({
  horizontal = false,
  options,
  defer = true,
  ...rest
}: ScrollAreaProps) {
  return (
    <OverlayScrollbarsComponent
      defer={defer}
      options={
        options ??
        (horizontal ? SCROLL_AREA_HORIZONTAL_OPTIONS : SCROLL_AREA_OPTIONS)
      }
      {...rest}
    />
  );
}

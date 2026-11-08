import { useEffect, useRef } from "react";

/**
 * 浮层临时历史记录的标记键。
 *
 * Android 系统返回键/返回手势最终是 WebView 的 `history.back()`。如果浮层
 * 打开时不向历史栈压入一条记录，返回会直接退掉当前路由，整个页面连同浮层
 * 一起卸载。这里与导航抽屉、信箱抽屉的做法一致：打开浮层时压入一条带唯一
 * token 的临时记录，返回时只消费它并关闭浮层。
 */
export const OVERLAY_HISTORY_KEY = "__abccOverlayDismiss";

let overlayTokenSequence = 0;

export function getOverlayHistoryToken(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[OVERLAY_HISTORY_KEY];
  return typeof value === "string" && value ? value : null;
}

export function withOverlayHistoryToken(
  state: unknown,
  token: string,
): Record<string, unknown> {
  const base =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)
      : {};
  return { ...base, [OVERLAY_HISTORY_KEY]: token };
}

export function createOverlayHistoryToken(): string {
  overlayTokenSequence += 1;
  return `overlay-${Date.now()}-${overlayTokenSequence}`;
}

/**
 * 让浮层支持系统返回手势/返回键关闭。
 *
 * - `open` 变为 true 时压入一条临时历史记录；
 * - 返回手势触发 `popstate` 时调用 `onDismiss`，只关闭浮层，不回退路由；
 * - 通过 UI（关闭按钮、遮罩、Esc）关闭时，effect 清理会消费掉自己压入的
 *   临时记录，因此下一次返回仍然正常回到上一级页面；
 * - 浮层期间发生路由跳转时，临时记录已被路由替换，清理阶段不会再调用
 *   `history.back()`，避免把刚打开的目标页面退掉。
 *
 * 多个浮层叠加时每条记录都有自己的 token：返回只会关闭最上层浮层；下层
 * 监听器发现当前历史项仍是自己时会保持打开。
 */
export function useOverlayHistoryDismiss(
  open: boolean,
  onDismiss: () => void,
) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const tokenRef = useRef<string | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    // React StrictMode 在开发环境会额外执行一次 mount -> cleanup -> mount。
    // 如果 cleanup 立刻 history.back()，会把第二次 mount 刚压入的记录弹掉。
    // 这里把真正回退延后到下一个事件循环；若紧接着重新 mount 就取消它。
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    let token = tokenRef.current;
    if (!token) {
      token = createOverlayHistoryToken();
      tokenRef.current = token;
      window.history.pushState(
        withOverlayHistoryToken(window.history.state, token),
        "",
      );
    }

    const handlePopState = () => {
      const activeToken = tokenRef.current;
      if (!activeToken) return;
      // 当前历史项仍是自己：说明被返回的是上层浮层的记录，本层继续打开。
      if (getOverlayHistoryToken(window.history.state) === activeToken) {
        return;
      }
      // 系统返回已经消费了临时记录，这里只关闭浮层，不能再触发 back。
      tokenRef.current = null;
      onDismissRef.current();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (cleanupTimerRef.current !== null) {
        window.clearTimeout(cleanupTimerRef.current);
      }
      cleanupTimerRef.current = window.setTimeout(() => {
        cleanupTimerRef.current = null;
        const activeToken = tokenRef.current;
        tokenRef.current = null;
        if (!activeToken) return;
        // UI 主动关闭：只有当前历史项仍是自己写的那条时才回退。
        if (getOverlayHistoryToken(window.history.state) === activeToken) {
          window.history.back();
        }
      }, 0);
    };
  }, [open]);
}

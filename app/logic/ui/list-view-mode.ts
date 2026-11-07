import { useCallback, useEffect, useState } from "react";

export type ListViewMode = "auto" | "table" | "card";
export type ResolvedListView = "table" | "card";

/** 与 Tailwind 的 md 断点对齐：< 768px 视为手机布局。 */
const MOBILE_QUERY = "(max-width: 767px)";

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function readStoredMode(storageKey: string): ListViewMode {
  if (!canUseWindow()) return "auto";
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === "table" || raw === "card") return raw;
  } catch {
    // 本地存储不可用时退回默认行为。
  }
  return "auto";
}

function isMobileViewport(): boolean {
  return canUseWindow() && window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * 列表视图偏好。
 *
 * 卡片优先：auto 与 card 都解析为卡片，只有手动选择 table 才用表格。
 * 手机端始终强制卡片，避免表格再次撑出横向滚动。
 */
export function useListViewMode(storageKey: string) {
  const [mode, setModeState] = useState<ListViewMode>(() =>
    readStoredMode(storageKey),
  );
  const [mobile, setMobile] = useState<boolean>(isMobileViewport);

  useEffect(() => {
    if (!canUseWindow()) return;
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setMode = useCallback(
    (next: ListViewMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // 写入失败只影响下次记忆，不影响本次切换。
      }
    },
    [storageKey],
  );

  const resolved: ResolvedListView = mobile
    ? "card"
    : mode === "table"
      ? "table"
      : "card";

  return { mode, resolved, mobile, setMode };
}

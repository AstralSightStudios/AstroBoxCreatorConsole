/**
 * 定位高亮：把目标元素滚动到视口中央并闪烁两下。
 * 用于「前往修改」类交互——弹窗告知问题后，用户点击按钮应立刻看到是哪一行出了问题。
 */

/**
 * 一次脉冲：行背景由亮到暗淡出，不使用边框或阴影，
 * 避免覆盖行自身的告警边框色（versionCode 未递增的行是红色边框）。
 */
const FLASH_KEYFRAMES: Keyframe[] = [
  {
    offset: 0,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  {
    offset: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
];

const FLASH_DURATION = 500;
const FLASH_ITERATIONS = 2;
/** 弹窗关闭动画与滚动容器布局需要若干帧才稳定，期间重试查找目标。 */
const LOOKUP_RETRIES = 8;
const LOOKUP_INTERVAL = 60;

/** 同一元素重复触发时取消上一段动画，避免叠加。 */
const activeFlashes = new WeakMap<Element, Animation>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 按选择器定位元素并滚动 + 闪烁。元素尚未挂载时会短暂重试。
 */
export function locateAndFlash(selector: string): void {
  let attempts = 0;
  const attempt = () => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) {
      attempts += 1;
      if (attempts < LOOKUP_RETRIES) {
        window.setTimeout(attempt, LOOKUP_INTERVAL);
      }
      return;
    }
    scrollAndFlash(el);
  };
  attempt();
}

/**
 * 滚动到元素并闪烁。已挂载的元素（React ref 拿到的）直接调用，
 * 不需要走选择器重试。
 */
export function scrollAndFlash(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  if (reduced || typeof el.animate !== "function") return;
  activeFlashes.get(el)?.cancel();
  const animation = el.animate(FLASH_KEYFRAMES, {
    duration: FLASH_DURATION,
    iterations: FLASH_ITERATIONS,
    easing: "ease-in-out",
  });
  activeFlashes.set(el, animation);
}

/** 定位并高亮下载配置中的某一行（正式下载与试用下载共用，uid 全局唯一）。 */
export function flashDownloadRow(uid: string | null | undefined): void {
  if (!uid) return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(uid)
      : uid;
  locateAndFlash(`[data-download-row-uid="${escaped}"]`);
}

/** 高亮一组行中的第一行，通常是有问题的那一行。 */
export function flashFirstDownloadRow(
  rows: ReadonlyArray<{ uid: string }> | null | undefined,
): void {
  flashDownloadRow(rows?.[0]?.uid);
}
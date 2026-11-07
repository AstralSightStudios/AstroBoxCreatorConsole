/**
 * 定位高亮：把目标元素滚动到视口中央并闪烁两下。
 * 用于「前往修改」类交互——弹窗告知问题后，用户点击按钮应立刻看到是哪一行出了问题。
 */

import type { PublishFieldKey, PublishValidationIssue } from "./validation";

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
 * 优先用主选择器定位，找不到时退回备选选择器。
 *
 * 每轮重试都会重新判断：步骤切换后媒体区可能还没挂载，此时两个选择器都
 * 找不到，继续等待；挂载后若图片存在就高亮图片本身，否则高亮整个字段。
 */
function locateAndFlashWithFallback(
  primarySelector: string,
  fallbackSelector: string,
): void {
  let attempts = 0;
  const attempt = () => {
    const el =
      document.querySelector(primarySelector) ??
      document.querySelector(fallbackSelector);
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

/** 高亮元素本身；只做动画，不改变滚动位置。 */
function flashElement(el: HTMLElement): void {
  if (prefersReducedMotion() || typeof el.animate !== "function") return;
  activeFlashes.get(el)?.cancel();
  const animation = el.animate(FLASH_KEYFRAMES, {
    duration: FLASH_DURATION,
    iterations: FLASH_ITERATIONS,
    easing: "ease-in-out",
  });
  activeFlashes.set(el, animation);
}

/**
 * 滚动到元素并闪烁。已挂载的元素（React ref 拿到的）直接调用，
 * 不需要走选择器重试。
 */
export function scrollAndFlash(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  flashElement(el);
}

function escapeSelectorValue(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value;
}

/** 定位并高亮下载配置中的某一行（正式下载与试用下载共用，uid 全局唯一）。 */
export function flashDownloadRow(uid: string | null | undefined): void {
  if (!uid) return;
  locateAndFlash(`[data-download-row-uid="${escapeSelectorValue(uid)}"]`);
}

/**
 * 滚动并闪烁到指定表单项。
 *
 * 表单项在切换步骤时是条件渲染的（离开第1 步就卸载），所以这里走带重试的
 * 选择器版本：先把步骤切回去，再由重试等它重新挂载。
 */
export function flashPublishField(field: PublishFieldKey | null | undefined): void {
  if (!field) return;
  locateAndFlash(`[data-publish-field="${field}"]`);
}

/**
 * 定位并高亮预览图列表里的某一张图。
 *
 * 预览图在横向滚动容器里，两步走：先把预览区纵向滚到视口中央，
 * 再把目标图片横向滚到容器中央，最后闪烁图片本身。
 */
export function flashPreviewSlot(previewId: string | null | undefined): void {
  if (!previewId) return;
  const selector = `[data-preview-id="${escapeSelectorValue(previewId)}"]`;
  let attempts = 0;
  const attempt = () => {
    const target = document.querySelector(selector);
    const container = document.querySelector('[data-publish-field="previews"]');
    if (!(target instanceof HTMLElement) || !(container instanceof HTMLElement)) {
      attempts += 1;
      if (attempts < LOOKUP_RETRIES) {
        window.setTimeout(attempt, LOOKUP_INTERVAL);
      }
      return;
    }

    const reduced = prefersReducedMotion();
    container.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });

    const scroller = target.closest<HTMLElement>("[data-preview-scroller]");
    if (scroller) {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const centeredLeft =
        scroller.scrollLeft +
        (targetRect.left - scrollerRect.left) -
        (scroller.clientWidth - targetRect.width) / 2;
      scroller.scrollTo({
        left: Math.max(0, centeredLeft),
        behavior: reduced ? "auto" : "smooth",
      });
    }

    flashElement(target);
  };
  attempt();
}

/**
 * 按校验项定位：单张预览图精确到那张图片；图标/封面优先高亮图片本身
 * （`data-media-image`），未上传时退回整个字段卡片。
 */
export function flashPublishIssue(
  issue: Pick<PublishValidationIssue, "field" | "previewId"> | null | undefined,
): void {
  if (!issue) return;
  if (issue.previewId) {
    flashPreviewSlot(issue.previewId);
    return;
  }
  if (issue.field === "icon" || issue.field === "cover") {
    locateAndFlashWithFallback(
      `[data-media-image="${issue.field}"]`,
      `[data-publish-field="${issue.field}"]`,
    );
    return;
  }
  flashPublishField(issue.field);
}

/** 高亮一组行中的第一行，通常是有问题的那一行。 */
export function flashFirstDownloadRow(
  rows: ReadonlyArray<{ uid: string }> | null | undefined,
): void {
  flashDownloadRow(rows?.[0]?.uid);
}
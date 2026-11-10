/**
 * 审核页图片持久缓存的容量与行为配置。
 *
 * 只有以提交 SHA 定位的 raw 图片才会写入持久缓存；分支引用（`main` 等）
 * 可能随仓库更新而变化，一律不落盘，保证审核看到的就是最新内容。
 */
export interface MediaCacheLimitOption {
  mb: number;
  label: string;
}

/** 缓存容量上限候选；0 表示关闭持久缓存（仍保留会话内内存缓存）。 */
export const MEDIA_CACHE_LIMIT_OPTIONS: MediaCacheLimitOption[] = [
  { mb: 0, label: "关闭缓存" },
  { mb: 256, label: "256 MB" },
  { mb: 512, label: "512 MB" },
  { mb: 1024, label: "1 GB" },
  { mb: 2048, label: "2 GB" },
];

export const DEFAULT_MEDIA_CACHE_LIMIT_MB = 512;

/** 单张图片超过该体积就不写入持久缓存，避免一张巨型动图吃掉整个配额。 */
export const MEDIA_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** 总量超过上限的 105% 时触发淘汰，淘汰到上限的 90%，避免频繁抖动。 */
export const MEDIA_CACHE_TRIM_TRIGGER_RATIO = 1.05;
export const MEDIA_CACHE_TRIM_HEADROOM_RATIO = 0.9;
/** 写入触发的淘汰合并到一次定时任务里，最多每 5 秒检查一次。 */
export const MEDIA_CACHE_TRIM_DEBOUNCE_MS = 5000;

export const MEDIA_CACHE_DB_NAME = "abcc-media-cache";
export const MEDIA_CACHE_DB_VERSION = 1;
export const MEDIA_CACHE_LIMIT_STORAGE_KEY = "ABCC_MEDIA_CACHE_LIMIT_MB_V1";

/**
 * 同时进行的网络图片请求上限。
 *
 * 展示层会在挂载时一次性排队全部图片，但真正在飞的请求限制在 6 个：
 * raw.githubusercontent.com 是 IP 级限流，瞬时几十个并发最容易触发 429。
 */
export const MEDIA_FETCH_CONCURRENCY = 6;

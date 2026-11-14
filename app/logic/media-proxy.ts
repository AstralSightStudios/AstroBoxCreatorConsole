import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { MEDIA_FETCH_CONCURRENCY } from "~/config/mediaCache";
import { refreshGithubQuotas } from "~/logic/account/github-quota-refresh";
import {
  applyGithubRateLimitHeaders,
  getGithubQuota,
  getGithubReaderIdentities,
  getPrimaryGithubIdentity,
  markGithubAccountInvalid,
  pickGithubReadIdentity,
  type GithubRequestIdentity,
} from "~/logic/account/github-tokens";
import {
  GITHUB_RAW_ACCEPT,
  isTauriRuntime,
  rawGithubUrlToApiUrl,
  toProxiedApiUrl,
} from "~/logic/github-raw";
import {
  readPersistedMedia,
  writePersistedMedia,
} from "./media-cache";

interface FetchMediaResponse {
  status: number;
  content_type?: string;
  body_base64: string;
}

interface MediaAttempt {
  label: string;
  url: string;
  headers: Record<string, string>;
  identity?: GithubRequestIdentity;
}

export interface MediaFetchOptions {
  /**
   * 跳过会话内与持久缓存，强制重新下载。
   *
   * 用于「重新检查」以及分支引用（`main` 等）的审核取字节：分支内容可能
   * 随仓库更新而变化，不能拿会话里可能过期的副本做审核结论。
   */
  forceFresh?: boolean;
}

/** 带 HTTP 状态码的图片请求错误，便于上层决定是否切换账号/链路。 */
export class MediaFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MediaFetchError";
    this.status = status;
  }

  get rateLimited(): boolean {
    return this.status === 403 || this.status === 429;
  }
}

const blobUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const REQUEST_TIMEOUT_MS = 30_000;
const QUOTA_REFRESH_INTERVAL_MS = 30_000;

let pinnedReaderLogin: string | null = null;
let lastQuotaRefreshAt = 0;
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function rememberBlobUrl(url: string, blob: Blob, replace: boolean): string {
  if (!replace) {
    const existing = blobUrlCache.get(url);
    if (existing) return existing;
  }
  const blobUrl = URL.createObjectURL(blob);
  blobUrlCache.set(url, blobUrl);
  return blobUrl;
}

function identityKey(identity: GithubRequestIdentity): string {
  return identity.login.trim().toLowerCase();
}

function isIdentityInvalid(identity: GithubRequestIdentity): boolean {
  return Boolean(getGithubQuota(identity.login)?.invalid);
}

function isIdentityQuotaExhausted(identity: GithubRequestIdentity): boolean {
  const quota = getGithubQuota(identity.login);
  if (!quota) return false;
  if (quota.invalid) return true;
  return Boolean(
    quota.coreExhaustedUntil && quota.coreExhaustedUntil > Date.now(),
  );
}

/**
 * 媒体请求固定使用同一个读取账号，避免 raw CDN 的 `Vary: Authorization`
 * 缓存按 token 分片导致的重复回源。读取账号额度耗尽时才换号。
 */
function pickReaderForMedia(): GithubRequestIdentity | null {
  const readers = getGithubReaderIdentities().filter(
    (identity) => !isIdentityInvalid(identity),
  );
  if (readers.length === 0) return null;

  const pinnedLogin = pinnedReaderLogin?.trim().toLowerCase();
  if (pinnedLogin) {
    const pinned = readers.find(
      (identity) => identityKey(identity) === pinnedLogin,
    );
    if (pinned) return pinned;
  }

  // 选号会跳过 core 额度已耗尽的账号；全部耗尽时仍可用它读 raw
  // （raw 不消耗 REST 配额），所以这里退回到第一个有效读取账号。
  const picked =
    pickGithubReadIdentity({ allowPrimaryFallback: false }) ?? readers[0];
  pinnedReaderLogin = picked.login;
  return picked;
}

function authHeaders(identity: GithubRequestIdentity): Record<string, string> {
  return { Authorization: `Bearer ${identity.token}` };
}

function buildGithubAttempts(
  rawUrl: string,
  apiUrl: string,
): MediaAttempt[] {
  const reader = pickReaderForMedia();
  const primary = getPrimaryGithubIdentity();
  const primaryFallback = reader ?? primary;
  if (!primaryFallback) {
    throw new MediaFetchError("未登录 GitHub，无法获取资源内容。");
  }

  const attempts: MediaAttempt[] = [];
  // 桌面端没有 CORS 限制，可以带 Authorization 直接请求 raw CDN；
  // Web 端 raw 的 CORS 预检不允许 Authorization，只能先走 Contents API。
  if (isTauriRuntime()) {
    attempts.push({
      label: `raw:${primaryFallback.login}`,
      url: rawUrl,
      headers: authHeaders(primaryFallback),
      identity: primaryFallback,
    });
  }

  const seen = new Set<string>();
  for (const identity of [reader, primary]) {
    if (!identity) continue;
    const key = identityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isIdentityQuotaExhausted(identity)) continue;
    attempts.push({
      label: `api:${identity.login}`,
      url: apiUrl,
      headers: {
        ...authHeaders(identity),
        Accept: GITHUB_RAW_ACCEPT,
      },
      identity,
    });
  }

  if (attempts.length === 0) {
    throw new MediaFetchError("GitHub 读取额度已用尽，请稍后重试。", 429);
  }
  return attempts;
}

function scheduleQuotaRefresh(): void {
  const now = Date.now();
  if (now - lastQuotaRefreshAt < QUOTA_REFRESH_INTERVAL_MS) return;
  lastQuotaRefreshAt = now;
  void refreshGithubQuotas();
}

async function withMediaSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeFetches >= MEDIA_FETCH_CONCURRENCY) {
    // 队列唤醒时直接接管释放出来的名额，避免并发数在交接瞬间超限。
    await new Promise<void>((resolve) => fetchQueue.push(resolve));
  } else {
    activeFetches += 1;
  }
  try {
    return await task();
  } finally {
    const next = fetchQueue.shift();
    if (next) next();
    else activeFetches -= 1;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new MediaFetchError(message)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchViaTauri(attempt: MediaAttempt): Promise<Blob> {
  let result: FetchMediaResponse;
  try {
    // Tauri invoke 本身没有超时；底层 reqwest 卡住时前端会一直等，
    // 导致图片永远不进入失败态、也无法出现重试入口。
    result = await withTimeout(
      invoke<FetchMediaResponse>("fetch_media", {
        request: { url: attempt.url, headers: attempt.headers },
      }),
      REQUEST_TIMEOUT_MS,
      `图片请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒无响应）`,
    );
  } catch (error) {
    throw new MediaFetchError(
      `图片网络请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.status < 200 || result.status >= 300) {
    throw new MediaFetchError(
      `图片请求失败（HTTP ${result.status}）`,
      result.status,
    );
  }
  if (!result.body_base64) {
    throw new MediaFetchError("图片响应为空", result.status);
  }
  const bytes = base64ToBytes(result.body_base64);
  return new Blob([bytes.buffer as ArrayBuffer], {
    type: result.content_type || "application/octet-stream",
  });
}

async function fetchViaWeb(attempt: MediaAttempt): Promise<Blob> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : null;
  try {
    const response = await fetch(toProxiedApiUrl(attempt.url), {
      headers: attempt.headers,
      signal: controller?.signal,
    });
    if (attempt.identity) {
      applyGithubRateLimitHeaders(
        attempt.identity.login,
        attempt.identity.role,
        response.headers,
      );
    }
    if (!response.ok) {
      throw new MediaFetchError(
        `图片请求失败（HTTP ${response.status}）`,
        response.status,
      );
    }
    return await response.blob();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeAttempt(attempt: MediaAttempt): Promise<Blob> {
  return isTauriRuntime()
    ? fetchViaTauri(attempt)
    : fetchViaWeb(attempt);
}

async function fetchDirectMedia(url: string): Promise<Blob> {
  return executeAttempt({ label: "direct", url, headers: {} });
}

async function fetchGithubMedia(url: string, apiUrl: string): Promise<Blob> {
  const attempts = buildGithubAttempts(url, apiUrl);
  let lastError: unknown;

  for (const [index, attempt] of attempts.entries()) {
    try {
      return await executeAttempt(attempt);
    } catch (error) {
      lastError = error;
      const status = error instanceof MediaFetchError ? error.status : undefined;

      // raw 对「token 失效」也返回 404（不区分内容不存在），所以失败来自
      // raw 且还有降级尝试时继续走 API；API 的 404 才是真的内容不存在。
      const isRawAttempt = attempt.label.startsWith("raw:");
      const hasFallback = index < attempts.length - 1;
      if ((status === 404 || status === 410) && (!isRawAttempt || !hasFallback)) {
        throw error;
      }

      if (status === 401 && attempt.identity) {
        markGithubAccountInvalid(attempt.identity.login);
      }
      if (status === 403 || status === 429) {
        scheduleQuotaRefresh();
      }
      // 网络错误、5xx、鉴权/限流失败都继续尝试下一个账号或链路。
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new MediaFetchError("图片加载失败");
}

async function fetchMediaBlob(url: string): Promise<Blob> {
  const apiUrl = rawGithubUrlToApiUrl(url);
  if (!apiUrl) return fetchDirectMedia(url);
  return fetchGithubMedia(url, apiUrl);
}

export async function fetchProxiedMediaUrl(
  url: string,
  options: MediaFetchOptions = {},
): Promise<string> {
  if (!url) return url;

  const forceFresh = options.forceFresh === true;
  if (!forceFresh) {
    const cached = blobUrlCache.get(url);
    if (cached) return cached;

    const pending = inflight.get(url);
    if (pending) return pending;
  }

  const job = (async () => {
    if (!forceFresh) {
      const persisted = await readPersistedMedia(url);
      if (persisted) return rememberBlobUrl(url, persisted, false);
    }

    const blob = await withMediaSlot(() => fetchMediaBlob(url));
    const objectUrl = rememberBlobUrl(url, blob, forceFresh);
    // 持久缓存是尽力而为的后台写入，不阻塞图片展示。
    void writePersistedMedia(url, blob);
    return objectUrl;
  })();

  if (!forceFresh) inflight.set(url, job);
  try {
    return await job;
  } finally {
    if (!forceFresh) inflight.delete(url);
  }
}

/**
 * 取回代理媒体的 Blob。
 *
 * 与 `fetchProxiedMediaUrl` 共用会话内缓存、IndexedDB 持久缓存、并发队列和
 * GitHub 账号降级链路；调用方需要文件内容而不是 blob URL 时用它。
 */
export async function fetchProxiedMediaBlob(
  url: string,
  options: MediaFetchOptions = {},
): Promise<Blob> {
  if (!url) throw new MediaFetchError("图片地址为空");
  const objectUrl = await fetchProxiedMediaUrl(url, options);
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new MediaFetchError(
      `图片读取失败（HTTP ${response.status}）`,
      response.status,
    );
  }
  return await response.blob();
}

export function useProxiedMediaUrl(url: string | undefined) {
  const [resolved, setResolved] = useState<string>("");
  const lastUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setResolved("");
      lastUrlRef.current = undefined;
      return;
    }
    if (lastUrlRef.current === url && resolved) return;
    lastUrlRef.current = url;
    let cancelled = false;
    fetchProxiedMediaUrl(url)
      .then((next) => {
        if (!cancelled) setResolved(next);
      })
      .catch(() => {
        if (!cancelled) setResolved("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}

export function clearMediaProxyCache() {
  blobUrlCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  blobUrlCache.clear();
}

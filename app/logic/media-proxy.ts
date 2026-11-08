import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshGithubQuotas } from "~/logic/account/github-quota-refresh";
import {
  applyGithubRateLimitHeaders,
  pickGithubReadIdentity,
} from "~/logic/account/github-tokens";
import {
  GITHUB_RAW_ACCEPT,
  isTauriRuntime,
  rawGithubUrlToApiUrl,
  toProxiedApiUrl,
} from "~/logic/github-raw";

interface FetchMediaResponse {
  status: number;
  content_type?: string;
  body_base64: string;
}

const blobUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function fetchProxiedMediaUrl(url: string): Promise<string> {
  if (!url) return url;

  const cached = blobUrlCache.get(url);
  if (cached) return cached;

  const pending = inflight.get(url);
  if (pending) return pending;

  // GitHub raw 链接一律走带鉴权的 Contents API，不再回退匿名 raw CDN；
  // 非 GitHub 链接直接取回（不携带 token，避免泄露到第三方）。
  const apiUrl = rawGithubUrlToApiUrl(url);
  const requestUrl = apiUrl ?? url;
  const headers: Record<string, string> = {};
  // 公开资源优先走读取账号，分摊主账号的内容浏览额度。
  const identity = apiUrl ? pickGithubReadIdentity() : null;
  if (apiUrl) {
    if (!identity) throw new Error("未登录 GitHub，无法获取资源内容。");
    headers.Authorization = `Bearer ${identity.token}`;
    headers.Accept = GITHUB_RAW_ACCEPT;
  }

  const job = (async () => {
    try {
      if (isTauriRuntime()) {
        const result = await invoke<FetchMediaResponse>("fetch_media", {
          request: { url: requestUrl, headers },
        });
        const bytes = base64ToBytes(result.body_base64);
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: result.content_type || "application/octet-stream",
        });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlCache.set(url, blobUrl);
        return blobUrl;
      }

      const response = await fetch(toProxiedApiUrl(requestUrl), { headers });
      if (identity) {
        applyGithubRateLimitHeaders(identity.login, identity.role, response.headers);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(url, blobUrl);
      return blobUrl;
    } catch (error) {
      // Tauri 的 fetch_media 不返回响应头；图片限流时用免费的 /rate_limit
      // 校准一次，让下一次选号跳过已耗尽的读取账号。
      const message = error instanceof Error ? error.message : String(error);
      if (identity && /(?:HTTP |\()(403|429)(?:\)|$)/.test(message)) {
        void refreshGithubQuotas();
      }
      throw error;
    }
  })();

  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
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
        // 鉴权取回失败时不再回退 raw CDN，保持空状态。
        if (!cancelled) setResolved("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}

/**
 * 图片进入视口附近后才请求 Contents API，避免打开资源详情时一次性拉取全部
 * 预览图。元素未挂载或 IntersectionObserver 不可用时回退为立即加载。
 */
export function useLazyProxiedMediaUrl<T extends Element = Element>(
  url: string | undefined,
  options: { rootMargin?: string } = {},
): { ref: (element: T | null) => void; resolvedUrl: string } {
  const [visible, setVisible] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState("");
  const observerRef = useRef<IntersectionObserver | null>(null);
  const rootMargin = options.rootMargin ?? "200px";

  const ref = useCallback(
    (element: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!element || !url || visible) return;
      if (typeof IntersectionObserver === "undefined") {
        setVisible(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin },
      );
      observer.observe(element);
      observerRef.current = observer;
    },
    [url, rootMargin, visible],
  );

  useEffect(() => {
    if (!visible || !url) {
      setResolvedUrl("");
      return;
    }
    let cancelled = false;
    fetchProxiedMediaUrl(url)
      .then((next) => {
        if (!cancelled) setResolvedUrl(next);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, url]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  return { ref, resolvedUrl };
}

export function clearMediaProxyCache() {
  blobUrlCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  blobUrlCache.clear();
}

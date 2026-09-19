import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { loadAccountState } from "~/logic/account/store";
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
  if (apiUrl) {
    const token = loadAccountState().github?.token;
    if (!token) throw new Error("未登录 GitHub，无法获取资源内容。");
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = GITHUB_RAW_ACCEPT;
  }

  const job = (async () => {
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(url, blobUrl);
    return blobUrl;
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

export function clearMediaProxyCache() {
  blobUrlCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  blobUrlCache.clear();
}

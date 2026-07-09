import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { loadAccountState } from "~/logic/account/store";

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

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function authHeader(): Record<string, string> {
  const token = loadAccountState().github?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchProxiedMediaUrl(url: string): Promise<string> {
  if (!url) return url;

  const cached = blobUrlCache.get(url);
  if (cached) return cached;

  const pending = inflight.get(url);
  if (pending) return pending;

  const headers = authHeader();

  const job = (async () => {
    if (inTauri()) {
      const result = await invoke<FetchMediaResponse>("fetch_media", {
        request: { url, headers },
      });
      const bytes = base64ToBytes(result.body_base64);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: result.content_type || "application/octet-stream",
      });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(url, blobUrl);
      return blobUrl;
    }

    const response = await fetch(url, { headers });
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
        if (!cancelled) setResolved(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved || url || "";
}

export function clearMediaProxyCache() {
  blobUrlCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  blobUrlCache.clear();
}

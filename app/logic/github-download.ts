import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { loadAccountState } from "~/logic/account/store";
import {
  GITHUB_RAW_ACCEPT,
  isTauriRuntime,
  rawGithubUrlToApiUrl,
  toProxiedApiUrl,
} from "~/logic/github-raw";

interface AuthTarget {
  url: string;
  headers: Record<string, string>;
}

/**
 * 解析下载目标：审核入口强制 GitHub 登录，因此资源文件一律走带鉴权的
 * Contents API，不提供匿名 raw 回退。
 */
function resolveAuthTarget(rawUrl: string): AuthTarget {
  const apiUrl = rawGithubUrlToApiUrl(rawUrl);
  if (!apiUrl) throw new Error(`不是 GitHub 资源链接，无法鉴权下载：${rawUrl}`);
  const token = loadAccountState().github?.token;
  if (!token) throw new Error("未登录 GitHub，无法下载资源。");
  return {
    url: apiUrl,
    headers: { Authorization: `Bearer ${token}`, Accept: GITHUB_RAW_ACCEPT },
  };
}

/** 去掉路径与非法字符，得到可直接落盘的文件名。 */
export function safeDownloadFileName(fileName: string): string {
  const base = (fileName || "").split("/").pop() || "download";
  return base.replace(/[\\/:*?"<>|]/g, "_") || "download";
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 下载单个 GitHub 资源文件：
 * - Tauri：`download_file` 带鉴权流式写入磁盘（targetDir 为空时弹保存对话框）；
 * - 浏览器：带鉴权取回字节后触发浏览器下载。
 */
export async function downloadGithubRawFile(
  rawUrl: string,
  fileName: string,
  targetDir?: string,
): Promise<void> {
  const target = resolveAuthTarget(rawUrl);
  const name = safeDownloadFileName(fileName);

  if (isTauriRuntime()) {
    const targetPath = targetDir
      ? await join(targetDir, name)
      : await save({ defaultPath: name });
    if (!targetPath) return;
    await invoke("download_file", {
      request: { url: target.url, headers: target.headers, targetPath },
    });
    return;
  }

  const response = await fetch(toProxiedApiUrl(target.url), {
    headers: target.headers,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  triggerBlobDownload(await response.blob(), name);
}

/** 批量下载前选择一个目标目录；返回 null 表示用户取消（仅 Tauri 需要）。 */
export async function pickDownloadDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const result = await open({ directory: true, multiple: false, title: "选择下载目录" });
  if (!result) return null;
  return Array.isArray(result) ? result[0] ?? null : result;
}

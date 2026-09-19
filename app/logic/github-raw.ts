export const RAW_GITHUB_ORIGIN = "https://raw.githubusercontent.com";
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** GitHub Contents API 的 raw 媒体类型：带鉴权直接返回文件原始字节，避免 raw CDN 限流。 */
export const GITHUB_RAW_ACCEPT = "application/vnd.github.raw";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as { __TAURI_INTERNALS__?: unknown })
  );
}

/**
 * 把 `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` 转成
 * GitHub Contents API 地址。仅适用于 ref 为提交 SHA 或单段分支名（不含 `/`）的场景，
 * 即本项目中 `buildRawFileUrl` 生成的所有 raw 链接。
 *
 * 无法识别时返回 null；审核链路的调用方应据此报错，而不是回退到匿名 raw CDN。
 */
export function rawGithubUrlToApiUrl(rawUrl: string): string | null {
  if (!rawUrl.startsWith(`${RAW_GITHUB_ORIGIN}/`)) return null;
  const rest = rawUrl.slice(RAW_GITHUB_ORIGIN.length + 1);
  const segments = rest.split("/");
  if (segments.length < 4) return null;
  const [owner, repo, ref, ...pathParts] = segments;
  const path = pathParts.join("/");
  if (!owner || !repo || !ref || !path) return null;
  return `${GITHUB_API_ORIGIN}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
}

/** Web（非 Tauri）环境把 api.github.com 转成同源代理，规避 CORS。 */
export function toProxiedApiUrl(apiUrl: string): string {
  if (isTauriRuntime()) return apiUrl;
  return apiUrl.startsWith(`${GITHUB_API_ORIGIN}/`)
    ? apiUrl.replace(`${GITHUB_API_ORIGIN}/`, "/github-api/")
    : apiUrl;
}

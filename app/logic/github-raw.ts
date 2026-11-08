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

export interface ParsedRawGithubUrl {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

/**
 * 拆解 `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`。
 * 支持 `refs/heads|tags/{branch}` 形式；分支名本身不含 `/`。
 */
export function parseRawGithubUrl(rawUrl: string): ParsedRawGithubUrl | null {
  if (!rawUrl.startsWith(`${RAW_GITHUB_ORIGIN}/`)) return null;
  const rest = rawUrl.slice(RAW_GITHUB_ORIGIN.length + 1);
  const segments = rest.split("/");
  if (segments.length < 3) return null;
  const [owner, repo, ...tail] = segments;
  let ref = tail[0];
  let pathParts = tail.slice(1);
  if (
    ref === "refs" &&
    (tail[1] === "heads" || tail[1] === "tags") &&
    tail[2] &&
    tail.length >= 3
  ) {
    ref = `refs/${tail[1]}/${tail[2]}`;
    pathParts = tail.slice(3);
  }
  if (!owner || !repo || !ref) return null;
  return {
    owner,
    repo,
    ref,
    path: pathParts.join("/"),
  };
}

/**
 * 把 `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` 转成
 * GitHub Contents API 地址。ref 为提交 SHA 或单段分支名时直接取第三段。
 *
 * 插件市场索引（`AstroBox-NG-Plugin-Repo/index.json`）给出的 repo 是
 * `https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/` 形式，
 * ref 带 `refs/heads/` 前缀且分支名本身不含 `/`。若按单段 ref 解析，会把
 * `heads` 当成路径首段、ref 变成 `refs`，Contents API 返回 404 导致插件图标
 * 全部加载失败。因此这里显式识别 `refs/heads|-tags/{branch}` 前缀。
 *
 * 无法识别时返回 null；审核链路的调用方应据此报错，而不是回退到匿名 raw CDN。
 */
export function rawGithubUrlToApiUrl(rawUrl: string): string | null {
  const parsed = parseRawGithubUrl(rawUrl);
  if (!parsed || !parsed.path) return null;
  return `${GITHUB_API_ORIGIN}/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}?ref=${encodeURIComponent(parsed.ref)}`;
}

function encodeUrlPathPart(part: string): string {
  try {
    // raw URL 里已经是编码后的路径（如 %20），先解码再编码，避免二次转义。
    return encodeURIComponent(decodeURIComponent(part));
  } catch {
    return encodeURIComponent(part);
  }
}

/**
 * 把 raw CDN 地址转成 GitHub 文件页（`/{owner}/{repo}/blob/{ref}/{path}`）。
 *
 * raw 地址在浏览器里只会直接显示图片本身，无法看到文件所在的仓库、提交和
 * 版本信息；审核时“查看源文件”应进入 GitHub 的 blob 页面。无法识别的地址
 * 返回 null，调用方自行回退到原始地址。
 */
export function rawGithubUrlToBlobUrl(rawUrl: string): string | null {
  const parsed = parseRawGithubUrl(rawUrl);
  if (!parsed || !parsed.path) return null;
  const ref = parsed.ref.split("/").map(encodeUrlPathPart).join("/");
  const path = parsed.path.split("/").map(encodeUrlPathPart).join("/");
  return `https://github.com/${encodeUrlPathPart(parsed.owner)}/${encodeUrlPathPart(parsed.repo)}/blob/${ref}/${path}`;
}

/** Web（非 Tauri）环境把 api.github.com 转成同源代理，规避 CORS。 */
export function toProxiedApiUrl(apiUrl: string): string {
  if (isTauriRuntime()) return apiUrl;
  return apiUrl.startsWith(`${GITHUB_API_ORIGIN}/`)
    ? apiUrl.replace(`${GITHUB_API_ORIGIN}/`, "/github-api/")
    : apiUrl;
}

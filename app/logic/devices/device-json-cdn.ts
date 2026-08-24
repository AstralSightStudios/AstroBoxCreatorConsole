/**
 * 设备列表（devices_v2.json）的多源加速下载。
 *
 * 发布资源仓库的设备 JSON 依次从多个源尝试获取，任一源成功即返回：
 *
 * 1. jsDelivr（`cdn.jsdelivr.net` 及 `fastly` / `testingcf` 分流域名）
 * 2. GitHub raw（`raw.githubusercontent.com` 直连）
 * 3. 前缀型代理镜像（与 AstroBox-NG `web/src/logic/githubCdn.ts`
 *    的 `GITHUB_CDN_PREFIXES` 保持一致：GhFast / GhProxy / GhProxyOrg /
 *    GhDdlc / Isteed）
 *
 * 源返回非 2xx、网络错误或响应体不是合法 JSON 时，自动降级到下一个源；
 * 全部失败时抛出最后一次的错误。
 */

/** jsDelivr 域名列表（官方主域 + 常用分流域名）。 */
const JSDELIVR_HOSTS = [
    "https://cdn.jsdelivr.net",
    "https://fastly.jsdelivr.net",
    "https://testingcf.jsdelivr.net",
];

/** 前缀型代理镜像前缀（与 AstroBox-NG githubCdn 的 GITHUB_CDN_PREFIXES 一致）。 */
export const GH_PROXY_PREFIXES = [
    "https://ghfast.top/",
    "https://gh-proxy.com/",
    "https://gh-proxy.org/",
    "https://gh.ddlc.top/",
    "https://cors.isteed.cc/",
] as const;

function encodePathSegments(path: string): string {
    return path
        .split("/")
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

/**
 * 构造按优先级排序的候选 URL 列表：
 * jsDelivr（多域名）→ GitHub raw → 各前缀型代理镜像。
 */
export function buildDeviceJsonSourceUrls(
    owner: string,
    repoName: string,
    ref: string,
    path: string,
): string[] {
    const encodedPath = encodePathSegments(path);
    const jsdelivrTail = `${owner}/${repoName}@${ref}/${encodedPath}`;
    const rawUrl =
        `https://raw.githubusercontent.com/${owner}/${repoName}/${ref}/${encodedPath}`;
    return [
        ...JSDELIVR_HOSTS.map((host) => `${host}/gh/${jsdelivrTail}`),
        rawUrl,
        ...GH_PROXY_PREFIXES.map((prefix) => `${prefix}${rawUrl}`),
    ];
}

async function fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { Accept: "application/json,text/plain,*/*" },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${url}`);
    }
    const text = await response.text();
    if (!text.trim()) {
        throw new Error(`空响应体 ${url}`);
    }
    return text;
}

/**
 * 按 CDN 优先级依次拉取并解析 JSON；某个源失败（网络/HTTP/JSON 解析）时
 * 自动尝试下一个源。全部失败抛出最后一个错误。
 */
export async function fetchDeviceJsonViaCdn<T>(
    owner: string,
    repoName: string,
    ref: string,
    path = "devices_v2.json",
): Promise<T> {
    const urls = buildDeviceJsonSourceUrls(owner, repoName, ref, path);
    let lastError: unknown;
    for (const url of urls) {
        try {
            const text = await fetchText(url);
            return JSON.parse(text) as T;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error("所有设备数据下载源均不可用");
}

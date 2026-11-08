import type { GithubPullFile } from "~/api/github/pr-review";
import type { PrResourcePreview } from "./types";
import type { ResourceRuleCheckResult } from "./rule-checks";

/**
 * 自动检查会拉取仓库文件树、图片元数据，甚至下载并解密包体，单次开销很大。
 * 审核过程中评论、编辑评论、删除评论、刷新时间线等动作都不会改变 PR 内容，
 * 因此按「检查输入」缓存结果，避免这些动作导致检查从头重跑。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 24;

interface CacheEntry {
  at: number;
  result: ResourceRuleCheckResult;
}

const cache = new Map<string, CacheEntry>();

/** token 只用作缓存键的一部分，这里做散列，避免把凭据原文留在内存键里。 */
function hashToken(token?: string): string {
  if (!token) return "";
  let hash = 5381;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) + hash) ^ token.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 缓存键必须覆盖检查依赖的全部输入：
 * - 资源 ID / 仓库 / commit ref：PR 更新后旧结果自动失效；
 * - PR 文件列表签名：零宽字符与乱码扫描依赖 patch 内容；
 * - GitHub 读取账号：换账号可能改变仓库可见范围；
 * - AstroBox 账号：付费比例与 Creator Pro 判定依赖登录态。
 */
export function buildRuleCheckCacheKey(
  resource: PrResourcePreview,
  prFiles: GithubPullFile[],
  token: string,
  astroboxToken?: string,
): string {
  const entry = resource.entry;
  const filesKey = prFiles
    .map((file) => `${file.filename}:${file.sha ?? file.status}`)
    .sort()
    .join("|");
  return [
    entry.id,
    entry.repo_owner,
    entry.repo_name,
    entry.repo_commit_hash || resource.ref,
    resource.originalId ?? "",
    hashToken(token),
    hashToken(astroboxToken),
    filesKey,
  ].join("\n");
}

export function readRuleCheckCache(
  key: string,
  now: number = Date.now(),
): ResourceRuleCheckResult | undefined {
  const cached = cache.get(key);
  if (!cached) return undefined;
  if (now - cached.at >= CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return cached.result;
}

export function writeRuleCheckCache(
  key: string,
  result: ResourceRuleCheckResult,
  now: number = Date.now(),
): void {
  // 重新写入时移动到 Map 末尾，保持「最近使用」的顺序。
  cache.delete(key);
  cache.set(key, { at: now, result });
  while (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

/** 测试与显式清空场景使用；日常「重新检查」只覆盖当前资源的条目。 */
export function clearRuleCheckCache(): void {
  cache.clear();
}

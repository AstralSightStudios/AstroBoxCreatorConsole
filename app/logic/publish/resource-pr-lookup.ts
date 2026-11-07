import { loadRepoEnvId } from "~/config/repoEnv";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
  getPullRequest,
  getRepoCommit,
  searchRepoCommits,
  type GithubCommitInfo,
  type GithubPullFile,
} from "~/api/github/pr-review";
import { getGithubToken } from "./github-actions";
import {
  CATALOG_CSV_COLUMNS,
  CATALOG_CSV_HEADER,
  decodeCatalogContent,
  findCatalogEntryById,
  getFileContent,
  normalizeCatalogEntryForCsv,
  parseCatalogCsv,
  type CatalogEntry,
} from "./catalog";
import { normalizeSubmissionPathSegment } from "./submission-protocol";

export interface ResourceSubmissionLookup {
  resourceId: string;
  entry: CatalogEntry;
  prNumber: number;
  commitSha: string;
  commitUrl?: string;
}

export interface ResourceSubmissionLookupOptions {
  token?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  catalogPath?: string;
  maxCandidates?: number;
}

export interface ResourceSubmissionHistoryEntry {
  number: number;
  commitSha: string;
  committedAt?: string;
  title?: string;
  url?: string;
  mergedAt?: string;
}

export interface ResourceSubmissionHistory {
  /** 按提交时间倒序，同一 PR 只保留最新一条。 */
  entries: ResourceSubmissionHistoryEntry[];
  /** false 表示到达分页上限，可能还有更早的记录没有取到。 */
  complete: boolean;
  searchedPages: number;
}

export interface ResourceSubmissionHistoryOptions {
  token?: string;
  owner?: string;
  repo?: string;
  /** 只关心晚于该时间的提交；用于从目标 PR 之后开始统计。 */
  until?: string;
  /** 找到该 PR 后，处理完当前页就停止继续翻页。 */
  stopAfterPrNumber?: number;
  maxPages?: number;
  fetchTitles?: boolean;
  maxTitleFetches?: number;
}

export interface ResourceSubmissionHistorySplit {
  latest?: ResourceSubmissionHistoryEntry;
  target?: ResourceSubmissionHistoryEntry;
  /** 本次回查 PR 之前的上一个资源 PR，用于“回退后状态来源”展示。 */
  targetSource?: ResourceSubmissionHistoryEntry;
  /** 目标 PR 之后、当前最新之前已经合入的 PR。 */
  crossedPrs: ResourceSubmissionHistoryEntry[];
  targetIndex: number;
}

interface ResourceLookupCacheKeyParams {
  owner: string;
  repo: string;
  entry: CatalogEntry;
}

const lookupCache = new Map<string, Promise<ResourceSubmissionLookup>>();

function normalizeId(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

/** 目录行按写入格式归一，`free` 与空 paid_type 视为同一行。 */
export function catalogRowKey(entry: CatalogEntry) {
  const normalized = normalizeCatalogEntryForCsv(entry);
  return CATALOG_CSV_COLUMNS.map((column) => normalized[column] ?? "").join(",");
}

/**
 * 社区仓库 Action 的提交信息里的 tmp 路径使用提交协议归一化后的仓库名。
 * 目录里历史行可能大小写不一致，先按协议归一；失败再退回小写原值。
 */
export function submissionSearchTerm(entry: CatalogEntry) {
  const raw = entry.repo_name?.trim() ?? "";
  if (!raw) return "";
  try {
    return normalizeSubmissionPathSegment(raw, "仓库名");
  } catch {
    return raw
      .toLowerCase()
      .replace(/[\u0000-\u001f\u007f]/g, "");
  }
}

/** 从资源提交/合入提交信息提取 PR 序号；回退提交与人工提交不当作资源来源。 */
export function extractPrNumberFromSubmissionCommitMessage(
  message: string | undefined,
) {
  const firstLine = (message ?? "").split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine || /^revert\b/i.test(firstLine)) return undefined;

  const patterns = [
    /\bapply resource submission from pr\s*#(\d+)/i,
    /\bmerge pull request\s*#(\d+)/i,
    /\(#(\d+)\)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = firstLine.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) return number;
  }
  return undefined;
}

function isCatalogFile(filename: string | undefined) {
  if (!filename) return false;
  return (
    filename === PUBLISH_CONFIG.catalogFilePath ||
    filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
  );
}

function patchLines(patch: string | undefined) {
  if (!patch) return [];
  return patch.split(/\r?\n/);
}

/**
 * 在提交的 index_v2.csv patch 中寻找「新增行 = 当前目录行」的目标资源。
 * 只检查目标 ID 的 `+` 行，不解析整份目录。
 */
export function findMatchingAddedCatalogEntry(
  files: ReadonlyArray<Pick<GithubPullFile, "filename" | "patch">>,
  target: CatalogEntry,
) {
  const targetId = normalizeId(target.id);
  const targetKey = catalogRowKey(target);

  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    for (const line of patchLines(file.patch)) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const row = line.slice(1).trim();
      if (!row || row === CATALOG_CSV_HEADER) continue;

      const parsed = parseCatalogCsv(`${CATALOG_CSV_HEADER}\n${row}`)[0];
      if (!parsed || normalizeId(parsed.id) !== targetId) continue;
      if (catalogRowKey(parsed) !== targetKey) continue;
      return parsed;
    }
  }
  return undefined;
}

function buildCacheKey(params: ResourceLookupCacheKeyParams) {
  return [
    loadRepoEnvId(),
    params.owner.toLowerCase(),
    params.repo.toLowerCase(),
    normalizeId(params.entry.id),
    catalogRowKey(params.entry),
  ].join("\u0000");
}

async function resolveResourceSubmissionPr(
  resourceId: string,
  options?: ResourceSubmissionLookupOptions,
): Promise<ResourceSubmissionLookup> {
  const token = options?.token ?? getGithubToken();
  if (!token) throw new Error("请先登录 GitHub 账号。");

  const owner = options?.owner ?? PUBLISH_CONFIG.targetPrRepoOwner;
  const repo = options?.repo ?? PUBLISH_CONFIG.targetPrRepoName;
  const branch = options?.branch ?? PUBLISH_CONFIG.defaultBranch;
  const catalogPath = options?.catalogPath ?? PUBLISH_CONFIG.catalogFilePath;
  const maxCandidates = Math.max(
    1,
    Math.min(10, Math.trunc(options?.maxCandidates ?? 8)),
  );

  const currentFile = await getFileContent(
    token,
    owner,
    repo,
    catalogPath,
    branch,
  );
  const currentEntries = parseCatalogCsv(
    decodeCatalogContent(currentFile.content),
  );
  const current = findCatalogEntryById(currentEntries, resourceId);
  if (!current) {
    throw new Error(`当前目录中未找到资源 ID「${resourceId}」。`);
  }

  const term = submissionSearchTerm(current);
  if (!term) {
    throw new Error(
      `资源「${current.name || current.id}」缺少资源仓库名，无法反查对应 PR。`,
    );
  }

  const cacheKey = buildCacheKey({ owner, repo, entry: current });
  const cached = lookupCache.get(cacheKey);
  if (cached) return cached;

  const lookup = (async () => {
    const result = await searchRepoCommits(
      owner,
      repo,
      JSON.stringify(term),
      maxCandidates,
      token,
    );
    if (!result.items?.length) {
      throw new Error(
        `未找到资源行「${current.name || current.id}」对应的提交 PR，请直接输入 PR 链接或序号。`,
      );
    }

    for (const item of result.items) {
      let commit: GithubCommitInfo;
      try {
        // 搜索接口不保证返回 files/patch，必须按 sha 读取目标提交详情。
        commit = await getRepoCommit(owner, repo, item.sha, token);
      } catch {
        continue;
      }

      const prNumber = extractPrNumberFromSubmissionCommitMessage(
        commit.commit?.message,
      );
      if (!prNumber) continue;
      const matched = findMatchingAddedCatalogEntry(
        commit.files ?? [],
        current,
      );
      if (!matched) continue;

      return {
        resourceId: current.id,
        entry: current,
        prNumber,
        commitSha: commit.sha,
        commitUrl: commit.html_url,
      } satisfies ResourceSubmissionLookup;
    }

    throw new Error(
      `最近的目录提交不是资源行「${current.name || current.id}」的来源，请直接输入 PR 链接或序号。`,
    );
  })();

  lookupCache.set(cacheKey, lookup);
  lookup.catch(() => lookupCache.delete(cacheKey));
  return lookup;
}

/**
 * 资源 ID → 当前目录行 → 定向提交搜索 → 对应 PR。
 *
 * 不做目录提交历史的完整分页扫描；搜索接口只返回少量候选，逐个核对目标行。
 */
export function lookupResourceSubmissionPr(
  resourceId: string,
  options?: ResourceSubmissionLookupOptions,
) {
  const normalizedId = resourceId.trim();
  if (!normalizedId) {
    return Promise.reject(new Error("资源 ID 不能为空。"));
  }
  return resolveResourceSubmissionPr(normalizedId, options);
}

const historyCache = new Map<
  string,
  { expiresAt: number; promise: Promise<ResourceSubmissionHistory> }
>();
const HISTORY_CACHE_TTL_MS = 60_000;

async function mapWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await run(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

function historyCacheKey(params: {
  owner: string;
  repo: string;
  term: string;
  until?: string;
  stopAfterPrNumber?: number;
  maxPages: number;
  fetchTitles: boolean;
}) {
  return [
    loadRepoEnvId(),
    params.owner.toLowerCase(),
    params.repo.toLowerCase(),
    params.term,
    params.until ?? "",
    String(params.stopAfterPrNumber ?? ""),
    String(params.maxPages),
    params.fetchTitles ? "titles" : "plain",
  ].join("\u0000");
}

/**
 * 获取一个资源仓库名下的资源提交 PR 历史，按时间倒序。
 *
 * 这里只查提交信息并用资源仓库名过滤，不读取整个 index_v2.csv 的历史。
 * 调用方可传 `until`，只保留目标 PR 合入之后的提交。
 */
export function listResourceSubmissionHistory(
  entry: CatalogEntry,
  options?: ResourceSubmissionHistoryOptions,
): Promise<ResourceSubmissionHistory> {
  const token = options?.token ?? getGithubToken();
  if (!token) return Promise.reject(new Error("请先登录 GitHub 账号。"));

  const owner = options?.owner ?? PUBLISH_CONFIG.targetPrRepoOwner;
  const repo = options?.repo ?? PUBLISH_CONFIG.targetPrRepoName;
  const term = submissionSearchTerm(entry);
  if (!term) {
    return Promise.reject(
      new Error(`资源「${entry.name || entry.id}」缺少资源仓库名，无法读取 PR 历史。`),
    );
  }

  const maxPages = Math.max(1, Math.min(10, Math.trunc(options?.maxPages ?? 5)));
  const fetchTitles = options?.fetchTitles !== false;
  const maxTitleFetches = Math.max(
    0,
    Math.min(30, Math.trunc(options?.maxTitleFetches ?? 10)),
  );
  const key = historyCacheKey({
    owner,
    repo,
    term,
    until: options?.until,
    stopAfterPrNumber: options?.stopAfterPrNumber,
    maxPages,
    fetchTitles,
  });
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    const entries: ResourceSubmissionHistoryEntry[] = [];
    const seen = new Set<number>();
    let complete = true;
    let searchedPages = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await searchRepoCommits(
        owner,
        repo,
        JSON.stringify(term),
        100,
        token,
        page,
      );
      searchedPages = page;
      const items = result.items ?? [];
      if (items.length === 0) {
        complete = true;
        break;
      }

      let reachedUntil = false;
      for (const item of items) {
        const committedAt =
          item.commit?.committer?.date || item.commit?.author?.date;
        if (options?.until && committedAt && committedAt <= options.until) {
          reachedUntil = true;
          continue;
        }
        const number = extractPrNumberFromSubmissionCommitMessage(
          item.commit?.message,
        );
        if (!number || seen.has(number)) continue;
        seen.add(number);
        entries.push({
          number,
          commitSha: item.sha,
          committedAt,
          url: `https://github.com/${owner}/${repo}/pull/${number}`,
        });
      }

      if (reachedUntil) {
        complete = true;
        break;
      }
      if (
        options?.stopAfterPrNumber &&
        seen.has(options.stopAfterPrNumber)
      ) {
        complete = true;
        break;
      }
      if (items.length < 100) {
        complete = true;
        break;
      }
      if (page === maxPages) complete = false;
    }

    entries.sort((left, right) =>
      (right.committedAt ?? "").localeCompare(left.committedAt ?? ""),
    );

    if (fetchTitles && maxTitleFetches > 0) {
      await mapWithConcurrency(
        entries.slice(0, maxTitleFetches),
        3,
        async (entry) => {
          try {
            const pull = await getPullRequest(entry.number, undefined, token);
            entry.title = pull.title;
            entry.url = pull.html_url;
            entry.mergedAt = pull.merged_at;
          } catch {
            // 标题只是展示信息，拉取失败不影响历史列表。
          }
        },
      );
    }

    return { entries, complete, searchedPages };
  })();

  historyCache.set(key, {
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
    promise,
  });
  promise.catch(() => historyCache.delete(key));
  return promise;
}

/** 将资源 PR 历史拆成当前最新、目标 PR 之前的来源、以及被越过的后续 PR。 */
export function splitResourceSubmissionHistory(
  history: ResourceSubmissionHistory,
  targetPrNumber: number,
  targetMergedAt?: string,
): ResourceSubmissionHistorySplit {
  const entries = history.entries;
  const targetIndex = entries.findIndex(
    (entry) => entry.number === targetPrNumber,
  );
  const target = targetIndex >= 0 ? entries[targetIndex] : undefined;
  const latest = entries[0];
  const crossedPrs =
    targetIndex > 0
      ? entries.slice(0, targetIndex)
      : targetIndex < 0 && targetMergedAt
        ? entries.filter(
            (entry) =>
              entry.committedAt &&
              entry.committedAt > targetMergedAt &&
              entry.number !== targetPrNumber,
          )
        : [];
  const targetSource =
    targetIndex >= 0 ? entries[targetIndex + 1] : undefined;

  return { latest, target, targetSource, crossedPrs, targetIndex };
}

export function clearResourceSubmissionLookupCache() {
  lookupCache.clear();
  historyCache.clear();
}

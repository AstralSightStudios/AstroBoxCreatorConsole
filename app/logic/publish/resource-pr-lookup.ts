import { loadRepoEnvId } from "~/config/repoEnv";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
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

export function clearResourceSubmissionLookupCache() {
  lookupCache.clear();
}

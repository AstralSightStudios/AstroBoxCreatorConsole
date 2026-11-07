import type { GithubPullRequest } from "~/api/github/pr-review";
import { getPullRequest } from "~/api/github/pr-review";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
  CATALOG_CSV_COLUMNS,
  decodeCatalogContent,
  getFileContent,
  normalizeCatalogEntryForCsv,
  type CatalogEntry,
} from "./catalog";
import {
  buildRollbackTargets,
  loadCatalogRollbackBaseline,
  planCatalogRollback,
  selectRollbackTargets,
  type CatalogRollbackPlan,
  type CatalogRollbackPlanItem,
  type CatalogRollbackTarget,
  type RollbackPreviewInput,
} from "./catalog-rollback";
import { getGithubToken } from "./github-actions";
import {
  listResourceSubmissionHistory,
  splitResourceSubmissionHistory,
  type ResourceSubmissionHistory,
  type ResourceSubmissionHistoryEntry,
} from "./resource-pr-lookup";

export interface CatalogFieldDiff {
  field: keyof CatalogEntry;
  before: string;
  after: string;
}

export interface RollbackPublishingRepoPreview {
  owner: string;
  repo: string;
  beforeCommit?: string;
  afterCommit?: string;
  comparable: boolean;
  reason?: string;
}

export interface RollbackPreviewItem {
  target: CatalogRollbackTarget;
  status: CatalogRollbackPlanItem["status"];
  crossPr: boolean;
  expected: CatalogEntry;
  current?: CatalogEntry;
  after?: CatalogEntry;
  changedFields: CatalogFieldDiff[];
  crossedPrs: ResourceSubmissionHistoryEntry[];
  latestPr?: ResourceSubmissionHistoryEntry;
  targetSourcePr?: ResourceSubmissionHistoryEntry;
  historyComplete: boolean;
  warnings: string[];
  conflicts: string[];
  publishingRepo?: RollbackPublishingRepoPreview;
}

export interface CatalogRollbackPreview {
  pull: GithubPullRequest;
  baselineRef: string;
  currentSha: string;
  targets: CatalogRollbackTarget[];
  plan: CatalogRollbackPlan;
  items: RollbackPreviewItem[];
  crossedPrs: ResourceSubmissionHistoryEntry[];
  crossedPrNumbers: number[];
  latestPr?: ResourceSubmissionHistoryEntry;
  /** 多资源时各资源最新 PR 是否一致；用于决定是否能一键改为回退最新。 */
  latestPrShared: boolean;
  canRollback: boolean;
  blockingReasons: string[];
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await run(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function normalizeValue(entry: CatalogEntry | undefined, field: keyof CatalogEntry) {
  if (!entry) return "";
  const normalized = normalizeCatalogEntryForCsv(entry);
  return normalized[field] ?? "";
}

export function buildFieldDiffs(
  current: CatalogEntry | undefined,
  after: CatalogEntry | undefined,
): CatalogFieldDiff[] {
  const diffs: CatalogFieldDiff[] = [];
  for (const field of CATALOG_CSV_COLUMNS) {
    const before = normalizeValue(current, field);
    const next = normalizeValue(after, field);
    if (before === next) continue;
    diffs.push({ field, before, after: next });
  }
  return diffs;
}

export function buildPublishingRepoPreview(
  current: CatalogEntry | undefined,
  after: CatalogEntry | undefined,
): RollbackPublishingRepoPreview | undefined {
  if (!after) return undefined;
  if (!current) {
    return {
      owner: after.repo_owner,
      repo: after.repo_name,
      afterCommit: after.repo_commit_hash || undefined,
      comparable: false,
      reason: "当前目录没有该资源行，回退后会重新指向目标 commit。",
    };
  }

  const sameRepo =
    current.repo_owner.trim().toLowerCase() ===
      after.repo_owner.trim().toLowerCase() &&
    current.repo_name.trim().toLowerCase() ===
      after.repo_name.trim().toLowerCase();
  if (!sameRepo) {
    return {
      owner: after.repo_owner,
      repo: after.repo_name,
      beforeCommit: current.repo_commit_hash || undefined,
      afterCommit: after.repo_commit_hash || undefined,
      comparable: false,
      reason: `发布仓库已变更：${current.repo_owner}/${current.repo_name} → ${after.repo_owner}/${after.repo_name}`,
    };
  }

  return {
    owner: after.repo_owner,
    repo: after.repo_name,
    beforeCommit: current.repo_commit_hash || undefined,
    afterCommit: after.repo_commit_hash || undefined,
    comparable: Boolean(current.repo_commit_hash && after.repo_commit_hash),
    reason:
      current.repo_commit_hash && after.repo_commit_hash
        ? undefined
        : "发布仓库 commit 缺失，无法直接比较文件差异。",
  };
}

async function hydrateTitles(
  entries: ReadonlyArray<ResourceSubmissionHistoryEntry>,
  token: string,
) {
  const unique = new Map<number, ResourceSubmissionHistoryEntry>();
  for (const entry of entries) unique.set(entry.number, entry);
  const targets = Array.from(unique.values()).slice(0, 12);
  await mapWithConcurrency(targets, 3, async (entry) => {
    if (entry.title) return;
    try {
      const pull = await getPullRequest(entry.number, undefined, token);
      entry.title = pull.title;
      entry.url = pull.html_url;
      entry.mergedAt = pull.merged_at;
    } catch {
      // 标题只是辅助信息，失败时保留 #PR 序号。
    }
  });
}

export async function loadCatalogRollbackPreview(params: {
  pull: GithubPullRequest;
  previews: ReadonlyArray<RollbackPreviewInput>;
  resourceId?: string;
}): Promise<CatalogRollbackPreview> {
  if (!params.pull.merged_at) {
    throw new Error("仅已合入的 PR 支持回退预览。");
  }

  const token = getGithubToken();
  if (!token) throw new Error("请先登录 GitHub 账号。");

  const owner = PUBLISH_CONFIG.targetPrRepoOwner;
  const repo = PUBLISH_CONFIG.targetPrRepoName;
  const path = PUBLISH_CONFIG.catalogFilePath;
  const branch = PUBLISH_CONFIG.defaultBranch;

  const [baseline, currentFile] = await Promise.all([
    loadCatalogRollbackBaseline(params.pull),
    getFileContent(token, owner, repo, path, branch),
  ]);
  const currentCsv = decodeCatalogContent(currentFile.content);
  const currentSha = currentFile.sha as string | undefined;
  if (!currentSha) throw new Error("读取目录文件的 sha 失败，无法生成回退预览。");

  const allTargets = buildRollbackTargets(params.previews);
  const selectedTargets = selectRollbackTargets(allTargets, params.resourceId);
  if (selectedTargets.length === 0) {
    throw new Error(
      params.resourceId?.trim()
        ? `当前 PR 未包含资源 ID「${params.resourceId.trim()}」，无法回退。`
        : "没有解析到可回退的资源行。",
    );
  }

  // 只查资源 PR 历史，不拉整份目录历史。每个资源最多取若干页，
  // 不够完整时在 UI 上标注“可能不完整”。
  const histories = await mapWithConcurrency(
    selectedTargets,
    3,
    async (target) => {
      const history = await listResourceSubmissionHistory(target.expected, {
        token,
        stopAfterPrNumber: params.pull.number,
        maxPages: 5,
        fetchTitles: false,
      });
      const split = splitResourceSubmissionHistory(
        history,
        params.pull.number,
        params.pull.merged_at,
      );
      return { target, history, split };
    },
  );

  await hydrateTitles(
    histories.flatMap(({ split }) => [
      ...(split.latest ? [split.latest] : []),
      ...(split.targetSource ? [split.targetSource] : []),
      ...split.crossedPrs,
    ]),
    token,
  );

  const targets: CatalogRollbackTarget[] = histories.map(
    ({ target, split }) => ({
      ...target,
      allowCrossPr: split.crossedPrs.length > 0,
    }),
  );

  const plan = planCatalogRollback({
    currentCsv,
    baselineCsv: baseline.csvContent,
    targets,
  });

  const historyByResourceId = new Map(
    histories.map(({ target, history, split }) => [
      target.currentId.trim().toLowerCase(),
      { history, split },
    ]),
  );

  const items: RollbackPreviewItem[] = plan.items.map((item) => {
    const historyInfo = historyByResourceId.get(
      item.currentId.trim().toLowerCase(),
    );
    const split = historyInfo?.split;
    const warnings: string[] = [];
    const conflicts = plan.conflicts
      .filter((conflict) => conflict.id === item.currentId)
      .map((conflict) => conflict.reason);
    const currentRepo = item.current
      ? `${item.current.repo_owner}/${item.current.repo_name}`.toLowerCase()
      : "";
    const afterRepo = item.after
      ? `${item.after.repo_owner}/${item.after.repo_name}`.toLowerCase()
      : "";
    const repoChanged = Boolean(
      currentRepo && afterRepo && currentRepo !== afterRepo,
    );
    const targetMatched = Boolean(split?.target);

    if (split?.crossedPrs.length) {
      warnings.push(
        `本次回退会越过 ${split.crossedPrs.length} 个后续已合入 PR。`,
      );
    }
    if (
      (historyInfo && !historyInfo.history.complete) ||
      repoChanged ||
      (historyInfo && !targetMatched)
    ) {
      warnings.push("后续 PR 统计可能不完整，请以实际目录和 PR 历史为准。");
    }
    if (item.status === "restore" && !item.current) {
      warnings.push("当前目录已没有该资源行，回退会按目标状态重新加入。");
    }
    if (repoChanged) {
      warnings.push(
        "发布仓库在回退范围内发生变化，回退会恢复目标状态的旧仓库地址。",
      );
    }
    if (
      item.current &&
      item.after &&
      item.current.id.trim().toLowerCase() !==
        item.after.id.trim().toLowerCase()
    ) {
      warnings.push(
        `资源 ID 会从「${item.current.id}」恢复为「${item.after.id}」。`,
      );
    }
    if (item.reason) warnings.push(item.reason);

    return {
      target: targets.find(
        (target) =>
          target.currentId.trim().toLowerCase() ===
          item.currentId.trim().toLowerCase(),
      ) ?? {
        currentId: item.currentId,
        name: item.name,
        expected: item.expected,
      },
      status: item.status,
      crossPr: item.crossPr,
      expected: item.expected,
      current: item.current,
      after: item.after,
      changedFields: buildFieldDiffs(item.current, item.after),
      crossedPrs: split?.crossedPrs ?? [],
      latestPr: split?.latest,
      targetSourcePr: split?.targetSource,
      historyComplete:
        Boolean(historyInfo?.history.complete) && !repoChanged && targetMatched,
      warnings,
      conflicts,
      publishingRepo: buildPublishingRepoPreview(item.current, item.after),
    };
  });

  const crossedMap = new Map<number, ResourceSubmissionHistoryEntry>();
  for (const item of items) {
    for (const entry of item.crossedPrs) crossedMap.set(entry.number, entry);
  }
  const crossedPrs = Array.from(crossedMap.values()).sort((left, right) =>
    (right.committedAt ?? "").localeCompare(left.committedAt ?? ""),
  );
  const latestNumbers = new Set(
    items
      .map((item) => item.latestPr?.number)
      .filter((number): number is number => typeof number === "number"),
  );
  const latestPrShared =
    latestNumbers.size <= 1 &&
    items.every((item) => item.latestPr?.number === items[0]?.latestPr?.number);

  const blockingReasons = [
    ...plan.conflicts.map((conflict) => conflict.reason),
    ...(plan.changes.length === 0 ? ["当前目录已是回退后状态，无需写入。"] : []),
  ];

  return {
    pull: params.pull,
    baselineRef: baseline.ref,
    currentSha,
    targets,
    plan,
    items,
    crossedPrs,
    crossedPrNumbers: crossedPrs.map((entry) => entry.number),
    latestPr: latestPrShared ? items[0]?.latestPr : undefined,
    latestPrShared,
    canRollback: blockingReasons.length === 0,
    blockingReasons,
  };
}

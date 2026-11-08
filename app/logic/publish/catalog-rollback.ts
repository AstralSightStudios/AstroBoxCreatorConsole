import { PUBLISH_CONFIG } from "~/config/publish";
import { loadRepoEnvId } from "~/config/repoEnv";
import {
  getRepoCommit,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import {
  CATALOG_CSV_COLUMNS,
  decodeCatalogContent,
  getFileContent,
  normalizeCatalogEntryForCsv,
  parseCatalogCsv,
  writeRepoFile,
  type CatalogEntry,
} from "./catalog";
import { getGithubToken } from "./github-actions";

/** 回查页只需要预览里这几个字段，避免逻辑层反向依赖路由类型。 */
export interface RollbackPreviewInput {
  entry: CatalogEntry;
  originalId?: string;
  request?: {
    mode: "create" | "edit" | "delete";
    original_id?: string | null;
  } | null;
}

export interface CatalogRollbackTarget {
  /** PR 合入后目录里的资源 ID。 */
  currentId: string;
  /**
   * PR 合入前该资源行的资源 ID。create 请求缺省；legacy PR 在 diff
   * 信息不可用时也可能缺省，此时按 currentId / 资源仓库去基线里探测
   * 是新增还是更新。
   */
  previousId?: string;
  name: string;
  /** PR 申请写入的新行，用于确认当前行确实来自这次提交。 */
  expected: CatalogEntry;
  /**
   * legacy diff 无法推出旧 ID 时，允许按 repo_owner/repo_name 在基线里
   * 找同一资源行，避免把「改 ID 的更新」误当成新增而整行删除。
   * staging 请求有明确 mode，不启用该兜底。
   */
  matchByRepo?: boolean;
}

export interface CatalogRollbackChange {
  kind: "restore" | "remove";
  id: string;
  previousId?: string;
  name: string;
}

export interface CatalogRollbackConflict {
  id: string;
  name: string;
  reason: string;
}

export interface CatalogRollbackSkip {
  id: string;
  name: string;
  reason: string;
}

export interface CatalogRollbackPlan {
  nextCsv: string;
  changes: CatalogRollbackChange[];
  conflicts: CatalogRollbackConflict[];
  unchanged: CatalogRollbackSkip[];
}

export type CatalogRollbackBaselineSource =
  | "merge-parent"
  | "pr-base"
  | "default-branch";

export interface CatalogRollbackBaseline {
  ref: string;
  source: CatalogRollbackBaselineSource;
  csvContent: string;
  entries: CatalogEntry[];
}

export interface CatalogRollbackResult {
  plan: CatalogRollbackPlan;
  commitSha?: string;
  commitUrl?: string;
}

interface CatalogRow {
  line: string;
  entry: CatalogEntry;
}

function normalizeId(value: string | undefined | null) {
  return (value ?? "").trim();
}

/**
 * 把 PR 里解析出的资源预览映射成回退目标。
 *
 * staging 请求有明确的 create/edit 与 original_id；legacy PR 只能依赖 diff
 * 推导出的 originalId。legacy 可能因为 patch 被截断而拿不到 originalId，
 * 因此 previousId 允许缺省，真正的「新增还是更新」留给 plan 阶段结合基线判断。
 */
export function buildRollbackTargets(
  previews: ReadonlyArray<RollbackPreviewInput>,
): CatalogRollbackTarget[] {
  const targets: CatalogRollbackTarget[] = [];
  const seen = new Set<string>();

  for (const preview of previews) {
    const currentId = normalizeId(preview.entry?.id);
    if (!currentId) continue;

    let previousId: string | undefined;
    if (preview.request) {
      previousId =
        preview.request.mode === "edit"
          ? normalizeId(preview.request.original_id) ||
            normalizeId(preview.originalId) ||
            currentId
          : undefined;
    } else {
      previousId = normalizeId(preview.originalId) || undefined;
    }

    const key = `${currentId.toLowerCase()}\u0000${(previousId ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({
      currentId,
      previousId,
      name: normalizeId(preview.entry.name) || currentId,
      expected: preview.entry,
      // 只有 legacy（没有 request）且 diff 推不出旧 ID 时才按仓库兜底。
      matchByRepo: !preview.request && !previousId,
    });
  }

  return targets;
}

/** 回查从资源 ID 进入时，只保留该资源行；否则回退 PR 涉及的全部资源行。 */
export function selectRollbackTargets(
  targets: ReadonlyArray<CatalogRollbackTarget>,
  resourceId?: string,
) {
  const needle = normalizeId(resourceId).toLowerCase();
  if (!needle) return [...targets];
  return targets.filter(
    (target) =>
      normalizeId(target.currentId).toLowerCase() === needle ||
      normalizeId(target.previousId).toLowerCase() === needle,
  );
}

function splitCsv(csv: string) {
  const normalized = csv.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline) lines.pop();

  const header = lines.shift() ?? "";
  const dataLines = lines.filter((line) => line.trim().length > 0);
  return { header, dataLines, hasTrailingNewline };
}

function parseRowLine(line: string): CatalogRow | undefined {
  const entry = parseCatalogCsv(`header\n${line}`)[0];
  if (!entry) return undefined;
  return { line, entry };
}

function findRowIndex(rows: ReadonlyArray<CatalogRow>, id: string) {
  const needle = normalizeId(id).toLowerCase();
  if (!needle) return -1;
  return rows.findIndex(
    (row) => normalizeId(row.entry.id).toLowerCase() === needle,
  );
}

/** 比较两行是否等价；paid_type 的 free/空串等写法差异按目录规范归一。 */
function catalogRowKey(entry: CatalogEntry) {
  const normalized = normalizeCatalogEntryForCsv(entry);
  return CATALOG_CSV_COLUMNS.map((column) => normalized[column] ?? "").join(",");
}

function rowsEqual(left: CatalogEntry, right: CatalogEntry) {
  return catalogRowKey(left) === catalogRowKey(right);
}

/**
 * 找到恢复行在最新目录中的插入位置：优先贴在基线里它前面的行之后，
 * 否则贴在它后面的行之前；都找不到时追加到末尾。
 */
function resolveInsertIndex(
  working: ReadonlyArray<CatalogRow>,
  baseline: ReadonlyArray<CatalogRow>,
  baselineIndex: number,
) {
  for (let index = baselineIndex - 1; index >= 0; index -= 1) {
    const currentIndex = findRowIndex(working, baseline[index].entry.id);
    if (currentIndex >= 0) return currentIndex + 1;
  }
  for (let index = baselineIndex + 1; index < baseline.length; index += 1) {
    const currentIndex = findRowIndex(working, baseline[index].entry.id);
    if (currentIndex >= 0) return currentIndex;
  }
  return working.length;
}

/**
 * 纯函数：根据当前目录与 PR 合入前的基线目录，计算回退后的目录。
 *
 * - 更新资源：把当前行恢复成基线里的旧行（含旧 ID 与旧顺序）。
 * - 新增资源：从目录中移除当前行。
 * - 当前行已被后续提交改过：记为 conflict，由调用方拒绝写入，避免覆盖别人的修改。
 */
export function planCatalogRollback(params: {
  currentCsv: string;
  baselineCsv: string;
  targets: ReadonlyArray<CatalogRollbackTarget>;
}): CatalogRollbackPlan {
  const current = splitCsv(params.currentCsv);
  if (!current.header.trim()) {
    throw new Error("社区仓库目录文件为空，无法回退。");
  }

  const baseline = splitCsv(params.baselineCsv);
  if (!baseline.header.trim()) {
    throw new Error("PR 合入前的目录文件为空，无法回退。");
  }

  const parseRows = (lines: ReadonlyArray<string>, label: string) => {
    const rows: CatalogRow[] = [];
    for (const line of lines) {
      const row = parseRowLine(line);
      if (!row) {
        throw new Error(`${label}存在无法解析的数据行，已中止回退。`);
      }
      rows.push(row);
    }
    return rows;
  };

  const baselineRows = parseRows(baseline.dataLines, "PR 合入前的目录");
  const working = parseRows(current.dataLines, "当前目录");

  const changes: CatalogRollbackChange[] = [];
  const conflicts: CatalogRollbackConflict[] = [];
  const unchanged: CatalogRollbackSkip[] = [];

  const resolved = params.targets.map((target) => {
    const currentId = normalizeId(target.currentId);
    let previousId = normalizeId(target.previousId) || currentId;
    let baselineIndex = findRowIndex(baselineRows, previousId);
    let baselineRow =
      baselineIndex >= 0 ? baselineRows[baselineIndex] : undefined;

    // legacy 改 ID 且 diff 无法确定旧 ID 时，按资源仓库找基线行。
    if (!baselineRow && target.matchByRepo) {
      const owner = normalizeId(target.expected.repo_owner).toLowerCase();
      const repo = normalizeId(target.expected.repo_name).toLowerCase();
      if (owner && repo) {
        baselineIndex = baselineRows.findIndex(
          (row) =>
            normalizeId(row.entry.repo_owner).toLowerCase() === owner &&
            normalizeId(row.entry.repo_name).toLowerCase() === repo,
        );
        if (baselineIndex >= 0) {
          baselineRow = baselineRows[baselineIndex];
          previousId = normalizeId(baselineRow.entry.id) || previousId;
        }
      }
    }

    return {
      target,
      currentId,
      previousId,
      baselineIndex,
      baselineRow,
    };
  });

  // 先处理新增资源的回退（删除当前行），再按基线顺序恢复更新行，
  // 这样恢复行寻找相邻锚点时不会被即将删除的行带偏。
  const removals = resolved.filter((item) => !item.baselineRow);
  const restores = resolved
    .filter((item) => Boolean(item.baselineRow))
    .sort((left, right) => left.baselineIndex - right.baselineIndex);

  for (const item of removals) {
    const { target, currentId, previousId } = item;
    const currentIndex = findRowIndex(working, currentId);

    if (currentIndex < 0) {
      unchanged.push({
        id: currentId,
        name: target.name,
        reason: "当前目录已不存在该资源行，无需回退。",
      });
      continue;
    }

    const currentRow = working[currentIndex];
    // 当前 ID 可能与 PR 里的写法大小写不同，比较内容前统一用目标行。
    if (!rowsEqual(currentRow.entry, target.expected)) {
      conflicts.push({
        id: currentId,
        name: target.name,
        reason: `目录中的资源 ID「${target.currentId}」与 PR 提交内容不一致，可能已被后续提交修改。`,
      });
      continue;
    }

    // currentId 与 previousId 不同说明 legacy diff 把更新误判成新增；
    // 基线里没有该行时仍以「新增回退」处理，但保留 previousId 供提示。
    working.splice(currentIndex, 1);
    changes.push({
      kind: "remove",
      id: currentId,
      previousId: previousId !== currentId ? previousId : undefined,
      name: target.name,
    });
  }

  for (const item of restores) {
    const { target, currentId, previousId, baselineRow, baselineIndex } = item;
    const currentIndex = findRowIndex(working, currentId);

    if (currentIndex < 0) {
      const alreadyRestored = findRowIndex(working, previousId) >= 0;
      unchanged.push({
        id: currentId,
        name: target.name,
        reason: alreadyRestored
          ? "当前目录已是回退后的状态。"
          : "当前目录已不存在该资源行，无需回退。",
      });
      continue;
    }

    const currentRow = working[currentIndex];
    const matchesExpected = rowsEqual(currentRow.entry, target.expected);
    const matchesBaseline = rowsEqual(currentRow.entry, baselineRow!.entry);
    if (!matchesExpected && !matchesBaseline) {
      conflicts.push({
        id: currentId,
        name: target.name,
        reason: `目录中的资源行在 PR 合入后又被修改过，无法安全回退。`,
      });
      continue;
    }
    if (matchesBaseline) {
      unchanged.push({
        id: currentId,
        name: target.name,
        reason: "当前目录已是回退后的状态。",
      });
      continue;
    }

    if (previousId.toLowerCase() !== currentId.toLowerCase()) {
      const occupiedIndex = findRowIndex(working, previousId);
      if (occupiedIndex >= 0) {
        conflicts.push({
          id: currentId,
          name: target.name,
          reason: `旧资源 ID「${previousId}」已被目录中的另一行占用，无法恢复。`,
        });
        continue;
      }
    }

    working.splice(currentIndex, 1);
    const insertIndex = resolveInsertIndex(working, baselineRows, baselineIndex);
    working.splice(insertIndex, 0, {
      line: baselineRow!.line,
      entry: baselineRow!.entry,
    });
    changes.push({
      kind: "restore",
      id: currentId,
      previousId: previousId !== currentId ? previousId : undefined,
      name: target.name,
    });
  }

  const outputLines = [current.header, ...working.map((row) => row.line)];
  const trailingNewline = current.hasTrailingNewline || !params.currentCsv;
  const nextCsv = `${outputLines.join("\n")}${trailingNewline ? "\n" : ""}`;

  return { nextCsv, changes, conflicts, unchanged };
}

/** 写入前再校验一次，避免回退产生重复 ID 或重复资源仓库。 */
export function validateRollbackCatalog(csv: string) {
  const entries = parseCatalogCsv(csv);
  const ids = new Set<string>();
  const repos = new Set<string>();

  for (const entry of entries) {
    const id = normalizeId(entry.id).toLowerCase();
    if (!id) throw new Error("回退后的目录存在空资源 ID。");
    if (ids.has(id)) throw new Error(`回退后的目录存在重复资源 ID「${entry.id}」。`);
    ids.add(id);

    const owner = normalizeId(entry.repo_owner).toLowerCase();
    const repo = normalizeId(entry.repo_name).toLowerCase();
    if (!owner || !repo) continue;
    const key = `${owner}/${repo}`;
    if (repos.has(key)) {
      throw new Error(`回退后的目录存在重复资源仓库「${entry.repo_owner}/${entry.repo_name}」。`);
    }
    repos.add(key);
  }
}

const baselineCache = new Map<string, Promise<CatalogRollbackBaseline>>();

function baselineCacheKey(pull: GithubPullRequest) {
  return [
    loadRepoEnvId(),
    PUBLISH_CONFIG.targetPrRepoOwner,
    PUBLISH_CONFIG.targetPrRepoName,
    pull.number,
    pull.merge_commit_sha ?? "",
    pull.merged_at ?? "",
  ].join("#");
}

async function resolveBaseline(
  pull: GithubPullRequest,
): Promise<CatalogRollbackBaseline> {
  const token = getGithubToken();
  if (!token) throw new Error("请先登录 GitHub 账号。");
  const owner = PUBLISH_CONFIG.targetPrRepoOwner;
  const repo = PUBLISH_CONFIG.targetPrRepoName;
  const path = PUBLISH_CONFIG.catalogFilePath;

  let ref = PUBLISH_CONFIG.defaultBranch;
  let source: CatalogRollbackBaselineSource = "default-branch";

  // 合入提交的父提交就是 PR 应用前的目录状态：
  // - staging PR：合入提交只写 tmp，Action 稍后才改 index_v2.csv；
  // - legacy PR：合入提交本身改 index_v2.csv，父提交即旧内容。
  if (pull.merged_at && pull.merge_commit_sha) {
    try {
      const mergeCommit = await getRepoCommit(owner, repo, pull.merge_commit_sha);
      const parent = mergeCommit.parents?.[0]?.sha;
      if (parent) {
        ref = parent;
        source = "merge-parent";
      }
    } catch {
      // 拿不到合入提交时退回 PR base，至少能恢复创建 PR 那一刻的旧行。
    }
  }

  if (source === "default-branch" && pull.base?.sha) {
    ref = pull.base.sha;
    source = "pr-base";
  }

  const file = await getFileContent(token, owner, repo, path, ref);
  const csvContent = decodeCatalogContent(file.content);
  return {
    ref,
    source,
    csvContent,
    entries: parseCatalogCsv(csvContent),
  };
}

/**
 * 读取当前 PR 对应的「上一 Git 状态」目录。
 * 结果按 PR 合入信息缓存，详情页解析预览与真正的回退操作共用同一份基线。
 */
export function loadCatalogRollbackBaseline(
  pull: GithubPullRequest,
): Promise<CatalogRollbackBaseline> {
  const key = baselineCacheKey(pull);
  let cached = baselineCache.get(key);
  if (!cached) {
    cached = resolveBaseline(pull);
    baselineCache.set(key, cached);
    cached.catch(() => baselineCache.delete(key));
  }
  return cached;
}

/**
 * 回退一个 PR 在社区仓库 index_v2.csv 中涉及的所有资源行。
 *
 * 只有已合入的 PR 才允许回退；当前行与 PR 内容对不上（说明被后续提交改过）
 * 时整批拒绝，避免把其他审核结果一并覆盖。
 */
export async function rollbackCatalogRowsForPr(params: {
  pull: GithubPullRequest;
  previews: ReadonlyArray<RollbackPreviewInput>;
  /** 资源 ID 回查时只回退这一行；缺省回退 PR 涉及的全部资源行。 */
  resourceId?: string;
}): Promise<CatalogRollbackResult> {
  if (!params.pull.merged_at) {
    throw new Error("仅已合入的 PR 支持回退。");
  }

  const allTargets = buildRollbackTargets(params.previews);
  const targets = selectRollbackTargets(allTargets, params.resourceId);
  if (params.resourceId?.trim() && targets.length === 0) {
    throw new Error(
      `当前 PR 未包含资源 ID「${params.resourceId.trim()}」，无法回退。`,
    );
  }
  if (targets.length === 0) {
    throw new Error("没有解析到可回退的资源行。");
  }

  const token = getGithubToken();
  if (!token) throw new Error("请先登录 GitHub 账号。");
  const owner = PUBLISH_CONFIG.targetPrRepoOwner;
  const repo = PUBLISH_CONFIG.targetPrRepoName;
  const path = PUBLISH_CONFIG.catalogFilePath;
  const branch = PUBLISH_CONFIG.defaultBranch;

  const baseline = await loadCatalogRollbackBaseline(params.pull);
  const file = await getFileContent(token, owner, repo, path, branch);
  const currentCsv = decodeCatalogContent(file.content);
  const sha = file.sha as string | undefined;
  if (!sha) throw new Error("读取目录文件的 sha 失败，无法安全写入。");

  const plan = planCatalogRollback({
    currentCsv,
    baselineCsv: baseline.csvContent,
    targets,
  });

  if (plan.conflicts.length > 0) {
    throw new Error(plan.conflicts.map((item) => item.reason).join(" "));
  }
  if (plan.changes.length === 0) {
    return { plan };
  }

  validateRollbackCatalog(plan.nextCsv);

  const response = await writeRepoFile({
    token,
    owner,
    repo,
    path,
    branch,
    content: plan.nextCsv,
    sha,
    message: `Rollback resource rows from PR #${params.pull.number}`,
  });

  const commit = (response as { commit?: { sha?: string; html_url?: string } })
    ?.commit;
  return {
    plan,
    commitSha: commit?.sha,
    commitUrl: commit?.html_url,
  };
}

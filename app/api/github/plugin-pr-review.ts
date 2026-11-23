import {
  createBlob,
  createCommit,
  createTree,
  ensureBase64,
  getBranchHead,
  githubFetch,
  isGithubStatus,
  updateRefFastForward,
} from "~/logic/publish/github-actions";
import { getFileContent } from "~/logic/publish/catalog";
import {
  getPullRequest,
  listPullRequestFiles,
  type GithubPullRequest,
  type GithubRepoRef,
} from "~/api/github/pr-review";
import {
  extractPluginIndexPatch,
  parsePluginIndexText,
  resolvePluginIndexConflict,
  validatePluginIndexLine,
  type PluginIndexMergeResult,
} from "~/logic/publish/plugin-index";

function decodeBase64Text(content?: string): string {
  if (!content) return "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readIndexFile(
  repo: GithubRepoRef,
  token: string,
  ref: string,
) {
  const data = await getFileContent(
    token,
    repo.owner,
    repo.name,
    "index.txt",
    ref,
  );
  return {
    text: decodeBase64Text(data?.content),
    sha: typeof data?.sha === "string" ? data.sha : undefined,
  };
}

function headRepoLabel(pull: GithubPullRequest): string {
  const headRepo = pull.head.repo;
  const owner =
    headRepo?.owner?.login || headRepo?.full_name?.split("/")[0] || "unknown";
  return `${owner}/${pull.head.ref}`;
}

/**
 * 检查一个插件 PR 是否属于可以自动处理的“纯追加 index.txt”类型。
 * 这里只读取 PR 文件列表和 patch，不修改任何分支。
 */
async function inspectPluginIndexPull(params: {
  pull: GithubPullRequest;
  repo: GithubRepoRef;
}): Promise<{ addedLines: string[] }> {
  const { pull, repo } = params;
  const files = await listPullRequestFiles(pull.number, repo);
  const indexFiles = files.filter((file) => file.filename === "index.txt");
  if (indexFiles.length !== 1 || files.length !== 1) {
    throw new Error(
      "无法自动解决冲突：该 PR 不是只修改 index.txt，请人工处理。",
    );
  }
  const file = indexFiles[0];
  if ((file.deletions ?? 0) > 0) {
    throw new Error(
      "无法自动解决冲突：该 PR 删除了 index.txt 中的行，请人工处理。",
    );
  }
  const patch = extractPluginIndexPatch(file.patch);
  if (patch.addedLines.length === 0) {
    throw new Error(
      "无法自动解决冲突：没有从 index.txt diff 中解析到新增行，请人工处理。",
    );
  }
  return { addedLines: patch.addedLines };
}

/**
 * 把 PR 新增行解析到给定上游 index.txt 上，并校验新增行格式。
 * 与仓库 Action 的规则一致：行序无关，只保证新增行存在且合法。
 */
function resolveAndValidateIndex(
  baseText: string,
  addedLines: readonly string[],
): PluginIndexMergeResult {
  const merged = resolvePluginIndexConflict(baseText, addedLines);
  if (merged.appended.length === 0) {
    throw new Error(
      "无法自动解决冲突：PR 新增的条目已经全部存在于上游 index.txt 中。",
    );
  }
  const baseLines = parsePluginIndexText(baseText);
  const invalidLines = merged.appended.filter((line) =>
    validatePluginIndexLine(line, { existingLines: baseLines }).some(
      (issue) => issue.level === "error",
    ),
  );
  if (invalidLines.length > 0) {
    throw new Error(
      `无法自动解决冲突：新增行存在格式错误（${invalidLines[0]}），请先让作者修正 index.txt。`,
    );
  }
  return merged;
}

async function waitForMergeable(params: {
  number: number;
  repo: GithubRepoRef;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<GithubPullRequest> {
  const { number, repo } = params;
  const timeoutMs = params.timeoutMs ?? 30_000;
  const intervalMs = params.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  let latest = await getPullRequest(number, repo);
  while (latest.mergeable === null && !latest.merged_at && Date.now() < deadline) {
    await sleep(intervalMs);
    latest = await getPullRequest(number, repo);
  }
  return latest;
}

async function waitForMerged(params: {
  number: number;
  repo: GithubRepoRef;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<GithubPullRequest> {
  const { number, repo } = params;
  const timeoutMs = params.timeoutMs ?? 20_000;
  const intervalMs = params.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let latest = await getPullRequest(number, repo);
  while (!latest.merged_at && Date.now() < deadline) {
    await sleep(intervalMs);
    latest = await getPullRequest(number, repo);
  }
  return latest;
}

export interface PluginMergePreparation {
  pull: GithubPullRequest;
  resolved: boolean;
  appendedLines: string[];
}

/**
 * 合入前准备：只在 index.txt 冲突时做分析，不修改作者分支。
 * 真正的解决动作在 mergePreparedPluginPullRequest 中通过官方仓库侧的
 * 双父合并提交完成，这样即使作者没有允许维护者编辑 fork 也能工作。
 */
export async function preparePluginPullRequestForMerge(params: {
  number: number;
  repo: GithubRepoRef;
  token: string;
  timeoutMs?: number;
}): Promise<PluginMergePreparation> {
  const { number, repo, token } = params;
  let pull = await getPullRequest(number, repo);
  if (pull.merged_at) {
    return { pull, resolved: false, appendedLines: [] };
  }

  if (pull.mergeable === null) {
    pull = await waitForMergeable({
      number,
      repo,
      timeoutMs: params.timeoutMs,
    });
  }
  if (pull.mergeable !== false) {
    return { pull, resolved: false, appendedLines: [] };
  }

  // mergeable=false 只有 dirty 才是 index.txt 冲突；blocked / unstable 等
  // 通常是分支保护或检查项未满足，直接合并没有意义。
  if (
    pull.mergeable_state &&
    pull.mergeable_state !== "dirty" &&
    pull.mergeable_state !== "unknown"
  ) {
    throw new Error(
      `PR #${number} 当前不可合并（mergeable_state: ${pull.mergeable_state}），请检查分支保护或状态检查。`,
    );
  }

  const { addedLines } = await inspectPluginIndexPull({ pull, repo });
  const base = await readIndexFile(repo, token, repo.defaultBranch);
  const merged = resolveAndValidateIndex(base.text, addedLines);
  return {
    pull,
    resolved: true,
    appendedLines: merged.appended,
  };
}

function buildMergeCommitMessage(
  pull: GithubPullRequest,
  appendedLines: readonly string[],
): string {
  return [
    `Merge pull request #${pull.number} from ${headRepoLabel(pull)}`,
    "",
    pull.title,
    "",
    `chore: auto-resolve index.txt conflict (+${appendedLines.length})`,
  ].join("\n");
}

/**
 * 在官方仓库侧直接生成一个双父合并提交：
 *   parent[0] = 当前默认分支 HEAD
 *   parent[1] = PR head
 * 树基于 parent[0]，只替换 index.txt。这样不需要写作者 fork，
 * 也不依赖 maintainer_can_modify；更新默认分支后 GitHub 会把 PR 标记为 merged。
 */
async function mergePluginIndexConflictOnBase(params: {
  number: number;
  repo: GithubRepoRef;
  token: string;
  pull: GithubPullRequest;
  addedLines: readonly string[];
}): Promise<{ mergeCommitSha: string; appendedLines: string[] }> {
  const { number, repo, token, pull } = params;
  const expectedHeadSha = pull.head.sha;
  const repoInfo = {
    owner: repo.owner,
    name: repo.name,
    branch: repo.defaultBranch,
  };
  const maxAttempts = 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const latest = await getPullRequest(number, repo);
    if (latest.merged_at) {
      return {
        mergeCommitSha: latest.merge_commit_sha || "",
        appendedLines: [...params.addedLines],
      };
    }
    if (latest.head.sha !== expectedHeadSha) {
      throw new Error(
        `PR #${number} 的作者分支已更新，请重新审核后再合入。`,
      );
    }

    const baseHead = await getBranchHead(repoInfo, token);
    const baseFile = await readIndexFile(repo, token, baseHead.commitSha);
    const merged = resolveAndValidateIndex(baseFile.text, params.addedLines);

    const blobSha = await createBlob(
      repoInfo,
      ensureBase64(merged.content),
      token,
    );
    const treeSha = await createTree(
      repoInfo,
      baseHead.treeSha,
      [
        {
          sha: blobSha,
          path: "index.txt",
          mode: "100644",
          type: "blob",
        },
      ],
      token,
    );
    const commitSha = await createCommit(
      repoInfo,
      buildMergeCommitMessage(latest, merged.appended),
      treeSha,
      [baseHead.commitSha, expectedHeadSha],
      token,
    );

    try {
      await updateRefFastForward(repoInfo, commitSha, token);
    } catch (error) {
      // 默认分支在读取后被别人推进了：重新读取 HEAD 再试一次，绝不 force。
      if (isGithubStatus(error, 409, 422) && attempt < maxAttempts) {
        lastError = error;
        await sleep(attempt * 500);
        continue;
      }
      throw error;
    }

    await waitForMerged({ number, repo });
    return {
      mergeCommitSha: commitSha,
      appendedLines: merged.appended,
    };
  }

  const detail = lastError instanceof Error ? `：${lastError.message}` : "";
  throw new Error(
    `自动合入失败：默认分支在合入过程中持续更新，请重试${detail}`,
  );
}

async function mergePullRequestApi(params: {
  number: number;
  repo: GithubRepoRef;
  token: string;
  sha: string;
}): Promise<void> {
  const { number, repo, token, sha } = params;
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${number}/merge`;
  const init: RequestInit = {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merge_method: "merge",
      sha,
    }),
  };

  try {
    await githubFetch<unknown>(url, init, { timeoutMs: 60_000 });
  } catch (error) {
    // GitHub 偶尔还会短暂返回 405/409，等它重算后重试一次。
    // 仍使用 prepare 时的 head sha：若作者在此期间推了新提交，应失败并要求重新审核，
    // 不能拿未审核过的新提交去合入。
    if (isGithubStatus(error, 405, 409)) {
      await sleep(2_000);
      await githubFetch<unknown>(url, init, { timeoutMs: 60_000 });
    } else {
      throw error;
    }
  }
}

/** 使用 prepare 得到的 head sha 合入，避免 approve 之后作者又推新提交。 */
export async function mergePreparedPluginPullRequest(params: {
  number: number;
  repo: GithubRepoRef;
  token: string;
  prepared: PluginMergePreparation;
}): Promise<{ merged: boolean; resolved: boolean; appendedLines: string[] }> {
  const { number, repo, token, prepared } = params;
  if (prepared.pull.merged_at) {
    return {
      merged: true,
      resolved: prepared.resolved,
      appendedLines: prepared.appendedLines,
    };
  }

  if (prepared.resolved) {
    const result = await mergePluginIndexConflictOnBase({
      number,
      repo,
      token,
      pull: prepared.pull,
      addedLines: prepared.appendedLines,
    });
    return {
      merged: true,
      resolved: true,
      appendedLines: result.appendedLines,
    };
  }

  await mergePullRequestApi({
    number,
    repo,
    token,
    sha: prepared.pull.head.sha,
  });
  return {
    merged: true,
    resolved: false,
    appendedLines: [],
  };
}

/**
 * 一步完成 prepare + merge 的便捷入口（兼容调用方不拆分 approve 的场景）。
 */
export async function mergePluginPullRequest(params: {
  number: number;
  repo: GithubRepoRef;
  token: string;
  timeoutMs?: number;
}): Promise<{ merged: boolean; resolved: boolean; appendedLines: string[] }> {
  const prepared = await preparePluginPullRequestForMerge(params);
  return mergePreparedPluginPullRequest({ ...params, prepared });
}

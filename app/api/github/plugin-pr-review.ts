import {
  githubFetch,
  isGithubStatus,
  uploadTextFile,
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

function headRepoInfo(pull: GithubPullRequest): {
  owner: string;
  name: string;
  branch: string;
  fullName: string;
} | null {
  const headRepo = pull.head.repo;
  if (!headRepo) return null;
  const owner = headRepo.owner?.login || headRepo.full_name.split("/")[0];
  if (!owner || !headRepo.name) return null;
  return {
    owner,
    name: headRepo.name,
    branch: pull.head.ref,
    fullName: headRepo.full_name,
  };
}

export interface PluginConflictResolution {
  appendedLines: string[];
  duplicates: string[];
  headSha?: string;
}

/**
 * 只处理“纯追加 index.txt”的插件 PR：把 PR 新增的行补到最新默认分支的
 * index.txt 末尾，并提交回作者分支。其他情况一律拒绝自动处理。
 */
export async function resolvePluginIndexConflictForPull(params: {
  pull: GithubPullRequest;
  repo: GithubRepoRef;
  token: string;
}): Promise<PluginConflictResolution> {
  const { pull, repo, token } = params;
  const head = headRepoInfo(pull);
  if (!head) {
    throw new Error("PR 的 head 仓库不可用，无法自动解决冲突。");
  }
  const sameRepo = head.fullName.toLowerCase() === `${repo.owner}/${repo.name}`.toLowerCase();
  if (!sameRepo && pull.maintainer_can_modify === false) {
    throw new Error(
      "无法自动解决冲突：作者未允许维护者编辑该分支。请让作者点击 Update branch 或手动解决冲突后重试。",
    );
  }

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

  const base = await readIndexFile(repo, token, repo.defaultBranch);
  const merged = resolvePluginIndexConflict(base.text, patch.addedLines);
  if (merged.appended.length === 0) {
    throw new Error(
      "无法自动解决冲突：PR 新增的条目已经全部存在于上游 index.txt 中。",
    );
  }
  const baseLines = parsePluginIndexText(base.text);
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

  const headFile = await readIndexFile(
    { owner: head.owner, name: head.name, defaultBranch: head.branch },
    token,
    head.branch,
  );
  const uploaded = await uploadTextFile(
    {
      owner: head.owner,
      name: head.name,
      branch: head.branch,
    },
    "index.txt",
    merged.content,
    `chore: resolve index.txt conflict for PR #${pull.number}`,
    token,
    { sha: headFile.sha, branch: head.branch },
  );

  return {
    appendedLines: merged.appended,
    duplicates: merged.duplicates,
    headSha: uploaded?.commit?.sha as string | undefined,
  };
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

export interface PluginMergePreparation {
  pull: GithubPullRequest;
  resolved: boolean;
  appendedLines: string[];
}

/**
 * 合入前准备：只在 index.txt 冲突时自动解决，并等待 GitHub 重新计算 mergeable。
 * 页面层应在 prepare 完成后再提交 approve，避免“解决冲突的新提交”触发
 * 分支保护里的 “Dismiss stale approvals”。
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

  let appendedLines: string[] = [];
  let resolved = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (pull.mergeable === null) {
      pull = await waitForMergeable({
        number,
        repo,
        timeoutMs: params.timeoutMs,
      });
    }
    if (pull.mergeable !== false) break;

    // mergeable=false 只有 dirty 才是 index.txt 冲突；blocked / unstable 等
    // 通常是分支保护或检查项未满足，改写作者分支没有意义。
    if (
      pull.mergeable_state &&
      pull.mergeable_state !== "dirty" &&
      pull.mergeable_state !== "unknown"
    ) {
      throw new Error(
        `PR #${number} 当前不可合并（mergeable_state: ${pull.mergeable_state}），请检查分支保护或状态检查。`,
      );
    }

    const resolution = await resolvePluginIndexConflictForPull({
      pull,
      repo,
      token,
    });
    appendedLines = resolution.appendedLines;
    resolved = true;
    pull = await waitForMergeable({ number, repo, timeoutMs: params.timeoutMs });
  }

  if (pull.mergeable === false) {
    throw new Error(
      `PR #${number} 仍有合并冲突（${pull.mergeable_state || "dirty"}），自动解决未成功，请人工处理。`,
    );
  }

  return { pull, resolved, appendedLines };
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

  try {
    await githubFetch<unknown>(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${number}/merge`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merge_method: "merge",
          sha: prepared.pull.head.sha,
        }),
      },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    // 自动解决后 GitHub 偶尔还会短暂返回 405/409，等它重算后重试一次。
    // 仍使用 prepare 时的 head sha：若作者在此期间推了新提交，应失败并要求重新审核，
    // 不能拿未审核过的新提交去合入。
    if (isGithubStatus(error, 405, 409)) {
      await sleep(2_000);
      await githubFetch<unknown>(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${number}/merge`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            merge_method: "merge",
            sha: prepared.pull.head.sha,
          }),
        },
        { timeoutMs: 60_000 },
      );
    } else {
      throw error;
    }
  }

  return {
    merged: true,
    resolved: prepared.resolved,
    appendedLines: prepared.appendedLines,
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

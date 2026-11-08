import type { GithubPullRequest, GithubRepoRef } from "~/api/github/pr-review";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { NG_PLUGIN_REPO_CONFIG } from "~/config/pluginRepo";

/** PR 审核队列来源：资源目录仓库 / 官方插件源仓库。 */
export type ReviewSource = "resource" | "plugin";

/**
 * 带来源的 PR。两个仓库的 PR 编号彼此独立，页面状态必须用 source + number
 * 组成的复合 key，不能只拿 number 做 Map 键。
 */
export interface ReviewPullRequest extends GithubPullRequest {
  source: ReviewSource;
}

export function parseReviewSource(value: string | null | undefined): ReviewSource {
  return value === "plugin" ? "plugin" : "resource";
}

export function reviewPullKey(pull: {
  source: ReviewSource;
  number: number;
}): string {
  return `${pull.source}#${pull.number}`;
}

export function reviewPullKeyOf(
  source: ReviewSource,
  number: number,
): string {
  return `${source}#${number}`;
}

/**
 * 当前来源对应的 GitHub 仓库。资源仓库跟随 repoEnv 切换，插件仓库固定。
 * 每次调用都重新读取 COMMUNITY_REPO_CONFIG，避免模块加载时把环境值固化。
 */
export function reviewRepoRef(source: ReviewSource): GithubRepoRef {
  if (source === "plugin") {
    return {
      owner: NG_PLUGIN_REPO_CONFIG.owner,
      name: NG_PLUGIN_REPO_CONFIG.name,
      defaultBranch: NG_PLUGIN_REPO_CONFIG.defaultBranch,
    };
  }
  return {
    owner: COMMUNITY_REPO_CONFIG.owner,
    name: COMMUNITY_REPO_CONFIG.name,
    defaultBranch: COMMUNITY_REPO_CONFIG.defaultBranch,
  };
}

export function withReviewSource(
  pull: GithubPullRequest,
  source: ReviewSource,
): ReviewPullRequest {
  return { ...pull, source };
}

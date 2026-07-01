import type { RepoInfo } from "./github-actions";

export const MAIN_RESOURCE_BRANCH = "main";

export function toMainResourceRepo(repo: RepoInfo): RepoInfo {
  const sourceBranch = repo.sourceBranch?.trim() || repo.branch?.trim() || MAIN_RESOURCE_BRANCH;
  return {
    ...repo,
    branch: MAIN_RESOURCE_BRANCH,
    sourceBranch,
  };
}

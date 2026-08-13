import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { loadAccountState } from "~/logic/account/store";
import { githubFetch } from "~/logic/publish/github-actions";

export interface GithubPullRequest {
  number: number;
  title: string;
  html_url: string;
  state?: "open" | "closed";
  merged_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  head: {
    ref: string;
    sha: string;
    repo?: {
      full_name: string;
      owner?: { login: string };
      name: string;
    } | null;
  };
  base: {
    ref: string;
    sha?: string;
  };
  mergeable?: boolean | null;
  mergeable_state?: string;
  labels?: Array<{ name: string; color?: string }>;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  updated_at?: string;
}

export interface GithubIssueComment {
  id: number;
  body?: string;
  html_url?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  created_at?: string;
}

export interface GithubPullReview {
  id: number;
  state: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  submitted_at?: string;
}

export interface GithubPullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url?: string;
  raw_url?: string;
  contents_url?: string;
  sha?: string;
}

function getGithubAuth() {
  const account = loadAccountState().github;
  if (!account?.token) {
    throw new Error("请先登录 GitHub 账号。");
  }
  return account;
}

function headers() {
  return {
    Authorization: `Bearer ${getGithubAuth().token}`,
    "Content-Type": "application/json",
  };
}

function repoPath(path: string) {
  return `https://api.github.com/repos/${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}${path}`;
}

export async function getCurrentGithubPermission() {
  const account = getGithubAuth();
  if (!account.username) {
    throw new Error("GitHub 账号缺少用户名。");
  }
  return githubFetch<{ permission: string; user?: unknown }>(
    repoPath(`/collaborators/${encodeURIComponent(account.username)}/permission`),
    { headers: headers() },
  );
}

let orgMembersCache: { expiresAt: number; members: Set<string> } | null = null;

export async function listOrganizationMembers(org: string): Promise<Set<string>> {
  if (orgMembersCache && orgMembersCache.expiresAt > Date.now()) {
    return new Set(orgMembersCache.members);
  }
  const members = new Set<string>();
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubFetch<
      Array<{ login?: string }>
    >(
      `https://api.github.com/orgs/${encodeURIComponent(org)}/members?per_page=100&page=${page}`,
      { headers: headers() },
    );
    for (const user of data) {
      if (user.login) members.add(user.login);
    }
    if (data.length < 100) break;
  }
  orgMembersCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    members,
  };
  return members;
}

export async function listReviewPullRequests(
  state: "open" | "closed" | "all" = "open",
) {
  const pulls = await githubFetch<GithubPullRequest[]>(
    repoPath(`/pulls?state=${state}&per_page=80&sort=updated&direction=desc`),
    { headers: headers() },
  );
  return pulls.filter((pull) => !pull.merged_at);
}

export async function getPullRequest(prNumber: number) {
  return githubFetch<GithubPullRequest>(
    repoPath(`/pulls/${prNumber}`),
    { headers: headers() },
  );
}

export async function mergePullRequest(prNumber: number) {
  const latest = await getPullRequest(prNumber);
  if (latest.mergeable === false) {
    throw new Error(
      `PR #${prNumber} 当前不可合并（mergeable_state: ${latest.mergeable_state || "unknown"}），请先更新分支。`,
    );
  }
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}/merge`),
    {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ merge_method: "merge" }),
    },
  );
}

export async function closePullRequest(prNumber: number) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}`),
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ state: "closed" }),
    },
  );
}

export async function reopenPullRequest(prNumber: number) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}`),
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ state: "open" }),
    },
  );
}

export async function listPullRequestComments(prNumber: number) {
  return githubFetch<GithubIssueComment[]>(
    repoPath(`/issues/${prNumber}/comments?per_page=100&sort=created&direction=desc`),
    { headers: headers() },
  );
}

export async function listPullRequestFiles(prNumber: number) {
  return githubFetch<GithubPullFile[]>(
    repoPath(`/pulls/${prNumber}/files?per_page=100`),
    { headers: headers() },
  );
}

export async function listPullRequestReviews(prNumber: number) {
  return githubFetch<GithubPullReview[]>(
    repoPath(`/pulls/${prNumber}/reviews?per_page=100`),
    { headers: headers() },
  );
}

export async function createPullRequestComment(prNumber: number, body: string) {
  return githubFetch<GithubIssueComment>(
    repoPath(`/issues/${prNumber}/comments`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ body }),
    },
  );
}

export async function approvePullRequest(prNumber: number, body?: string) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}/reviews`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ event: "APPROVE", body: body || "Approved from AstroBox Creator Console." }),
    },
  );
}

export async function deletePullRequestComment(commentId: number) {
  return githubFetch<unknown>(
    repoPath(`/issues/comments/${commentId}`),
    {
      method: "DELETE",
      headers: headers(),
    },
  );
}

export async function updatePullRequestComment(commentId: number, body: string) {
  return githubFetch<GithubIssueComment>(
    repoPath(`/issues/comments/${commentId}`),
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ body }),
    },
  );
}

export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
) {
  return githubFetch<{ files: GithubPullFile[] }>(
    `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    { headers: headers() },
  );
}

export async function listRepoFilesAtCommit(
  owner: string,
  repo: string,
  commitSha: string,
) {
  const auth = getGithubAuth();
  const commit = await githubFetch<{ sha: string; commit: { tree: { sha: string } } }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(commitSha)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  const tree = await githubFetch<{
    tree: Array<{ path: string; type: string; mode: string; sha: string; size?: number }>;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  return tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path);
}

/**
 * 与 listRepoFilesAtCommit 相同，但保留每个文件的字节数（size）。
 * 用于审核时获取图片/包体体积，而无需逐个下载文件。
 * 返回 truncated=true 时（仓库文件数超过上限）会丢失部分文件。
 */
export async function listRepoFileSizesAtCommit(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<{ files: Array<{ path: string; size: number }>; truncated: boolean }> {
  const auth = getGithubAuth();
  const commit = await githubFetch<{ sha: string; commit: { tree: { sha: string } } }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(commitSha)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  const tree = await githubFetch<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated?: boolean;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  return {
    files: tree.tree
      .filter((item) => item.type === "blob" && typeof item.size === "number")
      .map((item) => ({ path: item.path, size: item.size as number })),
    truncated: Boolean(tree.truncated),
  };
}

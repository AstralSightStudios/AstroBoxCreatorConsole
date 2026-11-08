import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { loadAccountState } from "~/logic/account/store";
import type { GithubAuthPurpose } from "~/logic/account/github-tokens";
import { githubFetch } from "~/logic/publish/github-actions";

export interface GithubPullRequest {
  number: number;
  title: string;
  html_url: string;
  state?: "open" | "closed";
  merged_at?: string;
  /** 合入后在默认分支上产生的提交；回退时以它的父提交作为目录行基线。 */
  merge_commit_sha?: string | null;
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
  pull_review_id?: number;
  review_state?: "APPROVE" | "REQUEST_CHANGES" | "COMMENTED";
}

function normalizeReviewState(
  state: string,
): "APPROVE" | "REQUEST_CHANGES" | "COMMENTED" {
  if (state === "APPROVED" || state === "APPROVE") return "APPROVE";
  if (state === "CHANGES_REQUESTED" || state === "REQUEST_CHANGES") {
    return "REQUEST_CHANGES";
  }
  return "COMMENTED";
}

export interface GithubPullReview {
  id: number;
  /** GitHub 返回的状态串：PENDING / APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED */
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

/** 由 githubFetch 按 auth 选项注入 Authorization，调用方不再直接拼 token。 */
function headers() {
  return {
    "Content-Type": "application/json",
  };
}

/** 显式传 token 的旧调用（发布/回查）继续使用这个 helper。 */
function primaryHeaders(token?: string) {
  return {
    Authorization: `Bearer ${token ?? getGithubAuth().token}`,
    "Content-Type": "application/json",
  };
}

function repoPath(path: string) {
  return `https://api.github.com/repos/${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}${path}`;
}

/** 与 PR 审核相同：具备仓库写入能力才算有管理权限。 */
const COMMUNITY_REPO_MANAGE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

export function hasCommunityRepoManagePermission(permission: string) {
  return COMMUNITY_REPO_MANAGE_PERMISSIONS.has(permission);
}

export async function getCurrentGithubPermission() {
  const account = getGithubAuth();
  if (!account.username) {
    throw new Error("GitHub 账号缺少用户名。");
  }
  return githubFetch<{ permission: string; user?: unknown }>(
    repoPath(`/collaborators/${encodeURIComponent(account.username)}/permission`),
    { headers: headers() },
    { auth: "primary" },
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
      { auth: "primary" },
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

export interface GithubUserProfile {
  login: string;
  /** GitHub 资料页展示名，可能为空。 */
  name?: string;
  avatar_url?: string;
}

// 用户资料基本不变，按 login 长期缓存，避免每次打开审核者抽屉都请求。
const githubUserProfileCache = new Map<string, GithubUserProfile>();

/** 拉取 GitHub 用户资料（用于审核者抽屉展示 displayname）。 */
export async function getGithubUserProfile(
  login: string,
): Promise<GithubUserProfile> {
  const key = login.trim().toLowerCase();
  const cached = githubUserProfileCache.get(key);
  if (cached) return cached;
  const profile = await githubFetch<GithubUserProfile>(
    `https://api.github.com/users/${encodeURIComponent(login.trim())}`,
    { headers: headers() },
    { auth: "read" },
  );
  githubUserProfileCache.set(key, profile);
  return profile;
}

export async function listReviewPullRequests(
  state: "open" | "closed" | "all" = "open",
) {
  const pulls = await githubFetch<GithubPullRequest[]>(
    repoPath(`/pulls?state=${state}&per_page=80&sort=updated&direction=desc`),
    { headers: headers() },
    { auth: "read" },
  );
  // 已合并或 head 分支已被删除的 PR 无法再处理，不展示。
  return pulls.filter(
    (pull) => !pull.merged_at && Boolean(pull.head?.repo),
  );
}

export async function getPullRequest(
  prNumber: number,
  purpose: GithubAuthPurpose = "read",
) {
  return githubFetch<GithubPullRequest>(
    repoPath(`/pulls/${prNumber}`),
    { headers: headers() },
    { auth: purpose },
  );
}

export async function mergePullRequest(prNumber: number) {
  // 合并链路整体走主账号：预检也读主账号视角，避免读取账号的视图影响写操作。
  const latest = await getPullRequest(prNumber, "primary");
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
    { auth: "primary" },
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
    { auth: "primary" },
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
    { auth: "primary" },
  );
}

/**
 * 轮询等待 PR 变为 open。
 *
 * 外部贡献者对目标仓库没有写权限，无法自己重开 PR，只能发 [ABCC_REOPEN] 评论，
 * 由仓库侧的 GitHub Actions 用仓库 token 代为重开。重开是异步的，这里给它一点
 * 时间；返回 false 表示超时（或期间被合并），调用方据此决定是否兜底新建 PR。
 */
export async function waitForPullRequestOpen(
  prNumber: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pr = await getPullRequest(prNumber, "primary");
    if (pr.state === "open") return true;
    // 已被合并的 PR 不该再被重开，也不必新建 PR 去替代它。
    if (pr.merged_at) return false;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** 更新 PR 标题（PATCH /pulls/{n} 的 title 字段）。 */
export async function updatePullRequestTitle(
  prNumber: number,
  title: string,
) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}`),
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ title }),
    },
    { auth: "primary" },
  );
}

export async function listPullRequestComments(prNumber: number) {
  return githubFetch<GithubIssueComment[]>(
    repoPath(`/issues/${prNumber}/comments?per_page=100&sort=created&direction=desc`),
    { headers: headers() },
    { auth: "read" },
  );
}

/**
 * 拉取所有非 PENDING 的 PR review（APPROVED / CHANGES_REQUESTED / COMMENTED），
 * 并映射成评论结构。NEEDFIX 走 review 接口，CLOSE/REFUSE/FIXED/REOPEN 走 issue
 * 评论接口。保留 body 为空的 review 以便在时间线显示「已批准」等状态。
 */
export async function listPullRequestReviewComments(
  prNumber: number,
): Promise<GithubIssueComment[]> {
  const reviews = await listPullRequestReviews(prNumber);
  return reviews
    .filter((review) => review.state !== "PENDING")
    .map((review) => {
      // GitHub 返回的状态串是 APPROVED / CHANGES_REQUESTED，与提交时用的
      // APPROVE / REQUEST_CHANGES 不同，这里统一归一化给 UI 用。
      const state = normalizeReviewState(review.state);
      return {
        id: review.id,
        body: review.body || (state === "APPROVE" ? "已批准" : state === "REQUEST_CHANGES" ? "请求变更" : "已评论"),
        user: review.user,
        created_at: review.submitted_at,
        html_url: `https://github.com/${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}/pull/${prNumber}#review-${review.id}`,
        pull_review_id: review.id,
        review_state: state,
      };
    });
}

export async function listPullRequestTimeline(
  prNumber: number,
): Promise<GithubIssueComment[]> {
  const [comments, fromReviews] = await Promise.all([
    listPullRequestComments(prNumber),
    listPullRequestReviewComments(prNumber),
  ]);
  return [...comments, ...fromReviews].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );
}

export async function listPullRequestFiles(prNumber: number) {
  return githubFetch<GithubPullFile[]>(
    repoPath(`/pulls/${prNumber}/files?per_page=100`),
    { headers: headers() },
    { auth: "read" },
  );
}

export async function listPullRequestReviews(prNumber: number) {
  return githubFetch<GithubPullReview[]>(
    repoPath(`/pulls/${prNumber}/reviews?per_page=100`),
    { headers: headers() },
    { auth: "read" },
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
    { auth: "primary" },
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
    { auth: "primary" },
  );
}

export async function requestChangesPullRequest(
  prNumber: number,
  body?: string,
) {
  const payload: Record<string, string> = { event: "REQUEST_CHANGES" };
  if (body?.trim()) {
    payload.body = body;
  }
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}/reviews`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    },
    { auth: "primary" },
  );
}

export async function deletePullRequestComment(commentId: number) {
  return githubFetch<unknown>(
    repoPath(`/issues/comments/${commentId}`),
    {
      method: "DELETE",
      headers: headers(),
    },
    { auth: "primary" },
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
    { auth: "primary" },
  );
}

export async function updatePullRequestReview(
  prNumber: number,
  reviewId: number,
  body: string,
) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}/reviews/${reviewId}`),
    {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ body }),
    },
    { auth: "primary" },
  );
}

export async function deletePullRequestReview(
  prNumber: number,
  reviewId: number,
) {
  return githubFetch<unknown>(
    repoPath(`/pulls/${prNumber}/reviews/${reviewId}`),
    {
      method: "DELETE",
      headers: headers(),
    },
    { auth: "primary" },
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
    { auth: "read" },
  );
}

export interface GithubCommitInfo {
  sha: string;
  html_url?: string;
  commit: {
    message?: string;
    author?: {
      name?: string;
      email?: string;
      date?: string;
    };
  };
  parents: Array<{ sha: string }>;
  /** 单提交详情接口会返回文件 patch；搜索接口通常不返回。 */
  files?: GithubPullFile[];
}

export interface GithubCommitSearchResult {
  total_count: number;
  incomplete_results?: boolean;
  items: GithubCommitInfo[];
}

/** 读取单个提交（含父提交与文件 patch），用于定位 PR 合入前的目录状态。 */
export async function getRepoCommit(
  owner: string,
  repo: string,
  ref: string,
  token?: string,
) {
  return githubFetch<GithubCommitInfo>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    { headers: token ? primaryHeaders(token) : headers() },
    token ? undefined : { auth: "read" },
  );
}

/**
 * 定向搜索提交信息。资源 ID 反查只依赖这里返回的少量候选，不遍历目录历史。
 * `term` 请传入已经加引号的搜索词，避免仓库名被 GitHub 搜索语法拆开。
 */
export async function searchRepoCommits(
  owner: string,
  repo: string,
  term: string,
  perPage = 8,
  token?: string,
) {
  const params = new URLSearchParams({
    q: `repo:${owner}/${repo} ${term}`,
    sort: "committer-date",
    order: "desc",
    per_page: String(perPage),
  });
  return githubFetch<GithubCommitSearchResult>(
    `https://api.github.com/search/commits?${params.toString()}`,
    { headers: token ? primaryHeaders(token) : headers() },
    token ? undefined : { auth: "primary" },
  );
}

export async function listRepoFilesAtCommit(
  owner: string,
  repo: string,
  commitSha: string,
) {
  const commit = await githubFetch<{ sha: string; commit: { tree: { sha: string } } }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(commitSha)}`,
    { headers: headers() },
    { auth: "read" },
  );
  const tree = await githubFetch<{
    tree: Array<{ path: string; type: string; mode: string; sha: string; size?: number }>;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    { headers: headers() },
    { auth: "read" },
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
  const commit = await githubFetch<{ sha: string; commit: { tree: { sha: string } } }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(commitSha)}`,
    { headers: headers() },
    { auth: "read" },
  );
  const tree = await githubFetch<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated?: boolean;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    { headers: headers() },
    { auth: "read" },
  );
  return {
    files: tree.tree
      .filter((item) => item.type === "blob" && typeof item.size === "number")
      .map((item) => ({ path: item.path, size: item.size as number })),
    truncated: Boolean(tree.truncated),
  };
}

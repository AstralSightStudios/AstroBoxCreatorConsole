import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { loadAccountState } from "~/logic/account/store";
import { githubFetch } from "~/logic/publish/github-actions";

export interface GithubPullRequest {
  number: number;
  title: string;
  html_url: string;
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
  };
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

export async function listOpenPullRequests() {
  return githubFetch<GithubPullRequest[]>(
    repoPath("/pulls?state=open&per_page=80&sort=updated&direction=desc"),
    { headers: headers() },
  );
}

export async function listPullRequestComments(prNumber: number) {
  return githubFetch<GithubIssueComment[]>(
    repoPath(`/issues/${prNumber}/comments?per_page=100`),
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

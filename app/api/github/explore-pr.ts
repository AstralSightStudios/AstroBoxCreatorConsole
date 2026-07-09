import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { loadAccountState } from "~/logic/account/store";
import { ensureBase64, githubFetch } from "~/logic/publish/github-actions";

export interface ExplorePrResult {
  htmlUrl: string;
  branch: string;
}

export interface MediaUpload {
  file: File;
  path: string;
}

export interface ExploreSubmissionInput {
  jsonText: string;
  mediaUploads: MediaUpload[];
  deletes: string[];
  newFolders: string[];
  branch?: string;
}

export function buildExploreBranchName() {
  const account = getGithubAuth();
  return `explore/${Date.now()}-${account.username}`;
}

function getGithubAuth() {
  const account = loadAccountState().github;
  if (!account?.token || !account.username) {
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

function repoApi(path: string) {
  return `https://api.github.com/repos/${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}${path}`;
}

function encodeContentPath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function getMainRef() {
  return githubFetch<{ object: { sha: string } }>(
    repoApi(`/git/ref/heads/${COMMUNITY_REPO_CONFIG.defaultBranch}`),
    { headers: headers() },
  );
}

async function createBranch(branch: string, sha: string) {
  return githubFetch<unknown>(repoApi("/git/refs"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha,
    }),
  });
}

async function getContent(path: string, ref: string) {
  return githubFetch<{ sha: string; content: string; encoding: string }>(
    repoApi(`/contents/${encodeContentPath(path)}?ref=${encodeURIComponent(ref)}`),
    { headers: headers() },
  );
}

async function putContent(params: {
  path: string;
  branch: string;
  message: string;
  contentBase64: string;
  sha?: string;
}) {
  return githubFetch<unknown>(repoApi(`/contents/${encodeContentPath(params.path)}`), {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      message: params.message,
      content: params.contentBase64,
      branch: params.branch,
      sha: params.sha,
    }),
  });
}

async function deleteContent(params: {
  path: string;
  branch: string;
  message: string;
  sha: string;
}) {
  return githubFetch<unknown>(repoApi(`/contents/${encodeContentPath(params.path)}`), {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify({
      message: params.message,
      branch: params.branch,
      sha: params.sha,
    }),
  });
}

async function createPullRequest(branch: string) {
  return githubFetch<{ html_url: string }>(repoApi("/pulls"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      title: "[ABCC] Update explore page",
      body: "Update explore_v2.json from AstroBox Creator Console.",
      base: COMMUNITY_REPO_CONFIG.defaultBranch,
      head: branch,
    }),
  });
}

export async function fetchExploreJson() {
  const { content } = await getContent(
    COMMUNITY_REPO_CONFIG.exploreFilePath,
    COMMUNITY_REPO_CONFIG.defaultBranch,
  );
  const raw = new TextDecoder().decode(
    Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
  );
  return raw;
}

export async function submitExplorePr(
  params: ExploreSubmissionInput,
): Promise<ExplorePrResult> {
  const account = getGithubAuth();
  const branch = params.branch || `explore/${Date.now()}-${account.username}`;
  const mainRef = await getMainRef();
  await createBranch(branch, mainRef.object.sha);

  const current = await getContent(
    COMMUNITY_REPO_CONFIG.exploreFilePath,
    COMMUNITY_REPO_CONFIG.defaultBranch,
  );
  await putContent({
    path: COMMUNITY_REPO_CONFIG.exploreFilePath,
    branch,
    message: "Update explore_v2.json",
    contentBase64: ensureBase64(params.jsonText),
    sha: current.sha,
  });

  for (const folderPath of params.newFolders) {
    const keepPath = `${stripTrailingSlash(folderPath)}/.gitkeep`;
    await putContent({
      path: keepPath,
      branch,
      message: `Create directory ${folderPath}`,
      contentBase64: ensureBase64(""),
    });
  }

  for (const upload of params.mediaUploads) {
    const buffer = await upload.file.arrayBuffer();
    await putContent({
      path: upload.path,
      branch,
      message: `Add ${upload.path.split("/").pop() || upload.path}`,
      contentBase64: ensureBase64(buffer),
    });
  }

  for (const deletePath of params.deletes) {
    const meta = await getContent(deletePath, COMMUNITY_REPO_CONFIG.defaultBranch).catch(
      () => null,
    );
    if (!meta) continue;
    await deleteContent({
      path: deletePath,
      branch,
      message: `Delete ${deletePath}`,
      sha: meta.sha,
    });
  }

  const pr = await createPullRequest(branch);
  return { htmlUrl: pr.html_url, branch } satisfies ExplorePrResult;
}

function stripTrailingSlash(path: string) {
  return path.replace(/\/+$/, "");
}

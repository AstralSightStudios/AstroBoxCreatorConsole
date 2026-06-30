import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";

export interface RepoInfo {
    owner: string;
    name: string;
    branch: string;
    htmlUrl?: string;
    commitSha?: string;
}

interface UploadParams {
    token: string;
    repo: RepoInfo;
    path: string;
    content: string;
    message: string;
    sha?: string;
    branch?: string;
}

export interface PullRequestPayload {
    token: string;
    baseOwner: string;
    baseRepo: string;
    baseBranch: string;
    headOwner: string;
    headRepo: string;
    headBranch: string;
    title: string;
    body?: string;
}

export function getGithubTokenOrThrow(): string {
    const token = loadAccountState().github?.token;
    if (!token) {
        throw new Error("未登录 GitHub，无法创建仓库或提交 PR。");
    }
    return token;
}

/**
 * Validate a GitHub repository name.
 * Rules: only alphanumeric, hyphens, underscores, dots; cannot start/end with hyphen; max 100 chars.
 */
export function validateRepoName(name: string): string | null {
    if (!name || name.trim().length === 0) return "仓库名不能为空";
    if (name.length > 100) return "仓库名不能超过 100 个字符";
    if (!/^[a-zA-Z0-9]/.test(name)) return "仓库名必须以字母或数字开头";
    if (!/[a-zA-Z0-9]$/.test(name)) return "仓库名必须以字母或数字结尾";
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return "仓库名只能包含字母、数字、点、连字符和下划线";
    return null; // valid
}

export async function githubFetch<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: {
            Accept: "application/vnd.github+json",
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${response.status}: ${text}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    if (!text) {
        return undefined as T;
    }

    return JSON.parse(text) as T;
}

/**
 * Parse the GitHub API 422 error body to determine if it's "already exists".
 */
function isRepoAlreadyExists422(errorBody: string): boolean {
    try {
        const parsed = JSON.parse(errorBody);
        const errors = parsed.errors;
        if (!Array.isArray(errors)) return false;
        return errors.some(
            (e: any) => e.code === "already_exists" || e.field === "name",
        );
    } catch {
        // If we can't parse, check common patterns in raw text
        return /already.exists|name.*already/i.test(errorBody);
    }
}

export async function createUserRepo(
    repoName: string,
    description: string,
    tokenOverride?: string,
): Promise<RepoInfo> {
    const token = tokenOverride ?? getGithubTokenOrThrow();

    // Validate repo name before calling API
    const nameError = validateRepoName(repoName);
    if (nameError) {
        throw new Error(`仓库名无效：${nameError}`);
    }

    const body = {
        name: repoName,
        description,
        private: false,
        auto_init: true,
        default_branch: PUBLISH_CONFIG.defaultBranch,
    };

    const state = loadAccountState();
    const currentOwner = state.github?.username;
    if (!currentOwner) {
        throw new Error("无法获取当前 GitHub 用户名，请重新登录。");
    }

    const data = await githubFetch<any>("https://api.github.com/user/repos", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }).catch(async (error) => {
        if (!(error instanceof Error) || !/422/.test(error.message)) {
            throw error;
        }

        // Extract the response body from the error message: "GitHub API 422: {body}"
        const errorBody = error.message.replace(/^GitHub API 422:\s*/, "");

        // Only treat as "already exists" if the error body confirms it
        if (!isRepoAlreadyExists422(errorBody)) {
            throw new Error(
                `仓库创建被 GitHub 拒绝（422）：${errorBody}\n` +
                `请检查仓库名 "${repoName}" 是否合法，或更换仓库名重试。`,
            );
        }

        // Repo already exists — fetch it and verify ownership
        const existing = await githubFetch<any>(
            `https://api.github.com/repos/${currentOwner}/${repoName}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            },
        ).catch(() => null);

        if (!existing) {
            throw new Error(
                `仓库 ${currentOwner}/${repoName} 已存在但无法访问。` +
                `可能是私有仓库或权限不足。`,
            );
        }

        if (existing.owner?.login !== currentOwner) {
            throw new Error(
                `仓库名 ${repoName} 已被其他用户 ${existing.owner?.login} 占用，请更换仓库名。`,
            );
        }

        return existing;
    });

    return {
        owner: data.owner?.login || currentOwner,
        name: data.name,
        branch: data.default_branch || PUBLISH_CONFIG.defaultBranch,
        htmlUrl: data.html_url,
    };
}

export function ensureBase64(content: ArrayBuffer | string) {
    if (typeof content === "string") {
        return btoa(unescape(encodeURIComponent(content)));
    }
    const uint8 = new Uint8Array(content);
    let binary = "";
    uint8.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

export async function getRepoFile(params: {
    repo: RepoInfo;
    path: string;
    tokenOverride?: string;
    ref?: string;
}) {
    const { repo, path, tokenOverride, ref } = params;
    const token = tokenOverride ?? getGithubTokenOrThrow();
    return githubFetch<any>(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${encodeURIComponent(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );
}

export async function uploadFileToRepo(params: UploadParams) {
    const { token, repo, path, content, message, sha, branch } = params;
    return githubFetch<any>(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${encodeURIComponent(path)}`,
        {
            method: "PUT",
            body: JSON.stringify({
                message,
                content,
                branch: branch || repo.branch,
                sha,
            }),
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        },
    );
}

export async function uploadBinaryFile(
    repo: RepoInfo,
    path: string,
    file: File,
    message: string,
    tokenOverride?: string,
    options?: { sha?: string; branch?: string },
) {
    const token = tokenOverride ?? getGithubTokenOrThrow();
    const buffer = await file.arrayBuffer();
    const content = ensureBase64(buffer);
    return uploadFileToRepo({
        token,
        repo,
        path,
        content,
        message,
        sha: options?.sha,
        branch: options?.branch,
    });
}

export async function uploadTextFile(
    repo: RepoInfo,
    path: string,
    text: string,
    message: string,
    tokenOverride?: string,
    options?: { sha?: string; branch?: string },
) {
    const token = tokenOverride ?? getGithubTokenOrThrow();
    const content = ensureBase64(text);
    return uploadFileToRepo({
        token,
        repo,
        path,
        content,
        message,
        sha: options?.sha,
        branch: options?.branch,
    });
}

// --- Git Data API (batch upload) ---

export interface GitBlobRef {
    sha: string;
    path: string;
    mode: "100644";
    type: "blob";
}

/**
 * Create a Git blob from base64-encoded content.
 * Returns the blob SHA.
 */
export async function createBlob(
    repo: RepoInfo,
    base64Content: string,
    token: string,
): Promise<string> {
    try {
        const data = await githubFetch<{ sha: string }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/blobs`,
            {
                method: "POST",
                body: JSON.stringify({ content: base64Content, encoding: "base64" }),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
        return data.sha;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `创建 Git blob 失败 (size=${base64Content.length}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Get the current commit SHA and tree SHA for a branch.
 */
export async function getBranchHead(
    repo: RepoInfo,
    token: string,
): Promise<{ commitSha: string; treeSha: string }> {
    const branchRef = `refs/heads/${repo.branch}`;
    try {
        const data = await githubFetch<{
            object: { sha: string };
        }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeURIComponent(repo.branch)}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            },
        );
        const commitSha = data.object.sha;

        const commit = await githubFetch<{ tree: { sha: string } }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/commits/${commitSha}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            },
        );
        return { commitSha, treeSha: commit.tree.sha };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `获取分支 HEAD 失败 (${repo.owner}/${repo.name}#${repo.branch}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Create a new Git tree from a base tree and a list of blob entries.
 */
export async function createTree(
    repo: RepoInfo,
    baseTreeSha: string,
    entries: GitBlobRef[],
    token: string,
): Promise<string> {
    const body: Record<string, unknown> = { tree: entries };
    // Only include base_tree if provided (empty string means create from scratch)
    if (baseTreeSha) {
        body.base_tree = baseTreeSha;
    }

    try {
        const data = await githubFetch<{ sha: string }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees`,
            {
                method: "POST",
                body: JSON.stringify(body),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
        return data.sha;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `创建 Git tree 失败 (base_tree=${baseTreeSha || "无"}, entries=${entries.length}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Create a commit pointing to a tree.
 */
export async function createCommit(
    repo: RepoInfo,
    message: string,
    treeSha: string,
    parentCommitSha: string,
    token: string,
): Promise<string> {
    try {
        const data = await githubFetch<{ sha: string }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/commits`,
            {
                method: "POST",
                body: JSON.stringify({
                    message,
                    tree: treeSha,
                    parents: [parentCommitSha],
                }),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
        return data.sha;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `创建 Git commit 失败 (tree=${treeSha}, parent=${parentCommitSha}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Create an initial commit with no parent (for empty repos).
 */
export async function createInitialCommit(
    repo: RepoInfo,
    message: string,
    treeSha: string,
    token: string,
): Promise<string> {
    try {
        const data = await githubFetch<{ sha: string }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/commits`,
            {
                method: "POST",
                body: JSON.stringify({
                    message,
                    tree: treeSha,
                    // no parents — this is the root commit
                }),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
        return data.sha;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `创建初始 Git commit 失败 (tree=${treeSha}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Create a branch ref (for repos with no branches yet).
 */
export async function createRef(
    repo: RepoInfo,
    commitSha: string,
    token: string,
): Promise<void> {
    try {
        await githubFetch<any>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs`,
            {
                method: "POST",
                body: JSON.stringify({
                    ref: `refs/heads/${repo.branch}`,
                    sha: commitSha,
                }),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(
                `创建分支引用失败 (${repo.owner}/${repo.name}#${repo.branch}, commit=${commitSha}): ${error.message}`,
            );
        }
        throw error;
    }
}

/**
 * Update a branch ref to point to a new commit.
 * Tries non-force first; falls back to force update on 409 (non-fast-forward).
 * If the ref doesn't exist (404), creates it instead.
 */
export async function updateRef(
    repo: RepoInfo,
    commitSha: string,
    token: string,
): Promise<void> {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeURIComponent(repo.branch)}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };

    try {
        await githubFetch<any>(url, {
            method: "PATCH",
            body: JSON.stringify({ sha: commitSha, force: false }),
            headers,
        });
    } catch (error) {
        if (error instanceof Error) {
            // 404: ref doesn't exist — create it instead
            if (/404/.test(error.message)) {
                await createRef(repo, commitSha, token);
                return;
            }
            // 409/422: non-fast-forward or conflict — retry with force
            if (/409|422/.test(error.message)) {
                try {
                    await githubFetch<any>(url, {
                        method: "PATCH",
                        body: JSON.stringify({ sha: commitSha, force: true }),
                        headers,
                    });
                    return;
                } catch (forceError) {
                    throw new Error(
                        `更新分支引用失败 (force=true, commit=${commitSha}): ${(forceError as Error).message}`,
                    );
                }
            }
            throw new Error(
                `更新分支引用失败 (${repo.owner}/${repo.name}#${repo.branch}, commit=${commitSha}): ${error.message}`,
            );
        }
        throw error;
    }
}

export async function createPullRequest(payload: PullRequestPayload) {
    const { token, baseOwner, baseRepo, baseBranch, headOwner, headBranch, title, body } =
        payload;

    return githubFetch<any>(
        `https://api.github.com/repos/${baseOwner}/${baseRepo}/pulls`,
        {
            method: "POST",
            body: JSON.stringify({
                title,
                body,
                base: baseBranch,
                head: `${headOwner}:${headBranch}`,
            }),
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        },
    );
}

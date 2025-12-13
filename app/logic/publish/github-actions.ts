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

function getGithubTokenOrThrow(): string {
    const token = loadAccountState().github?.token;
    if (!token) {
        throw new Error("未登录 GitHub，无法创建仓库或提交 PR。");
    }
    return token;
}

export function resolveRepoNameFromId(itemId: string, fallbackName: string) {
    return itemId
        ? PUBLISH_CONFIG.repoNamePrefix +
              itemId
                  .toLowerCase()
                  .replace(/[^a-z0-9._-]/g, "-")
                  .replace(/--+/g, "-")
                  .replace(/^-+|-+$/g, "")
        : fallbackName;
}

export async function githubFetch<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
        cache: "no-store",
        ...init,
        headers: {
            Accept: "application/vnd.github+json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
}

export async function createUserRepo(
    repoName: string,
    description: string,
): Promise<RepoInfo> {
    const token = getGithubTokenOrThrow();
    const body = {
        name: repoName,
        description,
        private: false,
        auto_init: true,
        default_branch: PUBLISH_CONFIG.defaultBranch,
    };

    const data = await githubFetch<any>("https://api.github.com/user/repos", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }).catch(async (error) => {
        if (error instanceof Error && /422/.test(error.message)) {
            // repo already exists, attempt to fetch info
            const state = loadAccountState();
            const owner = state.github?.username;
            if (!owner) throw error;
            const fallback = await githubFetch<any>(
                `https://api.github.com/repos/${owner}/${repoName}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
            return fallback;
        }
        throw error;
    });

    return {
        owner: data.owner?.login,
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

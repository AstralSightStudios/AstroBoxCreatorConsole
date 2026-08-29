import { MAIN_RESOURCE_BRANCH } from "./branch";
import { loadAccountState } from "../account/store";
import { log } from "~/logic/logging";

const isWeb =
    typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__;

function proxyGithubUrl(url: string): string {
    if (isWeb && url.startsWith("https://api.github.com/")) {
        return url.replace("https://api.github.com/", "/github-api/");
    }
    return url;
}

/** 从 RequestInit 中提取可读的请求方法（用于日志）。 */
function describeMethod(init: RequestInit): string {
    return (init.method ?? "GET").toUpperCase();
}

export interface RepoInfo {
    owner: string;
    name: string;
    branch: string;
    sourceBranch?: string;
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

// --- GitHub API core: typed errors + timeout + retry with backoff ---

const DEFAULT_TIMEOUT_MS = 60_000;
// 大文件（blob / Contents API PUT）在慢速网络下可能传很久，放宽超时
const UPLOAD_TIMEOUT_MS = 300_000;
const DEFAULT_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 60_000;

export interface GithubFetchOptions {
    timeoutMs?: number;
    retries?: number;
}

export class GithubApiError extends Error {
    readonly status: number;
    readonly url: string;
    readonly body: string;

    constructor(status: number, url: string, body: string, message?: string) {
        super(message ?? buildGithubErrorMessage(status, body));
        this.name = "GithubApiError";
        this.status = status;
        this.url = url;
        this.body = body;
    }
}

export function isGithubStatus(error: unknown, ...codes: number[]): boolean {
    return error instanceof GithubApiError && codes.includes(error.status);
}

/** Prefix an error with a context message while preserving the HTTP status. */
export function withGithubContext(error: unknown, context: string): Error {
    if (error instanceof GithubApiError) {
        return new GithubApiError(
            error.status,
            error.url,
            error.body,
            `${context}: ${error.message}`,
        );
    }
    if (error instanceof Error) {
        return new Error(`${context}: ${error.message}`);
    }
    return new Error(`${context}: ${String(error)}`);
}

function parseGithubErrorDetail(body: string): string {
    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.message === "string") {
            const errors = Array.isArray(parsed.errors) && parsed.errors.length
                ? ` (${JSON.stringify(parsed.errors)})`
                : "";
            return `${parsed.message}${errors}`;
        }
    } catch {
        // not JSON — fall through to raw text
    }
    return body.slice(0, 300);
}

function buildGithubErrorMessage(status: number, body: string): string {
    if (status === 401) {
        return "GitHub 登录已失效（401），请重新登录 GitHub 后重试。";
    }
    const detail = parseGithubErrorDetail(body);
    if (status === 403 && /rate limit|abuse/i.test(body)) {
        return `GitHub 触发了速率限制（403），请稍等一分钟后重试。${detail}`;
    }
    return `GitHub API ${status}: ${detail}`;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(status: number, response: Response, body: string): boolean {
    if (status === 429) return true;
    if (status !== 403) return false;
    if (response.headers.get("retry-after")) return true;
    if (response.headers.get("x-ratelimit-remaining") === "0") return true;
    return /rate limit|abuse/i.test(body);
}

function retryDelayMs(attempt: number, response?: Response): number {
    const retryAfter = Number(response?.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
    }
    const reset = Number(response?.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) {
        const wait = reset * 1000 - Date.now();
        if (wait > 0) return Math.min(wait + 1000, MAX_RETRY_WAIT_MS);
    }
    return Math.min(800 * 2 ** attempt, 15_000) + Math.random() * 400;
}

/**
 * Fetch against the GitHub API with:
 * - request timeout (AbortController)
 * - automatic retry with backoff for network errors, 5xx, 429 and
 *   403 secondary-rate-limit responses (honoring Retry-After)
 * - typed GithubApiError carrying the HTTP status for callers to branch on
 */
export async function githubFetch<T>(
    url: string,
    init: RequestInit,
    options?: GithubFetchOptions,
): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = options?.retries ?? DEFAULT_RETRIES;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = performance.now();
        let response: Response;
        try {
            response = await fetch(proxyGithubUrl(url), {
                ...init,
                signal: controller.signal,
                headers: {
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    ...(init.headers || {}),
                },
            });
        } catch (error) {
            clearTimeout(timer);
            const aborted = (error as Error)?.name === "AbortError";
            lastError = new Error(
                aborted
                    ? `GitHub 请求超时（${Math.round(timeoutMs / 1000)} 秒无响应）。`
                    : "GitHub 网络连接失败，请检查网络。",
            );
            if (attempt < retries) {
                log.warn("github/fetch", `${describeMethod(init)} ${url} 网络失败(第 ${attempt + 1} 次)，将重试`, {
                    data: { error, timeoutMs },
                });
                await sleep(retryDelayMs(attempt));
                continue;
            }
            log.error("github/fetch", `${describeMethod(init)} ${url} 网络失败，已达最大重试`, {
                data: { error, attempts: retries + 1, durationMs: Math.round(performance.now() - startedAt) },
            });
            throw lastError;
        }
        clearTimeout(timer);

        if (response.ok) {
            log.debug("github/fetch", `${describeMethod(init)} ${url} → ${response.status}`, {
                data: { durationMs: Math.round(performance.now() - startedAt), status: response.status },
            });
            if (response.status === 204) {
                return undefined as T;
            }
            const text = await response.text();
            if (!text) {
                return undefined as T;
            }
            try {
                return JSON.parse(text) as T;
            } catch {
                // 中间代理/网关可能返回非 JSON（如 HTML 错误页）
                log.error("github/fetch", `${describeMethod(init)} ${url} 返回非 JSON 响应`, {
                    data: { bodyPreview: text.slice(0, 200) },
                });
                throw new Error(
                    `GitHub 返回了无法解析的响应（可能被代理或网关篡改）：${text.slice(0, 120)}`,
                );
            }
        }

        const bodyText = await response.text().catch(() => "");
        const apiError = new GithubApiError(response.status, url, bodyText);
        const retryable =
            response.status >= 500 ||
            isRateLimited(response.status, response, bodyText);
        if (retryable && attempt < retries) {
            log.warn("github/fetch", `${describeMethod(init)} ${url} → HTTP ${response.status}(第 ${attempt + 1} 次)，将重试`, {
                data: { status: response.status, bodyPreview: bodyText.slice(0, 300) },
            });
            lastError = apiError;
            await sleep(retryDelayMs(attempt, response));
            continue;
        }
        log.error("github/fetch", `${describeMethod(init)} ${url} → HTTP ${response.status}`, {
            data: {
                status: response.status,
                bodyPreview: bodyText.slice(0, 500),
                attempts: attempt + 1,
                durationMs: Math.round(performance.now() - startedAt),
            },
        });
        throw apiError;
    }

    throw lastError ?? new Error("GitHub 请求失败。");
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

/**
 * Repo creation with auto_init lands the initial commit asynchronously.
 * Poll until the default branch ref resolves so follow-up Git Data API
 * calls don't hit a transient 404/409 on a half-initialized repo.
 */
async function waitForInitialCommit(repo: RepoInfo, token: string) {
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            await getBranchRefSha(repo, repo.branch, token);
            return;
        } catch (error) {
            if (!isGithubStatus(error, 404, 409)) throw error;
        }
        await sleep(800 * (attempt + 1));
    }
    // 初始化提交迟迟未落地也不阻塞：后续上传流程自带空仓库兜底路径
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
    };

    const state = loadAccountState();
    const currentOwner = state.github?.username;
    if (!currentOwner) {
        throw new Error("无法获取当前 GitHub 用户名，请重新登录。");
    }

    let isFreshRepo = true;
    const data = await githubFetch<any>("https://api.github.com/user/repos", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            Authorization: `Bearer ${token}`,
        },
    }).catch(async (error) => {
        if (!isGithubStatus(error, 422)) {
            throw error;
        }
        const errorBody = (error as GithubApiError).body;

        // Only treat as "already exists" if the error body confirms it
        if (!isRepoAlreadyExists422(errorBody)) {
            throw new Error(
                `仓库创建被 GitHub 拒绝（422）：${parseGithubErrorDetail(errorBody)}\n` +
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

        isFreshRepo = false;
        return existing;
    });

    const repo: RepoInfo = {
        owner: data.owner?.login || currentOwner,
        name: data.name,
        branch: data.default_branch || MAIN_RESOURCE_BRANCH,
        htmlUrl: data.html_url,
    };

    if (isFreshRepo) {
        await waitForInitialCommit(repo, token);
    }

    return repo;
}

export function ensureBase64(content: ArrayBuffer | Uint8Array | string) {
    const bytes =
        typeof content === "string"
            ? new TextEncoder().encode(content)
            : content instanceof Uint8Array
              ? content
              : new Uint8Array(content);

    // 分块转换，避免逐字节拼接在大文件上卡死主线程 / 撑爆内存
    const CHUNK = 0x8000;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const chunk = bytes.subarray(i, i + CHUNK);
        parts.push(String.fromCharCode(...chunk));
    }
    return btoa(parts.join(""));
}

function encodeGitRefName(refName: string) {
    return refName
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

async function getBranchRefSha(repo: RepoInfo, branch: string, token: string) {
    const data = await githubFetch<{ object?: { sha?: string } }>(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeGitRefName(branch)}`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
    const sha = data.object?.sha;
    if (!sha) {
        throw new Error(`无法读取分支 ${repo.owner}/${repo.name}#${branch} 的提交。`);
    }
    return sha;
}

async function getRepositoryDefaultBranch(repo: RepoInfo, token: string) {
    const data = await githubFetch<{ default_branch?: string }>(
        `https://api.github.com/repos/${repo.owner}/${repo.name}`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
    return data.default_branch?.trim() || MAIN_RESOURCE_BRANCH;
}

export async function ensureMainResourceBranch(repo: RepoInfo, token: string) {
    if (repo.branch !== MAIN_RESOURCE_BRANCH) return;
    let sourceBranch = repo.sourceBranch?.trim();

    try {
        await getBranchRefSha(repo, MAIN_RESOURCE_BRANCH, token);
        return;
    } catch (error) {
        if (!isGithubStatus(error, 404, 409)) {
            throw error;
        }
        sourceBranch ||= await getRepositoryDefaultBranch(repo, token);
        if (sourceBranch === MAIN_RESOURCE_BRANCH) return;
    }

    let sourceSha: string;
    try {
        sourceSha = await getBranchRefSha(repo, sourceBranch, token);
    } catch (error) {
        // 空仓库（连源分支都没有）：交给上传流程的空仓库兜底路径
        if (isGithubStatus(error, 404, 409)) return;
        throw error;
    }
    try {
        await githubFetch<any>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs`,
            {
                method: "POST",
                body: JSON.stringify({
                    ref: `refs/heads/${MAIN_RESOURCE_BRANCH}`,
                    sha: sourceSha,
                }),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );
    } catch (error) {
        if (isGithubStatus(error, 422)) {
            await getBranchRefSha(repo, MAIN_RESOURCE_BRANCH, token);
            return;
        }
        throw error;
    }
}

export interface UserRepoSummary {
    name: string;
    defaultBranch: string;
    updatedAt: string;
}

export async function listCurrentUserRepos(
    tokenOverride?: string,
): Promise<UserRepoSummary[]> {
    const token = tokenOverride ?? getGithubTokenOrThrow();
    const data = await githubFetch<any[]>(
        "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed",
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
    return (data || [])
        .filter((repo) => repo && repo.name)
        .map((repo) => ({
            name: repo.name as string,
            defaultBranch: (repo.default_branch as string) || MAIN_RESOURCE_BRANCH,
            updatedAt: (repo.pushed_at || repo.updated_at || "") as string,
        }));
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
        { timeoutMs: UPLOAD_TIMEOUT_MS },
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
            { timeoutMs: UPLOAD_TIMEOUT_MS },
        );
        return data.sha;
    } catch (error) {
        throw withGithubContext(
            error,
            `创建 Git blob 失败 (size=${base64Content.length})`,
        );
    }
}

/**
 * Get the current commit SHA and tree SHA for a branch.
 */
export async function getBranchHead(
    repo: RepoInfo,
    token: string,
): Promise<{ commitSha: string; treeSha: string }> {
    try {
        const data = await githubFetch<{
            object: { sha: string };
        }>(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeGitRefName(repo.branch)}`,
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
        throw withGithubContext(
            error,
            `获取分支 HEAD 失败 (${repo.owner}/${repo.name}#${repo.branch})`,
        );
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
        throw withGithubContext(
            error,
            `创建 Git tree 失败 (base_tree=${baseTreeSha || "无"}, entries=${entries.length})`,
        );
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
        throw withGithubContext(
            error,
            `创建 Git commit 失败 (tree=${treeSha}, parent=${parentCommitSha})`,
        );
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
        throw withGithubContext(error, `创建初始 Git commit 失败 (tree=${treeSha})`);
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
        throw withGithubContext(
            error,
            `创建分支引用失败 (${repo.owner}/${repo.name}#${repo.branch}, commit=${commitSha})`,
        );
    }
}

/**
 * Update a branch ref to point to a new commit.
 * Tries non-force first; falls back to force update on 409/422 (non-fast-forward).
 * If the ref doesn't exist (404), creates it instead.
 */
export async function updateRef(
    repo: RepoInfo,
    commitSha: string,
    token: string,
): Promise<void> {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeGitRefName(repo.branch)}`;
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
        // 404: ref doesn't exist — create it instead
        if (isGithubStatus(error, 404)) {
            await createRef(repo, commitSha, token);
            return;
        }
        // 409/422: non-fast-forward or conflict — retry with force
        if (isGithubStatus(error, 409, 422)) {
            try {
                await githubFetch<any>(url, {
                    method: "PATCH",
                    body: JSON.stringify({ sha: commitSha, force: true }),
                    headers,
                });
                return;
            } catch (forceError) {
                throw withGithubContext(
                    forceError,
                    `更新分支引用失败 (force=true, commit=${commitSha})`,
                );
            }
        }
        throw withGithubContext(
            error,
            `更新分支引用失败 (${repo.owner}/${repo.name}#${repo.branch}, commit=${commitSha})`,
        );
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

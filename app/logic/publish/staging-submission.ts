import { PUBLISH_CONFIG } from "~/config/publish";
import { log } from "~/logic/logging";
import { loadAccountState } from "../account/store";
import {
    createBlob,
    createCommit,
    createPullRequest,
    createTree,
    ensureBase64,
    getBranchHead,
    githubFetch,
    updateRef,
    type RepoInfo,
} from "./github-actions";
import {
    createBranch,
    fetchCatalogEntries,
    findCatalogEntryById,
    getOrCreateFork,
    getRefSha,
    normalizeCatalogPaidType,
    type CatalogEntry,
    type CatalogUpdateRequest,
} from "./catalog";
import { syncForkDefaultBranch } from "./fork";
import {
    buildClientInfo,
    buildCreateSubmissionRequest,
    buildDeleteSubmissionRequest,
    buildDeletionSubmissionPath,
    buildEditSubmissionRequest,
    buildSubmissionCsv,
    buildSubmissionPath,
    buildSubmissionRequest,
    canonicalCatalogEntryDigest,
    isSubmissionFilePath,
    parseSubmissionCsv,
    parseSubmissionRequestJson,
    submissionCsvPath,
    submissionRequestPath,
    type SubmissionMode,
    type SubmissionRequest,
} from "./submission-protocol";

function getGithubTokenOrThrow() {
    const token = loadAccountState().github?.token;
    if (!token) throw new Error("未登录 GitHub，无法提交资源请求。");
    return token;
}

function requireGithubLogin() {
    const login = loadAccountState().github?.username?.trim();
    if (!login) throw new Error("GitHub 账号缺少用户名，无法创建提交路径。");
    return login;
}

export function buildSubmissionEntry(payload: CatalogUpdateRequest): CatalogEntry {
    const vendors = Array.from(
        new Set(payload.devices.map((device) => device.vendor).filter(Boolean)),
    ).join(";");
    const deviceIds = Array.from(
        new Set(payload.devices.map((device) => device.id)),
    ).join(";");
    return {
        id: payload.itemId.trim(),
        name: payload.itemName.trim(),
        restype: payload.restype,
        repo_owner: payload.repoInfo.owner,
        repo_name: payload.repoInfo.name,
        repo_commit_hash: payload.repoInfo.commitSha.slice(0, 7),
        icon: payload.iconPath,
        cover: payload.coverPath,
        tags: payload.tags.join(";"),
        device_vendors: vendors,
        devices: deviceIds,
        paid_type: normalizeCatalogPaidType(payload.paidType),
    };
}

async function listOpenPulls(
    token: string,
): Promise<Array<{ number: number; title: string }>> {
    const pulls = await githubFetch<
        Array<{ number: number; title?: string }>
    >(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls?state=open&per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    return pulls.map((pull) => ({ number: pull.number, title: pull.title ?? "" }));
}

/** 经 Git Blobs API 读取文件内容（pull files 端点只给 sha）。 */
async function fetchBlobText(token: string, sha: string): Promise<string> {
    const blob = await githubFetch<{ content?: string; encoding?: string }>(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/git/blobs/${sha}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (blob.encoding !== "base64" || !blob.content) return "";
    const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (ch) =>
        ch.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
}

function sameResourceId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export interface PendingSubmissionConflict {
    prNumber: number;
    prTitle: string;
    /** 命中的 PR 是否与本次提交路径完全相同（同用户重复提交场景）。 */
    samePath: boolean;
}

/** 重复提交守卫：携带冲突 PR 信息，发布页据此提供「继续编辑原 PR」入口。 */
export class PendingSubmissionConflictError extends Error {
    constructor(
        message: string,
        readonly conflict: PendingSubmissionConflict,
    ) {
        super(message);
        this.name = "PendingSubmissionConflictError";
    }
}

/**
 * 扫描所有开放 PR，检测与本次提交的冲突：
 * - B1 同路径：同一 tmp/{login}/{repo} 路径已有未处理请求（含解析失败兜底，
 *   行为与旧版 hasPendingSubmissionPath 一致）；
 * - B2 跨用户：任何开放 PR 的提交明细指向同一资源 ID（edit 的 original_id 或
 *   csv 行 id），无论路径是否相同。
 * 解析失败的历史/脏数据一律跳过，不阻塞正常提交。
 */
async function findPendingSubmissionConflicts(
    token: string,
    submissionPath: string,
    entry: CatalogEntry,
): Promise<PendingSubmissionConflict | null> {
    const pulls = await listOpenPulls(token);
    for (const pull of pulls) {
        const files = await githubFetch<
            Array<{ filename?: string; sha?: string }>
        >(
            `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls/${pull.number}/files?per_page=100`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        let samePath = false;
        let idConflict = false;
        for (const file of files) {
            const filePath = file.filename ?? "";
            if (!isSubmissionFilePath(filePath)) continue;
            if (filePath.startsWith(`${submissionPath}/`)) {
                samePath = true;
            }
            if (!file.sha) continue;
            try {
                const text = await fetchBlobText(token, file.sha);
                if (!text) continue;
                if (filePath.endsWith(".json")) {
                    const request = parseSubmissionRequestJson(text);
                    if (
                        request.mode === "edit" &&
                        typeof request.original_id === "string" &&
                        sameResourceId(request.original_id, entry.id)
                    ) {
                        idConflict = true;
                    }
                } else {
                    const parsed = parseSubmissionCsv(text);
                    if (sameResourceId(parsed.id, entry.id)) {
                        idConflict = true;
                    }
                }
            } catch {
                // 历史/脏数据解析失败：跳过该文件，不中断提交流程。
                continue;
            }
        }

        // 内容确认不了但同路径已存在 → 与旧行为一致，保守视为待处理请求。
        if (idConflict || samePath) {
            return { prNumber: pull.number, prTitle: pull.title, samePath };
        }
    }
    return null;
}

export interface OpenSubmissionLookupProgress {
    done: number;
    total: number;
}

export type OpenSubmissionMode = SubmissionMode | "unknown";

export interface OpenSubmissionMatch {
    prNumber: number;
    prTitle: string;
    mode: OpenSubmissionMode;
}

/** 并发扫描开放 PR 时同时读取的文件数上限，避免触发二级速率限制。 */
const OPEN_SUBMISSION_LOOKUP_CONCURRENCY = 4;

interface OpenSubmissionReference {
    resourceId: string;
    match: OpenSubmissionMatch;
}

function addSubmissionReference(
    references: Map<string, OpenSubmissionReference>,
    pull: { number: number; title: string },
    resourceId: string | null | undefined,
    mode: OpenSubmissionMode,
) {
    const id = resourceId?.trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (references.has(key)) return;
    references.set(key, {
        resourceId: id,
        match: {
            prNumber: pull.number,
            prTitle: pull.title,
            mode,
        },
    });
}

/** 解析一份提交明细，收集它引用的资源 ID。 */
function collectSubmissionReferences(
    references: Map<string, OpenSubmissionReference>,
    pull: { number: number; title: string },
    filePath: string,
    text: string,
) {
    try {
        if (filePath.endsWith(".json")) {
            const request = parseSubmissionRequestJson(text);
            if (
                request.mode === "edit" ||
                request.mode === "delete"
            ) {
                addSubmissionReference(
                    references,
                    pull,
                    request.original_id,
                    request.mode,
                );
            }
        } else {
            const parsed = parseSubmissionCsv(text);
            addSubmissionReference(references, pull, parsed.id, "unknown");
        }
    } catch {
        // 历史/脏数据解析失败：跳过该文件，不误判为冲突。
    }
}

/** 通过 REST 读取一个 PR 的全部提交明细引用；GraphQL 失败时的兜底链路。 */
async function pullResourceReferences(
    token: string,
    pull: { number: number; title: string },
): Promise<OpenSubmissionReference[]> {
    const files = await githubFetch<
        Array<{ filename?: string; sha?: string }>
    >(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls/${pull.number}/files?per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const references = new Map<string, OpenSubmissionReference>();
    for (const file of files) {
        const filePath = file.filename ?? "";
        if (!isSubmissionFilePath(filePath)) continue;
        if (!file.sha) continue;
        try {
            const text = await fetchBlobText(token, file.sha);
            if (!text) continue;
            collectSubmissionReferences(references, pull, filePath, text);
        } catch {
            // 历史/脏数据解析失败：跳过该文件，不误判为冲突。
            continue;
        }
    }
    return [...references.values()];
}

async function pullReferencesResource(
    token: string,
    pull: { number: number; title: string },
    resourceId: string,
): Promise<OpenSubmissionMatch | null> {
    const target = resourceId.trim().toLowerCase();
    if (!target) return null;
    const references = await pullResourceReferences(token, pull);
    return (
        references.find(
            (reference) => reference.resourceId.trim().toLowerCase() === target,
        )?.match ?? null
    );
}

interface OpenSubmissionIndex {
    key: string;
    fetchedAt: number;
    matches: Map<string, OpenSubmissionMatch>;
}

/** 开放 PR 预检索引的复用窗口；管理页停留期间点击编辑可直接命中。 */
const OPEN_SUBMISSION_INDEX_TTL_MS = 60_000;
/** 单资源查询结果（含“无冲突”）的短缓存。 */
const OPEN_SUBMISSION_LOOKUP_TTL_MS = 30_000;
/** GraphQL 单次查询里批量读取的提交文件数；过大容易被网关截断。 */
const OPEN_SUBMISSION_GRAPHQL_BLOB_CHUNK = 50;
/** GraphQL 不可用后的降级窗口，避免每次点击都先失败一次再走 REST。 */
const OPEN_SUBMISSION_GRAPHQL_FAILURE_COOLDOWN_MS = 60_000;

let openSubmissionGraphqlDisabledUntil = 0;
let openSubmissionIndex: OpenSubmissionIndex | null = null;
let openSubmissionIndexInFlight:
    | { key: string; promise: Promise<OpenSubmissionIndex> }
    | null = null;
const openSubmissionLookupCache = new Map<
    string,
    { fetchedAt: number; value: OpenSubmissionMatch | null }
>();

function openSubmissionCacheKey() {
    const login =
        loadAccountState().github?.username?.trim().toLowerCase() ?? "";
    return `${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}|${login}`;
}

interface GraphqlPullNode {
    number?: number | null;
    title?: string | null;
    headRefOid?: string | null;
    files?: {
        nodes?: Array<{ path?: string | null } | null> | null;
    } | null;
}

interface GraphqlPullConnection {
    pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
    } | null;
    nodes?: Array<GraphqlPullNode | null> | null;
}

interface OpenPullWithFiles {
    number: number;
    title: string;
    headRefOid: string;
    files: string[];
}

interface OpenPullsData {
    repository?: {
        pullRequests?: GraphqlPullConnection | null;
    } | null;
}

interface GraphqlResponse<T> {
    data?: T | null;
    errors?: Array<{ message?: string | null }> | null;
}

async function githubGraphql<T>(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
): Promise<T> {
    const response = await githubFetch<GraphqlResponse<T>>(
        "https://api.github.com/graphql",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, variables }),
        },
    );
    if (response.errors?.length) {
        throw new Error(
            response.errors
                .map((error) => error.message ?? "GraphQL 请求失败")
                .join("；"),
        );
    }
    if (!response.data) {
        throw new Error("GitHub GraphQL 返回为空。");
    }
    return response.data;
}

const OPEN_SUBMISSION_PULLS_QUERY = `
query OpenSubmissionPulls($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        headRefOid
        files(first: 100) { nodes { path } }
      }
    }
  }
}`;

/** 一次 GraphQL 查询拿到所有开放 PR 的提交文件路径。 */
async function fetchOpenSubmissionPulls(
    token: string,
): Promise<OpenPullWithFiles[]> {
    const owner = PUBLISH_CONFIG.targetPrRepoOwner;
    const repo = PUBLISH_CONFIG.targetPrRepoName;
    const result: OpenPullWithFiles[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
        const data: OpenPullsData = await githubGraphql<OpenPullsData>(
            token,
            OPEN_SUBMISSION_PULLS_QUERY,
            { owner, repo, cursor },
        );
        const connection: GraphqlPullConnection | null | undefined =
            data.repository?.pullRequests;
        if (!connection) break;

        for (const node of connection.nodes ?? []) {
            if (!node?.number) continue;
            result.push({
                number: node.number,
                title: node.title ?? "",
                headRefOid: node.headRefOid?.trim() ?? "",
                files: (node.files?.nodes ?? [])
                    .map(
                        (file: { path?: string | null } | null) =>
                            file?.path ?? "",
                    )
                    .filter(Boolean),
            });
        }

        if (!connection.pageInfo?.hasNextPage) break;
        const nextCursor: string | null | undefined =
            connection.pageInfo.endCursor;
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
    }
    return result;
}

function buildSubmissionBlobQuery(
    owner: string,
    repo: string,
    items: Array<{ pull: OpenPullWithFiles; path: string }>,
) {
    const fields = items
        .map((item, index) => {
            const expression = `${item.pull.headRefOid}:${item.path}`;
            return `    f${index}: object(expression: ${JSON.stringify(expression)}) { ... on Blob { text } }`;
        })
        .join("\n");
    return `query OpenSubmissionBlobs {\n  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {\n${fields}\n  }\n}`;
}

/**
 * 用 GraphQL 构建「开放 PR → 资源 ID」索引。
 *
 * 相比逐个 PR 拉 files + blob（28 个 PR 约 85 次请求），这里通常只需要
 * 1 次 PR 列表查询 + 1～2 次批量 blob 查询。
 */
async function buildOpenSubmissionIndex(
    token: string,
): Promise<OpenSubmissionIndex> {
    const key = openSubmissionCacheKey();
    const pulls = await fetchOpenSubmissionPulls(token);
    const matches = new Map<string, OpenSubmissionMatch>();
    const pending: Array<{ pull: OpenPullWithFiles; path: string }> = [];
    const missingPrNumbers = new Set<number>();

    for (const pull of pulls) {
        if (!pull.headRefOid) {
            missingPrNumbers.add(pull.number);
            continue;
        }
        for (const path of pull.files) {
            if (!isSubmissionFilePath(path)) continue;
            pending.push({ pull, path });
        }
    }

    const owner = PUBLISH_CONFIG.targetPrRepoOwner;
    const repo = PUBLISH_CONFIG.targetPrRepoName;
    for (
        let start = 0;
        start < pending.length;
        start += OPEN_SUBMISSION_GRAPHQL_BLOB_CHUNK
    ) {
        const chunk = pending.slice(
            start,
            start + OPEN_SUBMISSION_GRAPHQL_BLOB_CHUNK,
        );
        try {
            const data = await githubGraphql<{
                repository?: Record<
                    string,
                    { text?: string | null } | null
                > | null;
            }>(token, buildSubmissionBlobQuery(owner, repo, chunk));
            const repository = data.repository ?? {};
            chunk.forEach((item, index) => {
                const text = repository[`f${index}`]?.text;
                if (!text) {
                    missingPrNumbers.add(item.pull.number);
                    return;
                }
                const references = new Map<
                    string,
                    OpenSubmissionReference
                >();
                collectSubmissionReferences(
                    references,
                    item.pull,
                    item.path,
                    text,
                );
                for (const [id, reference] of references) {
                    if (!matches.has(id)) matches.set(id, reference.match);
                }
            });
        } catch (error) {
            log.warn(
                "publish/edit-entry",
                "批量读取提交明细失败，改为 REST 兜底",
                {
                    data: {
                        error: (error as Error)?.message ?? String(error),
                        files: chunk.length,
                    },
                },
            );
            for (const item of chunk) {
                missingPrNumbers.add(item.pull.number);
            }
        }
    }

    // GraphQL 读不到的 PR 走原有 REST 链路；通常只有极少数历史/异常 PR。
    const fallbackPulls = pulls.filter((pull) =>
        missingPrNumbers.has(pull.number),
    );
    let next = 0;
    const worker = async () => {
        while (next < fallbackPulls.length) {
            const index = next;
            next += 1;
            const pull = fallbackPulls[index];
            if (!pull) continue;
            try {
                const references = await pullResourceReferences(token, pull);
                for (const reference of references) {
                    const id = reference.resourceId.trim().toLowerCase();
                    if (!matches.has(id)) matches.set(id, reference.match);
                }
            } catch (error) {
                log.warn(
                    "publish/edit-entry",
                    `读取开放 PR #${pull.number} 的提交明细失败，已跳过`,
                    {
                        data: {
                            error: (error as Error)?.message ?? String(error),
                        },
                    },
                );
            }
        }
    };
    await Promise.all(
        Array.from(
            {
                length: Math.min(
                    OPEN_SUBMISSION_LOOKUP_CONCURRENCY,
                    fallbackPulls.length,
                ),
            },
            () => worker(),
        ),
    );

    return { key, fetchedAt: Date.now(), matches };
}

async function ensureOpenSubmissionIndex(
    token: string,
): Promise<OpenSubmissionIndex> {
    if (Date.now() < openSubmissionGraphqlDisabledUntil) {
        throw new Error("GitHub GraphQL 暂不可用，使用 REST 兜底。");
    }
    const key = openSubmissionCacheKey();
    const cached = openSubmissionIndex;
    if (
        cached &&
        cached.key === key &&
        Date.now() - cached.fetchedAt < OPEN_SUBMISSION_INDEX_TTL_MS
    ) {
        return cached;
    }
    const pending = openSubmissionIndexInFlight;
    if (pending?.key === key) return pending.promise;

    const promise = buildOpenSubmissionIndex(token);
    openSubmissionIndexInFlight = { key, promise };
    try {
        const index = await promise;
        openSubmissionIndex = index;
        return index;
    } finally {
        if (openSubmissionIndexInFlight?.promise === promise) {
            openSubmissionIndexInFlight = null;
        }
    }
}

/** 清空开放 PR 预检缓存；创建/更新 PR 后调用，避免命中旧结果。 */
export function invalidateOpenSubmissionCache() {
    openSubmissionIndex = null;
    openSubmissionIndexInFlight = null;
    openSubmissionLookupCache.clear();
}

/**
 * 后台预取「开放 PR → 资源 ID」索引。
 *
 * 管理页列表加载完成后调用；用户点击编辑时通常已经命中，不再触发任何扫描。
 */
export async function prefetchOpenSubmissionIndex(
    token?: string,
): Promise<void> {
    const authToken = token ?? loadAccountState().github?.token;
    if (!authToken) return;
    const startedAt = performance.now();
    try {
        const index = await ensureOpenSubmissionIndex(authToken);
        log.info("publish/edit-entry", "开放 PR 预检索引已就绪", {
            data: {
                matchedResources: index.matches.size,
                durationMs: Math.round(performance.now() - startedAt),
            },
        });
    } catch (error) {
        openSubmissionGraphqlDisabledUntil =
            Date.now() + OPEN_SUBMISSION_GRAPHQL_FAILURE_COOLDOWN_MS;
        log.warn("publish/edit-entry", "开放 PR 预检索引构建失败", {
            data: { error: (error as Error)?.message ?? String(error) },
        });
    }
}

/**
 * 查找引用该资源 ID 的开放提交。优先使用 GraphQL 批量索引（2～3 次请求），
 * GraphQL 不可用时回退原有 4 并发 REST 扫描。
 *
 * 返回结果同时用于「管理」页进入编辑前的预检：已有进行中 PR 时直接引导到
 * 审核页继续编辑。解析失败的历史/脏数据跳过；无命中返回 null。
 */
export async function findOpenSubmissionForResourceId(
    token: string,
    resourceId: string,
    onProgress?: (progress: OpenSubmissionLookupProgress) => void,
): Promise<OpenSubmissionMatch | null> {
    const target = resourceId.trim().toLowerCase();
    if (!target) return null;
    const key = openSubmissionCacheKey();
    const lookupKey = `${key}|${target}`;
    const now = Date.now();

    const cachedLookup = openSubmissionLookupCache.get(lookupKey);
    if (
        cachedLookup &&
        now - cachedLookup.fetchedAt < OPEN_SUBMISSION_LOOKUP_TTL_MS
    ) {
        return cachedLookup.value;
    }

    if (
        openSubmissionIndex?.key === key &&
        now - openSubmissionIndex.fetchedAt < OPEN_SUBMISSION_INDEX_TTL_MS
    ) {
        const value = openSubmissionIndex.matches.get(target) ?? null;
        openSubmissionLookupCache.set(lookupKey, { fetchedAt: now, value });
        return value;
    }

    const startedAt = performance.now();
    try {
        const index = await ensureOpenSubmissionIndex(token);
        const value = index.matches.get(target) ?? null;
        openSubmissionLookupCache.set(lookupKey, {
            fetchedAt: Date.now(),
            value,
        });
        log.info("publish/edit-entry", "GraphQL 开放 PR 预检完成", {
            data: {
                resourceId,
                durationMs: Math.round(performance.now() - startedAt),
                matched: Boolean(value),
                matchedResources: index.matches.size,
            },
        });
        return value;
    } catch (error) {
        openSubmissionGraphqlDisabledUntil =
            Date.now() + OPEN_SUBMISSION_GRAPHQL_FAILURE_COOLDOWN_MS;
        log.warn(
            "publish/edit-entry",
            "GraphQL 预检失败，回退 REST 扫描",
            {
                data: { error: (error as Error)?.message ?? String(error) },
            },
        );
    }

    const pulls = await listOpenPulls(token);
    const total = pulls.length;
    onProgress?.({ done: 0, total });
    if (total === 0) {
        openSubmissionLookupCache.set(lookupKey, {
            fetchedAt: Date.now(),
            value: null,
        });
        return null;
    }

    let next = 0;
    let done = 0;
    let found: OpenSubmissionMatch | null = null;

    const worker = async () => {
        while (!found && next < total) {
            const index = next;
            next += 1;
            const match = await pullReferencesResource(
                token,
                pulls[index],
                target,
            );
            done += 1;
            onProgress?.({ done, total });
            if (match) {
                found = match;
                return;
            }
        }
    };

    await Promise.all(
        Array.from(
            { length: Math.min(OPEN_SUBMISSION_LOOKUP_CONCURRENCY, total) },
            () => worker(),
        ),
    );
    openSubmissionLookupCache.set(lookupKey, {
        fetchedAt: Date.now(),
        value: found,
    });
    log.info("publish/edit-entry", "REST 开放 PR 预检完成", {
        data: {
            resourceId,
            durationMs: Math.round(performance.now() - startedAt),
            matched: Boolean(found),
            pulls: total,
        },
    });
    return found;
}

async function commitFilesToBranch(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    files: Array<{ path: string; content: string }>;
    message: string;
}) {
    const { token, owner, repo, branch, files, message } = params;
    const repoInfo: RepoInfo = { owner, name: repo, branch };
    const head = await getBranchHead(repoInfo, token);

    const blobEntries = [];
    for (const file of files) {
        const sha = await createBlob(
            repoInfo,
            ensureBase64(file.content),
            token,
        );
        blobEntries.push({
            sha,
            path: file.path,
            mode: "100644" as const,
            type: "blob" as const,
        });
    }

    const treeSha = await createTree(repoInfo, head.treeSha, blobEntries, token);
    const commitSha = await createCommit(
        repoInfo,
        message,
        treeSha,
        head.commitSha,
        token,
    );
    await updateRef(repoInfo, commitSha, token);
    return commitSha;
}

/**
 * 准备一个基于 fork 的提交分支。
 *
 * syncForkDefaultBranch 在同步失败时会静默降级（见 fork.ts），fork 可能仍停留在
 * 落后于上游的旧提交上。若在这种 fork HEAD 上切分支，会生成一个基于「上游已清理
 * 过 tmp 路径」历史的 PR，合并时必然触发 modify/delete 冲突（如 #822 事故）。
 * 因此在切分支前强校验 fork 已追平上游；未追平则中止并提示重试，绝不静默产出冲突 PR。
 */
async function prepareSubmissionForkBranch(params: {
    token: string;
    upstreamOwner: string;
    upstreamRepo: string;
    defaultBranch: string;
    branchPrefix: string;
}): Promise<{ forkOwner: string; forkRepo: string; branchName: string }> {
    const {
        token,
        upstreamOwner,
        upstreamRepo,
        defaultBranch,
        branchPrefix,
    } = params;
    const fork = await getOrCreateFork(token, upstreamOwner, upstreamRepo);
    log.info("publish/fork", `fork 就绪 ${fork.owner}/${fork.name}`, {
        data: { defaultBranch: fork.default_branch },
    });
    await syncForkDefaultBranch({
        token,
        forkOwner: fork.owner,
        forkRepo: fork.name,
        branch: fork.default_branch,
        upstreamOwner,
        upstreamRepo,
    });
    const forkHeadSha = await getRefSha(
        token,
        fork.owner,
        fork.name,
        `heads/${fork.default_branch}`,
    );
    const upstreamHead = await getRefSha(
        token,
        upstreamOwner,
        upstreamRepo,
        `heads/${defaultBranch}`,
    );
    if (forkHeadSha !== upstreamHead) {
        throw new Error(
            `Fork ${fork.owner}/${fork.name} 未能同步到上游最新提交` +
            `（上游 ${upstreamHead.slice(0, 7)}，fork ${forkHeadSha.slice(0, 7)}）。` +
            `基于陈旧分支创建提交会产生合并冲突，已中止本次提交，请重试。`,
        );
    }
    const branchName = `${branchPrefix}-${Date.now()}`;
    await createBranch(token, fork.owner, fork.name, forkHeadSha, branchName);
    log.info("publish/branch", `提交分支已创建 ${branchName}`, {
        data: { base: `${fork.owner}/${fork.name}@${forkHeadSha.slice(0, 7)}` },
    });
    return { forkOwner: fork.owner, forkRepo: fork.name, branchName };
}

export async function createSubmissionBranch(payload: CatalogUpdateRequest) {
    const token = getGithubTokenOrThrow();
    const githubLogin = requireGithubLogin();
    const entry = buildSubmissionEntry(payload);
    const upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner;
    const upstreamRepo = PUBLISH_CONFIG.upstreamRepoName;
    const defaultBranch = PUBLISH_CONFIG.defaultBranch;

    const latest = await fetchCatalogEntries({ token });
    const upstreamCommit = await getRefSha(
        token,
        upstreamOwner,
        upstreamRepo,
        `heads/${defaultBranch}`,
    );

    const intent = payload.intent;
    if (intent.mode === "create") {
        const duplicateId = latest.entries.find(
            (item) => item.id.trim() === entry.id.trim(),
        );
        if (duplicateId) {
            throw new Error(
                `资源 ID "${entry.id}" 已被「${duplicateId.name || duplicateId.id}」占用。`,
            );
        }
        const duplicateRepo = latest.entries.find(
            (item) =>
                item.repo_owner.toLowerCase() === entry.repo_owner.toLowerCase() &&
                item.repo_name.toLowerCase() === entry.repo_name.toLowerCase(),
        );
        if (duplicateRepo) {
            throw new Error(
                `仓库 ${entry.repo_owner}/${entry.repo_name} 已经在 AstroBox 的软件索引里，被资源「${duplicateRepo.name || duplicateRepo.id}」占用，请更换仓库名。`,
            );
        }
    } else {
        const originalId = intent.originalId.trim();
        const original = latest.entries.find(
            (item) => item.id.trim() === originalId,
        );
        if (!original) {
            throw new Error(`未在目录中找到原资源 ID "${originalId}"。`);
        }
    }

    const submissionPath = buildSubmissionPath(
        githubLogin,
        entry.repo_name,
    );

    // 重复提交守卫：create/edit 都要查。同路径 = 同用户重复开 PR；
    // 跨用户 = 别人正开着另一个 PR 改同一资源。
    const conflict = await findPendingSubmissionConflicts(
        token,
        submissionPath,
        entry,
    );
    if (conflict) {
        if (conflict.samePath) {
            throw new PendingSubmissionConflictError(
                `路径 ${submissionPath} 已有未处理的提交（PR #${conflict.prNumber}）。` +
                `请等待审核处理，或在发布页点击「继续编辑原 PR」更新该提交。`,
                conflict,
            );
        }
        throw new PendingSubmissionConflictError(
            `资源 "${entry.id}" 已有进行中的提交 PR #${conflict.prNumber}《${conflict.prTitle}》。` +
            `请等待其处理完成，或联系该 PR 的作者。`,
            conflict,
        );
    }

    const { forkOwner, forkRepo, branchName } =
        await prepareSubmissionForkBranch({
            token,
            upstreamOwner,
            upstreamRepo,
            defaultBranch,
            branchPrefix: "astrobox-submit",
        });

    let request: SubmissionRequest;
    if (intent.mode === "create") {
        request = await buildCreateSubmissionRequest(upstreamCommit);
    } else {
        const originalId = intent.originalId.trim();
        const original = latest.entries.find(
            (item) => item.id.trim() === originalId,
        )!;
        request = await buildEditSubmissionRequest({
            originalId,
            baseEntryDigest: await canonicalCatalogEntryDigest(original),
            baseCatalogCommit: upstreamCommit,
        });
    }

    await commitFilesToBranch({
        token,
        owner: forkOwner,
        repo: forkRepo,
        branch: branchName,
        message: `submit: ${entry.id}`,
        files: [
            {
                path: submissionCsvPath(submissionPath),
                content: buildSubmissionCsv(entry),
            },
            {
                path: submissionRequestPath(submissionPath),
                content: buildSubmissionRequest(request),
            },
        ],
    });

    return {
        forkOwner,
        forkRepo,
        branch: branchName,
        submissionPath,
        request,
        entry,
    };
}

export interface PreparedDeletionSubmission {
    entry: CatalogEntry;
    token: string;
    forkOwner: string;
    forkRepo: string;
    branch: string;
    submissionPath: string;
    request: SubmissionRequest;
}

/**
 * 准备删除申请的分支与两个提交文件，但不创建 PR。
 *
 * 创建者选择“同时删除 GitHub 仓库”时，客户端需要先删仓库、再创建 PR。把分支和
 * 文件准备拆出来，仓库删除失败时不会留下 PR；仓库删除成功后若 PR 创建失败，
 * 也可以复用同一分支重试，避免重复删除仓库。
 */
export async function createDeletionSubmissionBranch(
    resource: CatalogEntry,
): Promise<PreparedDeletionSubmission> {
    const token = getGithubTokenOrThrow();
    const githubLogin = requireGithubLogin();
    const upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner;
    const upstreamRepo = PUBLISH_CONFIG.upstreamRepoName;
    const defaultBranch = PUBLISH_CONFIG.defaultBranch;

    const latest = await fetchCatalogEntries({ token });
    const entry = findCatalogEntryById(latest.entries, resource.id);
    if (!entry) {
        throw new Error("该资源已不在目录中，可能已被删除。");
    }
    if (
        entry.repo_owner.trim().toLowerCase() !==
        githubLogin.trim().toLowerCase()
    ) {
        throw new Error("该资源不属于当前 GitHub 账号，无法删除。");
    }

    const upstreamCommit = await getRefSha(
        token,
        upstreamOwner,
        upstreamRepo,
        `heads/${defaultBranch}`,
    );
    const submissionPath = buildDeletionSubmissionPath(
        githubLogin,
        entry.id,
        Date.now(),
    );
    const { forkOwner, forkRepo, branchName } =
        await prepareSubmissionForkBranch({
            token,
            upstreamOwner,
            upstreamRepo,
            defaultBranch,
            branchPrefix: "astrobox-delete",
        });

    const request = await buildDeleteSubmissionRequest({
        originalId: entry.id,
        baseEntryDigest: await canonicalCatalogEntryDigest(entry),
        baseCatalogCommit: upstreamCommit,
    });

    await commitFilesToBranch({
        token,
        owner: forkOwner,
        repo: forkRepo,
        branch: branchName,
        message: `delete: ${entry.id}`,
        files: [
            {
                path: submissionCsvPath(submissionPath),
                content: buildSubmissionCsv(entry),
            },
            {
                path: submissionRequestPath(submissionPath),
                content: buildSubmissionRequest(request),
            },
        ],
    });

    log.info("publish/delete", `删除申请分支已创建 ${branchName}`, {
        data: { resourceId: entry.id, submissionPath },
    });
    return {
        entry,
        token,
        forkOwner,
        forkRepo,
        branch: branchName,
        submissionPath,
        request,
    };
}

export async function createSubmissionPullRequest(params: {
    forkOwner: string;
    forkRepo: string;
    branch: string;
    token: string;
    title: string;
    body?: string;
}) {
    const pr = await createPullRequest({
        token: params.token,
        baseOwner: PUBLISH_CONFIG.targetPrRepoOwner,
        baseRepo: PUBLISH_CONFIG.targetPrRepoName,
        baseBranch: PUBLISH_CONFIG.defaultBranch,
        headOwner: params.forkOwner,
        headRepo: params.forkRepo,
        headBranch: params.branch,
        title: params.title,
        body: params.body,
    });
    // 新 PR 已进入开放列表，旧预检索引不再可信。
    invalidateOpenSubmissionCache();
    return pr;
}

export async function updateSubmissionEntryOnBranch(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    entry: CatalogEntry;
    request: SubmissionRequest;
    submissionPath: string;
}) {
    const { token, owner, repo, branch, entry, request, submissionPath } = params;
    // 每次写入 request.json 都刷新 client 信息，确保反映当前使用的 CC 版本
    // 与构建来源（编辑旧 PR 时可为历史请求补上缺失的 client 字段）。
    const refreshed: SubmissionRequest = {
        ...request,
        client: await buildClientInfo(),
    };
    await commitFilesToBranch({
        token,
        owner,
        repo,
        branch,
        message: `update: submission ${entry.id}`,
        files: [
            {
                path: submissionCsvPath(submissionPath),
                content: buildSubmissionCsv(entry),
            },
            {
                path: submissionRequestPath(submissionPath),
                content: buildSubmissionRequest(refreshed),
            },
        ],
    });
}

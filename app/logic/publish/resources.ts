import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import { githubFetch } from "./github-actions";
import {
    getPullRequest,
    listOrganizationMembers,
    listPullRequestFiles,
} from "~/api/github/pr-review";
import {
    fetchCatalogEntries,
    getFileContent,
    decodeCatalogContent,
    parseCatalogCsv,
    type CatalogEntry,
} from "./catalog";
import {
    extractSubmissionPathFromFilePath,
    parseSubmissionCsv,
    parseSubmissionRequestJson,
    submissionCsvPath,
    submissionRequestPath,
    type SubmissionRequest,
} from "./submission-protocol";
import {
    deriveReviewStatus,
    filterReviewTagComments,
    type NeedFixItem,
    type ReviewState,
} from "./review-status";

export interface ResourceCatalogContext {
    entry: CatalogEntry;
    owner: string;
    repo: string;
    ref: string;
    sha?: string;
}

export interface PublishingResource {
    id: string;
    name: string;
    restype: string;
    status: ReviewState;
    needs: NeedFixItem[];
    createdAt?: string;
    prNumber: number;
    prTitle: string;
    prUrl: string;
    prState: "open" | "closed" | "merged";
    refused?: boolean;
    refuseReason?: string;
    prHead?: { owner: string; repo: string; ref: string };
    catalog: ResourceCatalogContext;
    submission?: {
        path: string;
        request?: SubmissionRequest;
    };
}

export interface ResourceEditContext {
    mode: "in_progress" | "catalog";
    catalog: ResourceCatalogContext;
    prNumber?: number;
    prUrl?: string;
    prState?: "open" | "closed" | "merged";
    prHead?: { owner: string; repo: string; ref: string };
    reviewState?: ReviewState;
    needs?: NeedFixItem[];
    submission?: {
        path: string;
        request: SubmissionRequest;
    };
}

function requireGithubAccount() {
    const state = loadAccountState();
    const token = state.github?.token;
    const username = state.github?.username;
    if (!token || !username) {
        throw new Error("请先登录 GitHub 账号。");
    }
    return { token, username };
}

export async function loadOwnedCatalogResourcesForCurrentUser(): Promise<
    ResourceCatalogContext[]
> {
    const { token, username } = requireGithubAccount();
    const orgMembers = await listOrganizationMembers(
        PUBLISH_CONFIG.upstreamRepoOwner,
    ).catch(() => new Set<string>());
    const catalog = await fetchCatalogEntries({ token });
    return catalog.entries
        .filter((entry) => entry.repo_owner === username)
        .map((entry) => ({
            entry,
            owner: catalog.owner,
            repo: catalog.repo,
            ref: catalog.ref,
            sha: catalog.sha,
        }));
}

/**
 * 根据已存在的开放 PR 构建「继续编辑」上下文（mode=in_progress），
 * 供已发布资源进入编辑前的预检复用：命中进行中的 PR 时直接打开该提交继续编辑。
 */
export async function buildInProgressEditContextFromPr(options: {
    prNumber: number;
    token: string;
}): Promise<ResourceEditContext & { authorLogin?: string }> {
    const { prNumber, token } = options;
    const full = await getPullRequest(prNumber);
    const headRepo = full.head?.repo;
    const prHead = headRepo
        ? {
              owner: headRepo.owner?.login || "",
              repo: headRepo.name,
              ref: full.head.ref,
          }
        : undefined;
    if (!prHead) {
        throw new Error("缺少 PR 分支信息，无法载入提交明细。");
    }

    const files = await listPullRequestFiles(prNumber);
    const submissionPath = files
        .map((file) => extractSubmissionPathFromFilePath(file.filename))
        .find((path): path is string => Boolean(path));
    if (!submissionPath) {
        throw new Error("未找到新流程提交明细，无法继续编辑该 PR。");
    }

    const [requestFile, csvFile] = await Promise.all([
        getFileContent(token, prHead.owner, prHead.repo, submissionRequestPath(submissionPath), prHead.ref),
        getFileContent(token, prHead.owner, prHead.repo, submissionCsvPath(submissionPath), prHead.ref),
    ]);
    const request = parseSubmissionRequestJson(
        decodeCatalogContent(requestFile.content),
    );
    const entry = parseSubmissionCsv(decodeCatalogContent(csvFile.content));
    const catalog: ResourceCatalogContext = {
        entry,
        owner: prHead.owner,
        repo: prHead.repo,
        ref: prHead.ref,
        sha: full.head?.sha,
    };
    return {
        mode: "in_progress",
        catalog,
        prNumber,
        prUrl: full.html_url || "",
        prState:
            full.state === "open"
                ? "open"
                : full.merged_at
                  ? "merged"
                  : "closed",
        prHead,
        submission: { path: submissionPath, request },
        authorLogin: full.user?.login,
    };
}

async function fetchIssueComments(
    repoOwner: string,
    repoName: string,
    issueNumber: number,
    token: string,
) {
    return githubFetch<any[]>(
        `https://api.github.com/repos/${repoOwner}/${repoName}/issues/${issueNumber}/comments?per_page=100`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
}

async function fetchPullReviews(
    repoOwner: string,
    repoName: string,
    pullNumber: number,
    token: string,
) {
    return githubFetch<any[]>(
        `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/reviews?per_page=100`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
}

async function fetchPrTimelineComments(
    repoOwner: string,
    repoName: string,
    pullNumber: number,
    token: string,
) {
    const [comments, reviews] = await Promise.all([
        fetchIssueComments(repoOwner, repoName, pullNumber, token),
        fetchPullReviews(repoOwner, repoName, pullNumber, token),
    ]);
    const fromReviews = (reviews || [])
        .filter(
            (review: any) =>
                review.state !== "PENDING" &&
                (review.state === "REQUEST_CHANGES" ||
                    review.state === "COMMENTED") &&
                typeof review.body === "string" &&
                review.body.trim(),
        )
        .map((review: any) => ({
            ...review,
            created_at: review.submitted_at || review.created_at,
        }));
    return [...(comments || []), ...fromReviews].sort((a: any, b: any) =>
        (a.created_at || "").localeCompare(b.created_at || ""),
    );
}

async function fetchPullFiles(
    repoOwner: string,
    repoName: string,
    pullNumber: number,
    token: string,
) {
    return githubFetch<
        Array<{
            filename?: string;
            patch?: string;
        }>
    >(
        `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/files?per_page=100`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index]);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () =>
            run(),
        ),
    );
    return results;
}

const CATALOG_CSV_HEADER =
    "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

let inProgressCache: {
    signature: string;
    mode: "legacy" | "staging";
    data: PublishingResource[];
} | null = null;

function parseCatalogEntryRow(row: string) {
    return parseCatalogCsv(`${CATALOG_CSV_HEADER}\n${row}`)[0];
}

function isCatalogFile(filename?: string) {
    if (!filename) return false;
    return (
        filename === PUBLISH_CONFIG.catalogFilePath ||
        filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
    );
}

function extractCatalogEntriesFromPatch(patch?: string) {
    if (!patch) return [];

    const byId = new Map<string, CatalogEntry>();
    const lines = patch.split(/\r?\n/);
    for (const line of lines) {
        if (!line.startsWith("+") || line.startsWith("+++")) continue;

        const row = line.slice(1).trim();
        if (!row || row === CATALOG_CSV_HEADER) continue;

        const parsed = parseCatalogEntryRow(row);
        if (!parsed) continue;
        byId.set(parsed.id, parsed);
    }

    return Array.from(byId.values());
}

function extractCatalogEntriesFromPullFiles(
    files: Array<{ filename?: string; patch?: string }>,
) {
    const byId = new Map<string, CatalogEntry>();

    for (const file of files) {
        if (!isCatalogFile(file.filename)) continue;

        const entries = extractCatalogEntriesFromPatch(file.patch);
        for (const entry of entries) {
            byId.set(entry.id, entry);
        }
    }

    return Array.from(byId.values());
}

interface MyReviewPullRequest {
    number: number;
    title: string;
    state?: string;
    user?: { login?: string };
    created_at?: string;
    updated_at?: string;
    html_url?: string;
    merged_at?: string | null;
    head?: {
        ref: string;
        sha?: string;
        repo?: { owner?: { login?: string }; name: string } | null;
    } | null;
}

/**
 * 优先用 search API 只拉当前用户自己的 PR（不受仓库前 50 条限制）；
 * search 失败时回退到 pulls API。search 索引可能有几秒延迟，
 * 所以额外合并一次 state=open 的 pulls 结果保证最新提交立即可见。
 */
async function fetchMyReviewPullRequests(
    token: string,
    username: string,
): Promise<MyReviewPullRequest[]> {
    const owner = PUBLISH_CONFIG.targetPrRepoOwner;
    const repo = PUBLISH_CONFIG.targetPrRepoName;
    const headers = { Authorization: `Bearer ${token}` };
    const sameUser = (login?: string) =>
        Boolean(login && login.toLowerCase() === username.toLowerCase());

    const searchPromise = (async () => {
        try {
            const query = `repo:${owner}/${repo} type:pr author:${username}`;
            const data = await githubFetch<{
                items?: Array<{
                    number?: number;
                    title?: string;
                    state?: string;
                    user?: { login?: string };
                    created_at?: string;
                    updated_at?: string;
                    html_url?: string;
                    merged_at?: string | null;
                    pull_request?: { merged_at?: string | null };
                }>;
            }>(
                `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=50`,
                { headers },
            );
            return (data.items || [])
                .filter(
                    (item) =>
                        item.number != null &&
                        !item.merged_at &&
                        !item.pull_request?.merged_at,
                )
                .map((item) => ({
                    number: item.number!,
                    title: item.title || "",
                    state: item.state || "open",
                    user: item.user,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                    html_url: item.html_url,
                    merged_at: null,
                }));
        } catch (error) {
            console.error("search API 不可用，回退到 pulls API", error);
            return null;
        }
    })();

    // REST state=all 同时承担：回退数据源、head 信息（含分支是否已删除）、
    // 以及兜底 search 索引延迟时最新创建的 open PR。
    const allPulls = await githubFetch<any[]>(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`,
        { headers },
    );
    const validPulls = allPulls.filter(
        (pull) => !pull.merged_at && Boolean(pull.head?.repo),
    );
    const searchItems = await searchPromise;
    if (searchItems === null) {
        return validPulls;
    }

    const headByNumber = new Map<number, any>();
    for (const pull of allPulls) {
        headByNumber.set(pull.number, pull.head);
    }
    const byNumber = new Map<number, MyReviewPullRequest>();
    for (const item of searchItems) {
        const head = headByNumber.get(item.number);
        // REST 里能查到该 PR 且 head 分支已被删除 → 不显示（无法重开/更新）。
        if (headByNumber.has(item.number) && !head?.repo) continue;
        byNumber.set(item.number, item);
        if (head?.repo) {
            byNumber.set(item.number, { ...item, head });
        }
    }
    // search 索引延迟时，把刚刚创建的 open PR 补进来。
    for (const pull of validPulls) {
        if (!sameUser(pull.user?.login)) continue;
        if (!byNumber.has(pull.number)) {
            byNumber.set(pull.number, {
                number: pull.number,
                title: pull.title || "",
                state: pull.state || "open",
                user: pull.user,
                created_at: pull.created_at,
                updated_at: pull.updated_at,
                html_url: pull.html_url,
                merged_at: null,
                head: pull.head,
            });
        }
    }
    return Array.from(byNumber.values()).sort((a, b) =>
        (b.updated_at || "").localeCompare(a.updated_at || ""),
    );
}

function submissionEntryFromPullFiles(
    files: Array<{ filename?: string; patch?: string }>,
): Map<string, CatalogEntry> {
    const byPath = new Map<string, CatalogEntry>();
    for (const file of files) {
        const path = extractSubmissionPathFromFilePath(file.filename);
        if (!path || !file.patch) continue;
        let dataRow = "";
        for (const line of file.patch.split(/\r?\n/)) {
            if (!line.startsWith("+") || line.startsWith("+++")) continue;
            const row = line.slice(1).trim();
            if (!row || row === CATALOG_CSV_HEADER) continue;
            dataRow = row;
        }
        if (!dataRow) continue;
        try {
            byPath.set(
                path,
                parseSubmissionCsv(`${CATALOG_CSV_HEADER}\n${dataRow}`),
            );
        } catch (error) {
            console.error("解析 submission CSV patch 失败", path, error);
        }
    }
    return byPath;
}

export async function loadInProgressResourcesForCurrentUser(): Promise<PublishingResource[]> {
    const mode = "staging";
    const { token, username } = requireGithubAccount();
    const pulls = await fetchMyReviewPullRequests(token, username);
    const signature = pulls
        .map(
            (pull) =>
                `${pull.state || "open"}:${pull.number}:${pull.updated_at || ""}`,
        )
        .join("|");
    if (inProgressCache && inProgressCache.mode === mode && inProgressCache.signature === signature) {
        return inProgressCache.data;
    }
    const result =
        mode === "staging"
            ? await loadInProgressStagingResourcesForCurrentUser(pulls)
            : await loadInProgressLegacyResourcesForCurrentUser(pulls);
    inProgressCache = { signature, mode, data: result };
    return result;
}

async function loadInProgressLegacyResourcesForCurrentUser(
    pulls: MyReviewPullRequest[],
): Promise<PublishingResource[]> {
    const { token, username } = requireGithubAccount();
    const orgMembers = await listOrganizationMembers(
        PUBLISH_CONFIG.upstreamRepoOwner,
    ).catch(() => new Set<string>());

    const results = await mapWithConcurrency(pulls, 5, async (pr) => {
        if (!pr.user?.login || pr.user.login.toLowerCase() !== username.toLowerCase()) {
            return [] as PublishingResource[];
        }
        try {
            const [comments, files] = await Promise.all([
                fetchPrTimelineComments(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
                fetchPullFiles(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
            ]);
            const filteredComments = filterReviewTagComments(
                comments,
                orgMembers,
                pr.user?.login,
            );
            const refuseComment = filteredComments.find((comment) =>
                /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
            );
            const refused = Boolean(refuseComment);
            const refuseReason = refuseComment
                ? (refuseComment.body || "")
                      .replace(/^\s*\[ABCC_REFUSE\]\s*/i, "")
                      .trim()
                : "";
            const review = deriveReviewStatus(filteredComments);
            const relatedEntries = extractCatalogEntriesFromPullFiles(files);
            const headRepo = pr.head?.repo;
            const out: PublishingResource[] = [];

            for (const entry of relatedEntries) {
                const prState: "open" | "closed" | "merged" =
                    pr.state === "closed"
                        ? pr.merged_at
                            ? "merged"
                            : "closed"
                        : "open";
                out.push({
                    id: entry.id,
                    name: entry.name,
                    restype: entry.restype,
                    status: review.state,
                    needs: review.items,
                    createdAt: pr.created_at,
                    prNumber: pr.number,
                    prTitle: pr.title,
                    prUrl: pr.html_url || "",
                    prState,
                    refused: refused || undefined,
                    refuseReason: refuseReason || undefined,
                    prHead: headRepo
                        ? {
                              owner: headRepo.owner?.login || "",
                              repo: headRepo.name,
                              ref: pr.head?.ref || "",
                          }
                        : undefined,
                    catalog: {
                        entry,
                        owner: headRepo?.owner?.login || entry.repo_owner || "",
                        repo: headRepo?.name || entry.repo_name || "",
                        ref: pr.head?.ref || entry.repo_commit_hash || "",
                        sha: pr.head?.sha,
                    },
                });
            }
            return out;
        } catch (error) {
            console.error("Failed to process PR", pr.number, error);
            return [] as PublishingResource[];
        }
    });

    return results.flat().sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
}

async function loadInProgressStagingResourcesForCurrentUser(
    pulls: MyReviewPullRequest[],
): Promise<PublishingResource[]> {
    const { token, username } = requireGithubAccount();
    const orgMembers = await listOrganizationMembers(
        PUBLISH_CONFIG.upstreamRepoOwner,
    ).catch(() => new Set<string>());

    const results = await mapWithConcurrency(pulls, 5, async (pr) => {
        if (!pr.user?.login || pr.user.login.toLowerCase() !== username.toLowerCase()) {
            return [] as PublishingResource[];
        }
        try {
            const [comments, files] = await Promise.all([
                fetchPrTimelineComments(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
                fetchPullFiles(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
            ]);
            const filteredComments = filterReviewTagComments(
                comments,
                orgMembers,
                pr.user?.login,
            );
            const refuseComment = filteredComments.find((comment) =>
                /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
            );
            const refused = Boolean(refuseComment);
            const refuseReason = refuseComment
                ? (refuseComment.body || "")
                      .replace(/^\s*\[ABCC_REFUSE\]\s*/i, "")
                      .trim()
                : "";
            const review = deriveReviewStatus(filteredComments);
            const entriesByPath = submissionEntryFromPullFiles(files);
            const headRepo = pr.head?.repo;
            const out: PublishingResource[] = [];

            for (const [submissionPath, entry] of entriesByPath) {
                const prState: "open" | "closed" | "merged" =
                    pr.state === "closed"
                        ? pr.merged_at
                            ? "merged"
                            : "closed"
                        : "open";

                out.push({
                    id: entry.id,
                    name: entry.name,
                    restype: entry.restype,
                    status: review.state,
                    needs: review.items,
                    createdAt: pr.created_at,
                    prNumber: pr.number,
                    prTitle: pr.title,
                    prUrl: pr.html_url || "",
                    prState,
                    refused: refused || undefined,
                    refuseReason: refuseReason || undefined,
                    prHead: headRepo
                        ? {
                              owner: headRepo.owner?.login || "",
                              repo: headRepo.name,
                              ref: pr.head?.ref || "",
                          }
                        : undefined,
                    catalog: {
                        entry,
                        owner: headRepo?.owner?.login || entry.repo_owner || "",
                        repo: headRepo?.name || entry.repo_name || "",
                        ref: pr.head?.ref || entry.repo_commit_hash || "",
                        sha: pr.head?.sha,
                    },
                    submission: {
                        path: submissionPath,
                        request: undefined,
                    },
                });
            }
            return out;
        } catch (error) {
            console.error("Failed to process staging PR", pr.number, error);
            return [] as PublishingResource[];
        }
    });

    return results.flat().sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
}

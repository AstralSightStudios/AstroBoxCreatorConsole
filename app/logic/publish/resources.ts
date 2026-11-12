import { PUBLISH_CONFIG } from "~/config/publish";
import { loadRepoEnvId } from "~/config/repoEnv";
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
    hasHideTag,
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
    /** 删除申请与普通提交共用待审核列表，用 kind 区分并阻止进入编辑。 */
    kind?: "submission" | "delete";
    /** 创作者用 [ABCC_HIDE] 评论隐藏的 closed 记录；open 记录不隐藏。 */
    hidden?: boolean;
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
    /** PR 当前标题，用于在资源标题变更时同步刷新。 */
    prTitle?: string;
    prState?: "open" | "closed" | "merged";
    prHead?: { owner: string; repo: string; ref: string };
    reviewState?: ReviewState;
    needs?: NeedFixItem[];
    submission?: {
        path: string;
        request: SubmissionRequest;
    };
}

/**
 * 编辑上下文的内容指纹。
 *
 * `location.state` 在每次 `popstate` 时都会由 `history.state.usr` 重新反序列化，
 * 即使回到的是同一条历史记录，`location.state.editContext` 也会是一个内容相同、
 * 引用不同的新对象。若直接用它触发同步，抽屉/弹窗关闭（内部 `history.back()`）
 * 就会让编辑页把整份远端数据重新加载一遍。这里只比较真正决定「编辑哪个资源」
 * 的字段，用于跳过这类无意义的重新同步。
 */
export function getEditContextIdentity(
    context: ResourceEditContext | null | undefined,
): string {
    if (!context) return "";
    const entry = context.catalog.entry;
    return [
        context.mode,
        context.prNumber ?? "",
        entry.id,
        entry.repo_owner,
        entry.repo_name,
        entry.repo_commit_hash,
        context.prHead?.owner ?? "",
        context.prHead?.repo ?? "",
        context.prHead?.ref ?? "",
    ].join("\u0001");
}

/**
 * 「资源 ID / 资源类型」是否允许修改：以编辑会话开始时的资源 ID 是否已进入
 * 已合入的上游目录文件（仓库根目录的 index_v2.csv）为准。
 * - 全新发布（无编辑上下文）：必然未合入，允许修改；
 * - 进行中的首次提交 PR / 审核中的首次提交：ID 尚未合入目录，允许修改，
 *   修改后重跑步骤 2 重传包体与 manifest 即可；
 * - 已合入目录的资源（已发布更新，或审核中 PR 的原 ID 已被合入）：改 ID
 *   会让服务端无法按下线资源的 ID 键联评分、购买等数据，必须锁定。
 * 目录 ID 列表尚未加载（网络失败等）时保守视为已合入，避免误放。
 */
export function canEditResourceIdentity(options: {
    editContext: Pick<ResourceEditContext, "catalog"> | null | undefined;
    /** 已合入目录 index_v2.csv 的全部资源 ID → 名称映射；null 表示尚未加载。 */
    catalogIds: ReadonlyMap<string, unknown> | null | undefined;
}): boolean {
    const originalId = options.editContext?.catalog.entry.id.trim() ?? "";
    if (!originalId) return true;
    const { catalogIds } = options;
    if (!catalogIds) return false;
    const target = originalId.toLowerCase();
    for (const id of catalogIds.keys()) {
        if (id.trim().toLowerCase() === target) return false;
    }
    return true;
}

/**
 * 编辑的若是已上架资源，返回它在目录里的 ID：目录模式就是目录行；继续编辑「更新」PR 时
 * 目录里的 ID 记在提交请求的 original_id 里（PR 的目录行可能已经换成了新 ID）。
 * 全新发布、首次提交的 PR 返回 null。
 */
export function listedResourceIdOf(
    editContext: Pick<ResourceEditContext, "mode" | "catalog" | "submission"> | null | undefined,
): string | null {
    if (!editContext) return null;
    if (editContext.mode === "catalog") {
        return editContext.catalog.entry.id.trim() || null;
    }
    const request = editContext.submission?.request;
    if (request?.mode !== "edit") return null;
    return request.original_id?.trim() || null;
}

/**
 * 本次提交是否把已上架资源换到了新 ID（只有改资源类型时才允许，例如表盘改成模块）。
 * 换 ID 时要在提交 PR 前向服务端登记，合入后服务端才会把旧 ID 上的数据搬到新 ID。
 */
export function resolveIdMigration(options: {
    editContext: Pick<ResourceEditContext, "mode" | "catalog" | "submission"> | null | undefined;
    itemId: string;
}): { fromId: string; toId: string } | null {
    const fromId = listedResourceIdOf(options.editContext);
    const toId = options.itemId.trim();
    if (!fromId || !toId || toId === fromId) return null;
    return { fromId, toId };
}

/**
 * 资源类型与资源 ID 输入框是否锁定。
 * - 未合入目录（canEditIdentity 为 true）：都可以改；
 * - 已合入目录：类型可以改；ID 只有在类型改成别的之后才能改。不同类型的 ID 格式不同
 *   （表盘是 9798 开头的 12 位数字，模块是小写字母开头的名称），换类型往往只能连 ID 一起换，
 *   服务端会在合入后把旧 ID 上的数据搬过去；类型不变时没有理由换 ID，继续锁定。
 */
export function resolveIdentityLocks(options: {
    isEditing: boolean;
    canEditIdentity: boolean;
    /** 目录行里的资源类型（编辑会话加载时的类型） */
    listedType: string | null | undefined;
    resourceType: string;
}): { typeLocked: boolean; idLocked: boolean } {
    if (!options.isEditing || options.canEditIdentity) {
        return { typeLocked: false, idLocked: false };
    }
    const listedType = (options.listedType ?? "").trim();
    return {
        typeLocked: false,
        idLocked: !listedType || options.resourceType === listedType,
    };
}

/**
 * 依据旧 PR 标题推导出更新后的标题：保留原来的
 * 「[ABCC] Add new resource / Update resource」动作前缀，仅刷新资源名称部分。
 * 旧标题缺失或不是 ABCC 生成格式时，退回标准的「Update resource」格式。
 */
export function buildResourcePrTitle(options: {
    currentTitle?: string;
    itemName: string;
    itemId: string;
}): string {
    const name =
        options.itemName.trim() || options.itemId.trim() || "资源";
    const action =
        options.currentTitle?.trim().match(
            /^\[ABCC\]\s*(Add new resource|Update resource)\s*:/,
        )?.[1] ?? "Update resource";
    return `[ABCC] ${action}: ${name}`;
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
    if (request.mode === "delete") {
        throw new Error("该 PR 是删除申请，不能继续编辑。");
    }
    const entry = parseSubmissionCsv(decodeCatalogContent(csvFile.content));
    // 审核状态与 NEEDFIX 列表：编辑页据此展示待修复问题，并在重新打开 PR
    // 前要求全部修复。拉取失败时按无 NEEDFIX 处理，避免卡住正常编辑。
    const [comments, orgMembers] = await Promise.all([
        fetchPrTimelineComments(
            PUBLISH_CONFIG.targetPrRepoOwner,
            PUBLISH_CONFIG.targetPrRepoName,
            prNumber,
            token,
        ).catch(() => [] as any[]),
        listOrganizationMembers(PUBLISH_CONFIG.upstreamRepoOwner).catch(
            () => new Set<string>(),
        ),
    ]);
    const review = deriveReviewStatus(
        filterReviewTagComments(comments, orgMembers, full.user?.login),
    );
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
        prTitle: full.title || undefined,
        prState:
            full.state === "open"
                ? "open"
                : full.merged_at
                  ? "merged"
                  : "closed",
        prHead,
        reviewState: review.state,
        needs: review.items,
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
                // GitHub REST 返回的状态串是 CHANGES_REQUESTED / COMMENTED，
                // 不是提交时用的 REQUEST_CHANGES，写错会把 NEEDFIX 全部丢掉。
                (review.state === "CHANGES_REQUESTED" ||
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

interface InProgressPageCacheEntry {
    signature: string;
    data: PublishingResource[];
    hasMore: boolean;
}

/** 按仓库环境 + 账号 + 页码缓存，避免来回切页时重复拉评论与文件。 */
const inProgressPageCache = new Map<string, InProgressPageCacheEntry>();

/** 隐藏/恢复后清掉本次会话的列表缓存，下次进入页面重新从 PR 时间线计算。 */
export function clearInProgressResourcesCache() {
    inProgressPageCache.clear();
}

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

/** 单页 PR 数量。隐藏记录仍占用 API 的原始分页名额，分页按钮让用户继续往前翻。 */
const MY_REVIEW_PAGE_SIZE = 50;

interface MyReviewPullRequestPage {
    pulls: MyReviewPullRequest[];
    /** 是否还有更早的 PR 可以继续加载。 */
    hasMore: boolean;
}

/**
 * 按页拉取当前用户的 PR。
 *
 * 只拉第一页时额外合并一次 REST state=all：它同时承担 head 信息（含分支是否
 * 已删除）与 search 索引延迟时最新创建的 open PR 兜底。后续页只走 search，
 * 避免每次翻页都重复拉整份仓库 PR 列表。
 */
async function fetchMyReviewPullRequests(
    token: string,
    username: string,
    page: number,
): Promise<MyReviewPullRequestPage> {
    const owner = PUBLISH_CONFIG.targetPrRepoOwner;
    const repo = PUBLISH_CONFIG.targetPrRepoName;
    const headers = { Authorization: `Bearer ${token}` };
    const sameUser = (login?: string) =>
        Boolean(login && login.toLowerCase() === username.toLowerCase());

    const searchPromise = (async () => {
        try {
            // is:unmerged 让 GitHub 先在服务端排除已合入 PR，避免它们占用 50 条
            // 分页名额，也让 total_count 与实际可加载的条数一致。
            const query = `repo:${owner}/${repo} type:pr author:${username} is:unmerged`;
            const data = await githubFetch<{
                total_count?: number;
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
                `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${MY_REVIEW_PAGE_SIZE}&page=${page}`,
                { headers },
            );
            const items = (data.items || []).filter(
                (item) =>
                    item.number != null &&
                    !item.merged_at &&
                    !item.pull_request?.merged_at,
            );
            const total =
                typeof data.total_count === "number"
                    ? data.total_count
                    : page * MY_REVIEW_PAGE_SIZE;
            return {
                items: items.map((item) => ({
                    number: item.number!,
                    title: item.title || "",
                    state: item.state || "open",
                    user: item.user,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                    html_url: item.html_url,
                    merged_at: null,
                })),
                hasMore: page * MY_REVIEW_PAGE_SIZE < total,
            };
        } catch (error) {
            console.error("search API 不可用，回退到 pulls API", error);
            return null;
        }
    })();

    // 后续页不需要 head 兜底，也不应重复请求整份仓库 PR 列表。
    if (page > 1) {
        const searchResult = await searchPromise;
        if (!searchResult) {
            // 抛给 loadMore：失败时保留「加载更多」按钮，用户可以直接重试。
            throw new Error("加载更多 PR 失败，请稍后重试。");
        }
        return {
            pulls: searchResult.items,
            hasMore: searchResult.hasMore,
        };
    }

    // head 信息只是增强项（编辑时会按 PR 号重新拉取）；这里失败不应拖垮整个列表。
    let allPulls: any[] = [];
    try {
        allPulls = await githubFetch<any[]>(
            `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`,
            { headers },
        );
    } catch (error) {
        console.error("拉取仓库 PR 列表失败，跳过 head 兜底", error);
    }
    const validPulls = allPulls.filter(
        (pull) => !pull.merged_at && Boolean(pull.head?.repo),
    );
    const searchResult = await searchPromise;
    if (searchResult === null) {
        return { pulls: validPulls, hasMore: false };
    }

    const headByNumber = new Map<number, any>();
    for (const pull of allPulls) {
        headByNumber.set(pull.number, pull.head);
    }
    const byNumber = new Map<number, MyReviewPullRequest>();
    for (const item of searchResult.items) {
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
    return {
        pulls: Array.from(byNumber.values()).sort((a, b) =>
            (b.updated_at || "").localeCompare(a.updated_at || ""),
        ),
        hasMore: searchResult.hasMore,
    };
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

export interface InProgressResourcesPage {
    data: PublishingResource[];
    /** 是否还有更早的 PR 可以继续加载。 */
    hasMore: boolean;
}

/**
 * 拉取创作者侧的「审核列表」。
 *
 * 每次只处理一页 PR（默认 50 条）；被 [ABCC_HIDE] 隐藏的记录仍会占用这一页的
 * 原始名额，但不会阻止继续加载更早的页。页面按需调用，避免一次性把所有历史 PR
 * 的评论与文件都拉下来。
 */
export async function loadInProgressResourcesForCurrentUser(
    options: { page?: number } = {},
): Promise<InProgressResourcesPage> {
    const page = Math.max(1, Math.trunc(options.page ?? 1));
    const { token, username } = requireGithubAccount();
    const { pulls, hasMore } = await fetchMyReviewPullRequests(
        token,
        username,
        page,
    );
    const signature = pulls
        .map(
            (pull) =>
                `${pull.state || "open"}:${pull.number}:${pull.updated_at || ""}`,
        )
        .join("|");
    const cacheKey = `${loadRepoEnvId()}:${username.toLowerCase()}:${page}`;
    const cached = inProgressPageCache.get(cacheKey);
    if (cached && cached.signature === signature) {
        return { data: cached.data, hasMore: cached.hasMore };
    }
    const data = await loadInProgressStagingResourcesForCurrentUser(pulls);
    inProgressPageCache.set(cacheKey, { signature, data, hasMore });
    return { data, hasMore };
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
            // 隐藏只作用于 closed 记录：PR 之后被重新打开时应重新出现在列表里。
            const hidden =
                pr.state === "closed" && hasHideTag(comments, pr.user?.login);
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
                    hidden: hidden || undefined,
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
            // 隐藏只作用于 closed 记录：PR 之后被重新打开时应重新出现在列表里。
            const hidden =
                pr.state === "closed" && hasHideTag(comments, pr.user?.login);
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
                    kind: pr.title.startsWith("[ABCC] Delete resource")
                        ? "delete"
                        : "submission",
                    hidden: hidden || undefined,
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

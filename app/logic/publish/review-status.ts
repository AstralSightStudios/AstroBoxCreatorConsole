export type ReviewState = "waiting_review" | "changes_requested" | "fixed_waiting";

export interface NeedFixItem {
    id: string;
    message: string;
    commentId?: number;
    commentBody?: string;
    fixedMessage?: string;
    fixed: boolean;
    createdAt?: string;
    fixedAt?: string;
    author?: { login: string; avatar_url?: string };
    fixedAuthor?: { login: string; avatar_url?: string };
}

export interface ReviewStatusResult {
    state: ReviewState;
    items: NeedFixItem[];
}

/** 单个审核者在某个 PR 上发送 NEEDFIX 的占比统计。 */
export interface NeedFixAuthorStat {
    login: string;
    avatar_url?: string;
    /** 该审核者发送的 NEEDFIX 条数（按 tagId 去重）。 */
    count: number;
    /** 占本 PR 全部 NEEDFIX 的百分比（四舍五入）。 */
    percent: number;
}

/**
 * 统计一个 PR 上每条 NEEDFIX 标签的作者分布，作为「负责审核者」的判定依据。
 *
 * 复用 `deriveReviewStatus` 的按 tagId 去重口径：同一条 NEEDFIX 被编辑只算一次。
 * 调用方传入的评论通常已经过 `filterReviewTagComments` 过滤，因此这里的作者
 * 天然只包含对仓库有权限（组织成员）的人。按条数降序排列，并列时最近发送者靠前。
 */
export function deriveNeedFixAuthors(
    comments: Array<{
        id?: number;
        body?: string;
        created_at?: string;
        user?: { login: string; avatar_url?: string };
    }>,
): NeedFixAuthorStat[] {
    const items = deriveReviewStatus(comments).items;
    const total = items.length;
    if (total === 0) return [];

    const byLogin = new Map<
        string,
        { login: string; avatar_url?: string; count: number; latest: string }
    >();
    for (const item of items) {
        const login = item.author?.login?.trim();
        if (!login) continue;
        const createdAt = item.createdAt || "";
        const existing = byLogin.get(login);
        if (existing) {
            existing.count += 1;
            if (createdAt > existing.latest) existing.latest = createdAt;
            if (!existing.avatar_url && item.author?.avatar_url) {
                existing.avatar_url = item.author.avatar_url;
            }
        } else {
            byLogin.set(login, {
                login,
                avatar_url: item.author?.avatar_url,
                count: 1,
                latest: createdAt,
            });
        }
    }

    return Array.from(byLogin.values())
        .sort(
            (a, b) =>
                b.count - a.count || b.latest.localeCompare(a.latest),
        )
        .map((entry) => ({
            login: entry.login,
            avatar_url: entry.avatar_url,
            count: entry.count,
            percent: Math.round((entry.count / total) * 100),
        }));
}

const COMMENT_PATTERN = /^\s*\[ABCC_(NEEDFIX|FIXED|CLOSE|REOPEN|REFUSE)(?:_([^\]]+))?\]\s*([\s\S]*)$/i;

export type TagAction = "close" | "reopen";

/**
 * 一个 PR 上可能同时存在 CLOSE 与 REOPEN 标签评论（例如关闭后又被创作者重开）。
 * 只取最新一条决定动作，避免 CLOSE/REOPEN 互相触发形成循环；
 * 评论正文里引用（blockquote）中的标签不会被计算。
 */
export function resolveLatestTagAction(
    comments: Array<{ body?: string; created_at?: string }>,
): TagAction | null {
    const actionComments = comments
        .filter((comment) =>
            /^\s*\[ABCC_(CLOSE|REOPEN)\]/i.test(comment.body?.trim() || ""),
        )
        .sort((a, b) =>
            (a.created_at || "").localeCompare(b.created_at || ""),
        );
    const latest = actionComments[actionComments.length - 1];
    if (!latest) return null;
    return /^\s*\[ABCC_REOPEN\]/i.test(latest.body || "") ? "reopen" : "close";
}

export function filterReviewTagComments<T extends {
    id?: number;
    body?: string;
    created_at?: string;
    user?: { login: string; avatar_url?: string };
} = {
    id?: number;
    body?: string;
    created_at?: string;
    user?: { login: string; avatar_url?: string };
}>(
    comments: T[],
    allowedAuthors?: Set<string>,
    prAuthor?: string,
): T[] {
    if (!allowedAuthors || allowedAuthors.size === 0) return comments;
    return comments.filter((comment) => {
        const body = comment.body?.trim();
        if (!body || !COMMENT_PATTERN.test(body)) return true;
        const login = comment.user?.login;
        const isMember = Boolean(login && allowedAuthors.has(login));
        const isAuthor = Boolean(prAuthor && login && login === prAuthor);
        // FIXED / REOPEN 由 PR 创建者通过工具发送，属于合法流程；
        // 其余标签（NEEDFIX/CLOSE/REFUSE）只能由组织 member 发送。
        const isAuthorFlowTag =
            /^\s*\[ABCC_(?:FIXED|REOPEN)(?:_[^\]]+)?\]/i.test(body);
        return isMember || (isAuthor && isAuthorFlowTag);
    });
}

export function deriveReviewStatus(comments: Array<{ id?: number; body?: string; created_at?: string; user?: { login: string; avatar_url?: string } }>): ReviewStatusResult {
    // 注意：调用方传入的评论可能是倒序（listPullRequestTimeline 按最新在前排序，
    // 供时间线 UI 使用），也可能是正序。这里做两遍扫描，使结果与数组顺序无关：
    // 第一遍收集所有 NEEDFIX，第二遍再用 FIXED 按 tagId 配对。
    const needFixes = new Map<string, string>();
    const needFixCommentIds = new Map<string, number>();
    const needFixCommentBodies = new Map<string, string>();
    const needFixCreatedAt = new Map<string, string>();
    const needFixAuthor = new Map<string, { login: string; avatar_url?: string }>();

    for (const comment of comments) {
        const body = comment.body?.trim();
        if (!body) continue;
        const match = body.match(COMMENT_PATTERN);
        if (!match) continue;
        const kind = match[1].toUpperCase();
        if (kind !== "NEEDFIX") continue;
        const id = (match[2] || "").trim();
        const message = (match[3] || "").trim();

        needFixes.set(id, message);
        if (typeof comment.id === "number") {
            needFixCommentIds.set(id, comment.id);
        }
        needFixCommentBodies.set(id, body);
        if (comment.created_at) {
            needFixCreatedAt.set(id, comment.created_at);
        }
        if (comment.user) {
            needFixAuthor.set(id, comment.user);
        }
    }

    const fixed = new Set<string>();
    const fixedMessages = new Map<string, string>();
    const fixedCreatedAt = new Map<string, string>();
    const fixedAuthor = new Map<string, { login: string; avatar_url?: string }>();

    for (const comment of comments) {
        const body = comment.body?.trim();
        if (!body) continue;
        const match = body.match(COMMENT_PATTERN);
        if (!match) continue;
        const kind = match[1].toUpperCase();
        if (kind !== "FIXED") continue;
        const id = (match[2] || "").trim();
        if (!needFixes.has(id) || fixed.has(id)) continue;
        const message = (match[3] || "").trim();

        fixed.add(id);
        fixedMessages.set(id, message);
        if (comment.created_at) {
            fixedCreatedAt.set(id, comment.created_at);
        }
        if (comment.user) {
            fixedAuthor.set(id, comment.user);
        }
    }

    if (needFixes.size === 0) {
        return { state: "waiting_review", items: [] };
    }

    const items: NeedFixItem[] = Array.from(needFixes.entries()).map(
        ([id, message]) => ({
            id,
            message,
            commentId: needFixCommentIds.get(id),
            commentBody: needFixCommentBodies.get(id),
            fixedMessage: fixed.has(id) ? fixedMessages.get(id) : undefined,
            fixed: fixed.has(id),
            createdAt: needFixCreatedAt.get(id),
            fixedAt: fixed.has(id) ? fixedCreatedAt.get(id) : undefined,
            author: needFixAuthor.get(id),
            fixedAuthor: fixed.has(id) ? fixedAuthor.get(id) : undefined,
        }),
    );

    const hasUnresolved = items.some((item) => !item.fixed);

    return {
        state: hasUnresolved ? "changes_requested" : "fixed_waiting",
        items,
    };
}

function reviewTimestamp(value?: string): number {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * 待审核 / 已修复混合按提交时间倒序；只有需修复置底，按本轮进入需修复的时间倒序。
 * FIXED 是创作者提交整改时发送的记录；普通评论与 PR updated_at 不参与排序。
 */
export function sortReviewPullRequests<T extends { number: number; created_at?: string }>(
    pulls: readonly T[],
    commentsByPr: Readonly<Record<number, Parameters<typeof deriveReviewStatus>[0]>>,
): T[] {
    return pulls
        .map((pull) => {
            const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
            const createdAt = reviewTimestamp(pull.created_at);
            const needsFix = status.state === "changes_requested";
            let sortTime = createdAt;

            if (!needsFix) {
                for (const item of status.items) {
                    sortTime = Math.max(sortTime, reviewTimestamp(item.fixedAt));
                }
            } else {
                const events = status.items.flatMap((item) => {
                    const needFixAt = reviewTimestamp(item.createdAt) || createdAt;
                    const fixedAt = Math.max(needFixAt, reviewTimestamp(item.fixedAt));
                    return [
                        { id: item.id, at: needFixAt, fixed: false, order: 1 },
                        ...(item.fixed ? [{
                            id: item.id,
                            at: fixedAt,
                            fixed: true,
                            // 同秒时先结束旧问题，再加入新问题；同秒提出并修复的最后处理。
                            order: fixedAt > needFixAt ? 0 : 2,
                        }] : []),
                    ];
                }).sort((a, b) => a.at - b.at || a.order - b.order);

                const unresolved = new Set<string>();
                for (const event of events) {
                    if (event.fixed) {
                        unresolved.delete(event.id);
                    } else {
                        // 已经处于需修复时追加意见，不改变本轮进入需修复的时间。
                        if (unresolved.size === 0) sortTime = event.at;
                        unresolved.add(event.id);
                    }
                }
            }

            return { pull, needsFix, sortTime };
        })
        .sort((a, b) =>
            Number(a.needsFix) - Number(b.needsFix) ||
            b.sortTime - a.sortTime ||
            b.pull.number - a.pull.number,
        )
        .map(({ pull }) => pull);
}

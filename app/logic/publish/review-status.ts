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

const COMMENT_PATTERN = /^\s*\[ABCC_(NEEDFIX|FIXED|CLOSE|REOPEN|REFUSE)(?:_([^\]]+))?\]\s*([\s\S]*)$/i;

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
    const needFixes = new Map<string, string>();
    const needFixCommentIds = new Map<string, number>();
    const needFixCommentBodies = new Map<string, string>();
    const needFixCreatedAt = new Map<string, string>();
    const needFixAuthor = new Map<string, { login: string; avatar_url?: string }>();
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
        const id = (match[2] || "").trim();
        const message = (match[3] || "").trim();

        if (kind === "NEEDFIX") {
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
            fixed.delete(id);
            fixedMessages.delete(id);
        } else if (kind === "FIXED") {
            if (needFixes.has(id)) {
                fixed.add(id);
                fixedMessages.set(id, message);
                if (comment.created_at) {
                    fixedCreatedAt.set(id, comment.created_at);
                }
                if (comment.user) {
                    fixedAuthor.set(id, comment.user);
                }
            }
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

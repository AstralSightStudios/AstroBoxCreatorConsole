export type ReviewState = "waiting_review" | "changes_requested" | "fixed_waiting";

export interface NeedFixItem {
    id: string;
    message: string;
    fixed: boolean;
}

export interface ReviewStatusResult {
    state: ReviewState;
    items: NeedFixItem[];
}

const COMMENT_PATTERN = /^\s*\[ABCC_(NEEDFIX|FIXED)_([^\]]+)\]\s*(.*)$/i;

export function deriveReviewStatus(comments: Array<{ body?: string }>): ReviewStatusResult {
    const needFixes = new Map<string, string>();
    const fixed = new Set<string>();

    for (const comment of comments) {
        const body = comment.body?.trim();
        if (!body) continue;
        const match = body.match(COMMENT_PATTERN);
        if (!match) continue;
        const kind = match[1].toUpperCase();
        const id = match[2].trim();
        const message = (match[3] || "").trim();

        if (kind === "NEEDFIX") {
            needFixes.set(id, message);
        } else if (kind === "FIXED") {
            fixed.add(id);
        }
    }

    if (needFixes.size === 0) {
        return { state: "waiting_review", items: [] };
    }

    const items: NeedFixItem[] = Array.from(needFixes.entries()).map(
        ([id, message]) => ({
            id,
            message,
            fixed: fixed.has(id),
        }),
    );

    const hasUnresolved = items.some((item) => !item.fixed);

    return {
        state: hasUnresolved ? "changes_requested" : "fixed_waiting",
        items,
    };
}

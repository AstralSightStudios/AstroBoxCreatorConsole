import { sendApiRequest } from "./request";

export interface CreatorCommentReplyTo {
    id: string;
    senderDisplayName: string;
    content: string;
}

export interface CreatorCommentItem {
    id: string;
    resourceId: string;
    resourceName: string;
    senderId: string;
    senderDisplayName: string;
    senderAvatar: string;
    senderIsVip: boolean;
    content: string;
    timestamp: string;
    likes: number;
    senderLocation?: string;
    parentId: string | null;
    replyTo?: CreatorCommentReplyTo;
}

export interface CreatorCommentsResponse {
    total: number;
    page: number;
    pageSize: number;
    comments: CreatorCommentItem[];
}

export interface CreatorCommentsSummaryResource {
    resourceId: string;
    resourceName: string;
    total: number;
    last7d: number;
    last30d: number;
    lastCommentAt: string | null;
}

export interface CreatorCommentsSummary {
    total: number;
    last7d: number;
    last30d: number;
    resources: CreatorCommentsSummaryResource[];
}

export function listCreatorComments(params: {
    resourceId?: string;
    page?: number;
    pageSize?: number;
}) {
    return sendApiRequest<CreatorCommentsResponse>(
        "/comment/creator/list",
        "POST",
        undefined,
        params,
    );
}

export function getCreatorCommentsSummary() {
    return sendApiRequest<CreatorCommentsSummary>(
        "/comment/creator/summary",
        "POST",
        undefined,
        {},
    );
}

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

/**
 * 以作者身份回复评论（复用 App 端的 /comment/send，带 isDeveloperReply）。
 * 服务端会校验当前账号是资源主作者或管理员；内容审核是异步的，接口返回 200
 * 只代表已受理，回复要等审核通过才会出现在对话里。
 */
export function replyCreatorComment(params: {
    resourceId: string;
    parentId: string;
    content: string;
}) {
    return sendApiRequest<unknown>("/comment/send", "POST", undefined, {
        resourceId: params.resourceId,
        parentId: params.parentId,
        content: params.content,
        isDeveloperReply: true,
    });
}

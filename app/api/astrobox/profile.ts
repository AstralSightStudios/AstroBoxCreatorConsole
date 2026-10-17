import { sendApiRequest } from "./request";

export interface ProfileResourceSummary {
    id: string;
    name: string;
    restype: string;
    icon: string;
    downloads: number;
}

export interface ProfileStats {
    resources: number;
    plugins: number;
    totalDownloads: number;
}

export interface PublicProfile {
    userId: string;
    displayName: string;
    username: string;
    avatar: string;
    vip: string;
    stats: ProfileStats;
    resources: ProfileResourceSummary[];
    plugins: ProfileResourceSummary[];
}

export interface GetProfileRequest {
    userId?: string;
    username?: string;
}

export function getPublicProfile(body: GetProfileRequest): Promise<PublicProfile> {
    return sendApiRequest<PublicProfile>("/account/profile", "POST", undefined, body);
}

/**
 * 公开创作者搜索的结果项，与 AstroBox 服务端 `/account/search` 返回一一对应。
 * 只含显示名、用户名、头像与作品数——不含 VIP 等权益字段。
 */
export interface AuthorSearchItem {
    userId: string;
    displayName: string;
    username: string;
    avatar: string;
    resourceCount: number;
}

export interface SearchAuthorsResponse {
    authors: AuthorSearchItem[];
}

/** 服务端 `/account/search` 的 limit 上限（超出会被参数校验直接拒绝）。 */
const AUTHOR_SEARCH_LIMIT_MAX = 30;

/**
 * 按显示名 / 用户名搜索创作者，与 AstroBox-NG 首页「搜索创作者」走的是同一个
 * 公开接口。服务端只匹配 displayName 与 username（大小写不敏感的子串），且只
 * 返回「已有作品」的账号；关键词去空白后为空或超过 128 字符时返回空列表。
 */
export function searchAuthors(
    keyword: string,
    limit = 10,
): Promise<SearchAuthorsResponse> {
    const boundedLimit = Math.min(
        Math.max(Math.trunc(limit) || 10, 1),
        AUTHOR_SEARCH_LIMIT_MAX,
    );
    const query = new URLSearchParams({
        keyword,
        limit: String(boundedLimit),
    });
    return sendApiRequest<SearchAuthorsResponse>(
        `/account/search?${query.toString()}`,
        "GET",
    );
}

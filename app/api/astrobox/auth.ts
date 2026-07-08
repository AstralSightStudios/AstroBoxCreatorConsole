import { sendApiRequest } from "./request";

export function getSelfUserInfo(token?: string): Promise<any> {
    return sendApiRequest("/auth/api/getUserInfo", "GET", token);
}

export interface SelfAccountContext {
    userId: string;
    username: string;
    displayName: string;
    email: string;
    avatar: string;
    vip: string;
    vipExpireMap: Record<string, string>;
    roles: string[];
    activeSocialBan: {
        id: string;
        reason: string;
        expiresAt: string | null;
    } | null;
}

export function getSelfAccountContext(token?: string): Promise<SelfAccountContext> {
    return sendApiRequest("/auth/api/me", "GET", token);
}

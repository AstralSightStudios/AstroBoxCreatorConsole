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

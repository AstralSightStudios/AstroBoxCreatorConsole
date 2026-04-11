import { sendApiRequest } from "./request";

export type DayOverDayDirection = "increase" | "decrease" | "flat";
export type DashboardPeriod = "7d" | "30d" | "90d" | "all";

export interface DashboardOverviewData {
    todayDownloads: number;
    weekDownloads: number;
    dayOverDayChangeValue: number | null;
    dayOverDayChangeDirection: DayOverDayDirection;
    dayOverDayChangeAccessible: boolean;
    dayOverDayChangeIsPlus: boolean;
}

export interface DashboardTopDownloadItem {
    name: string;
    downloads: number;
    imageUrl?: string;
}

export interface DashboardTopDownloadsData {
    topResource?: DashboardTopDownloadItem | null;
    topDevice?: DashboardTopDownloadItem | null;
}

export interface DashboardDistributionItem {
    id?: string;
    name: string;
    downloads: number;
    percentage: number;
    color?: string;
}

export interface CreatorConsoleDashboardResponse {
    generatedAt?: string;
    overview: DashboardOverviewData;
    topDownloads: DashboardTopDownloadsData;
    distributions: {
        resources: DashboardDistributionItem[];
        devices: DashboardDistributionItem[];
    };
    distributionsIsPlus: boolean;
    distributionsAccessible: boolean;
}

export function getCreatorConsoleDashboard(params?: {
    period?: DashboardPeriod;
    resourceId?: string;
}) {
    const query = new URLSearchParams();
    if (params?.period && params.period !== "all") {
        query.set("period", params.period);
    }
    if (params?.resourceId?.trim()) {
        query.set("resourceId", params.resourceId.trim());
    }
    const queryString = query.toString();
    const url = queryString
        ? `/dashboard/api/creator-console/home?${queryString}`
        : "/dashboard/api/creator-console/home";

    return sendApiRequest<CreatorConsoleDashboardResponse>(
        url,
        "GET",
    );
}

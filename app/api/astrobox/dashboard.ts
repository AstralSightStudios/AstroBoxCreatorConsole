import { sendApiRequest } from "./request";

export type DayOverDayDirection = "increase" | "decrease" | "flat";

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

export function getCreatorConsoleDashboard() {
    return sendApiRequest<CreatorConsoleDashboardResponse>(
        "/dashboard/api/creator-console/home",
        "GET",
    );
}

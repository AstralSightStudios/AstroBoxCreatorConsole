import { sendApiRequest } from "./request";

export type AnalysisMapScope = "china" | "world";
export type AnalysisPeriod = "7d" | "30d" | "90d" | "all";

export interface AnalysisHeatPoint {
    id: string;
    label: string;
    downloads: number;
    longitude?: number;
    latitude?: number;
    normalizedX?: number;
    normalizedY?: number;
    countryCode?: string;
    provinceCode?: string;
}

export interface AnalysisHeatmapSummary {
    totalDownloads: number;
    distinctLocations: number;
}

export interface AnalysisHeatmapResponse {
    scope: AnalysisMapScope;
    period: AnalysisPeriod;
    generatedAt?: string;
    isPlus: boolean;
    accessible: boolean;
    summary: AnalysisHeatmapSummary;
    points: AnalysisHeatPoint[];
}

export interface AnalysisOverviewSummary {
    resources: number;
    views: number;
    downloads: number;
    averageRating: number;
}

export interface AnalysisRatingDistribution {
    "1": number;
    "2": number;
    "3": number;
    "4": number;
    "5": number;
}

export interface AnalysisDailyDownloads {
    date: string;
    count: number;
}

export interface AnalysisOverviewResponse {
    period: AnalysisPeriod;
    generatedAt?: string;
    summary: AnalysisOverviewSummary;
    ratings: AnalysisRatingDistribution;
    dailyDownloads: AnalysisDailyDownloads[];
}

export interface CreatorAnalysisResource {
    id: string;
    name: string;
    restype: string;
    icon?: string;
    cover?: string;
    hasAnalysisData: boolean;
    views: number;
    downloads: number;
    lastActivityAt?: string;
}

export function getCreatorAnalysisHeatmap(params: {
    scope: AnalysisMapScope;
    period?: AnalysisPeriod;
    resourceId?: string;
}) {
    const period = params.period || "30d";
    const query = new URLSearchParams({
        scope: params.scope,
        period,
    });
    if (params.resourceId?.trim()) {
        query.set("resourceId", params.resourceId.trim());
    }

    return sendApiRequest<AnalysisHeatmapResponse>(
        `/analysis/api/creator-console/heatmap?${query.toString()}`,
        "GET",
    );
}

export function getCreatorAnalysisOverview(params?: {
    period?: AnalysisPeriod;
    resourceId?: string;
}) {
    const period = params?.period || "30d";
    const query = new URLSearchParams({
        period,
    });
    if (params?.resourceId?.trim()) {
        query.set("resourceId", params.resourceId.trim());
    }

    return sendApiRequest<AnalysisOverviewResponse>(
        `/analysis/api/creator-console/overview?${query.toString()}`,
        "GET",
    );
}

export function getCreatorAnalysisResources() {
    return sendApiRequest<CreatorAnalysisResource[]>(
        "/analysis/api/creator-console/resources",
        "GET",
    );
}

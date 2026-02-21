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

export function getCreatorAnalysisHeatmap(params: {
    scope: AnalysisMapScope;
    period?: AnalysisPeriod;
}) {
    const period = params.period || "30d";
    const query = new URLSearchParams({
        scope: params.scope,
        period,
    });

    return sendApiRequest<AnalysisHeatmapResponse>(
        `/analysis/api/creator-console/heatmap?${query.toString()}`,
        "GET",
    );
}

export function getCreatorAnalysisOverview(params?: { period?: AnalysisPeriod }) {
    const period = params?.period || "30d";
    const query = new URLSearchParams({
        period,
    });

    return sendApiRequest<AnalysisOverviewResponse>(
        `/analysis/api/creator-console/overview?${query.toString()}`,
        "GET",
    );
}

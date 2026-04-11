import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
    getCreatorConsoleDashboard,
    type CreatorConsoleDashboardResponse,
    type DashboardDistributionItem,
    type DashboardPeriod,
} from "~/api/astrobox/dashboard";
import AnalysisSummary from "~/components/home/analysis-summary";
import DownloadOverview from "~/components/home/download-overview";
import FilterBar, {
    type FilterBarResourceOption,
} from "~/components/home/filter-bar";
import Page from "~/layout/page";
import { loadDeviceNameMap, resolveDeviceName } from "~/logic/devices/catalog";
import { getCreatorAnalysisResources } from "~/api/astrobox/analysis";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";

const DEFAULT_FILTERS: {
    period: DashboardPeriod;
    resourceId: string;
} = {
    period: "all",
    resourceId: "",
};

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
    all: "全部时间",
    "7d": "过去7天",
    "30d": "过去30天",
    "90d": "过去90天",
};

function formatDateTime(value?: string | Date | null) {
    if (!value) return "--";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(date);
}

function formatInteger(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return value.toLocaleString("zh-CN");
}

function formatPercent(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    const rounded = Math.round(value * 10) / 10;
    return `${rounded.toLocaleString("zh-CN", {
        minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
        maximumFractionDigits: 1,
    })}%`;
}

function formatDayOverDaySummary(
    overview: CreatorConsoleDashboardResponse["overview"],
) {
    if (overview.dayOverDayChangeIsPlus && !overview.dayOverDayChangeAccessible) {
        return "捐赠计划专享";
    }

    if (overview.dayOverDayChangeDirection === "flat") {
        return "持平";
    }

    const changeValue = formatInteger(overview.dayOverDayChangeValue);
    if (changeValue === "--") {
        return "--";
    }

    return overview.dayOverDayChangeDirection === "increase"
        ? `增加 ${changeValue}`
        : `减少 ${changeValue}`;
}

function csvEscape(value: string | number | boolean | null | undefined) {
    const normalized =
        value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(normalized)) {
        return `"${normalized.replace(/"/g, "\"\"")}"`;
    }
    return normalized;
}

function buildCsv(rows: Array<Array<string | number | boolean | null | undefined>>) {
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function downloadTextFile(filename: string, content: string) {
    const blob = new Blob(["\ufeff", content], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isTauriEnvironment() {
    return (
        typeof window !== "undefined" &&
        Boolean(
            (window as any).__TAURI_INTERNALS__ ||
                (window as any).__TAURI_METADATA__ ||
                (window as any).__TAURI_IPC__,
        )
    );
}

async function saveTextFile(filename: string, content: string) {
    if (!isTauriEnvironment()) {
        downloadTextFile(filename, content);
        return true;
    }

    const targetPath = await save({
        title: "导出概览数据",
        defaultPath: filename,
        filters: [
            {
                name: "CSV",
                extensions: ["csv"],
            },
        ],
    });

    if (!targetPath) {
        return false;
    }

    await invoke("write_text_file", {
        path: targetPath,
        content: `\ufeff${content}`,
    });

    return true;
}

function toTimestampLabel(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const dd = `${date.getDate()}`.padStart(2, "0");
    const hh = `${date.getHours()}`.padStart(2, "0");
    const min = `${date.getMinutes()}`.padStart(2, "0");
    const ss = `${date.getSeconds()}`.padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function buildHumanReadableExportRows(params: {
    dashboardData: CreatorConsoleDashboardResponse;
    requestedPeriod: DashboardPeriod;
    requestedResourceId: string;
    requestedResourceName: string;
    appliedPeriod: DashboardPeriod;
    appliedResourceId: string;
    appliedResourceName: string;
}) {
    const {
        dashboardData,
        requestedPeriod,
        requestedResourceId,
        requestedResourceName,
        appliedPeriod,
        appliedResourceId,
        appliedResourceName,
    } = params;

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
        ["AstroBox Creator Console 概览导出"],
        [],
        ["导出信息"],
        ["项目", "内容"],
        ["导出时间", formatDateTime(new Date())],
        ["数据生成时间", formatDateTime(dashboardData.generatedAt)],
        ["请求的时间范围", PERIOD_LABELS[requestedPeriod]],
        [
            "请求的资源筛选",
            requestedResourceName === "全部资源" || !requestedResourceId
                ? requestedResourceName
                : `${requestedResourceName} (${requestedResourceId})`,
        ],
        ["实际应用时间范围", PERIOD_LABELS[appliedPeriod]],
        [
            "实际应用资源筛选",
            appliedResourceName === "全部资源" || !appliedResourceId
                ? appliedResourceName
                : `${appliedResourceName} (${appliedResourceId})`,
        ],
        [],
        ["下载概览"],
        ["指标", "数值"],
        ["今日下载量", formatInteger(dashboardData.overview.todayDownloads)],
        ["本周下载量", formatInteger(dashboardData.overview.weekDownloads)],
        ["较昨日变化", formatDayOverDaySummary(dashboardData.overview)],
        [],
        ["下载排行"],
        ["类别", "名称", "下载量"],
        [
            "资源下载最多",
            dashboardData.topDownloads.topResource?.name || "--",
            formatInteger(dashboardData.topDownloads.topResource?.downloads),
        ],
        [
            "设备下载最多",
            dashboardData.topDownloads.topDevice?.name || "--",
            formatInteger(dashboardData.topDownloads.topDevice?.downloads),
        ],
        [],
        ["资源下载分布"],
        ["排名", "资源 ID", "资源名称", "下载量", "占比"],
    ];

    if (dashboardData.distributions.resources.length === 0) {
        rows.push(["-", "-", "暂无数据", "-", "-"]);
    } else {
        dashboardData.distributions.resources.forEach((item, index) => {
            rows.push([
                index + 1,
                item.id || "--",
                item.name || "--",
                formatInteger(item.downloads),
                formatPercent(item.percentage),
            ]);
        });
    }

    rows.push([]);
    rows.push(["设备下载分布"]);
    rows.push(["排名", "设备 ID", "设备名称", "下载量", "占比"]);

    if (dashboardData.distributions.devices.length === 0) {
        rows.push(["-", "-", "暂无数据", "-", "-"]);
    } else {
        dashboardData.distributions.devices.forEach((item, index) => {
            rows.push([
                index + 1,
                item.id || "--",
                item.name || "--",
                formatInteger(item.downloads),
                formatPercent(item.percentage),
            ]);
        });
    }

    return rows;
}

function normalizeResourceOptions(
    resources: FilterBarResourceOption[],
): FilterBarResourceOption[] {
    const deduped = new Map<string, FilterBarResourceOption>();
    for (const resource of resources) {
        const id = resource.id.trim();
        if (!id) continue;
        const current = deduped.get(id);
        if (!current || (!current.name && resource.name)) {
            deduped.set(id, { id, name: resource.name?.trim() || id });
        }
    }

    return Array.from(deduped.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hans", { sensitivity: "base" }),
    );
}

async function loadHomeFilterResources(): Promise<FilterBarResourceOption[]> {
    try {
        const resources = await getCreatorAnalysisResources();
        return normalizeResourceOptions(
            resources.map((resource) => ({
                id: resource.id,
                name: resource.name || resource.id,
            })),
        );
    } catch (analysisError) {
        console.warn("Failed to load analysis resources for home filter", analysisError);
    }

    try {
        const resources = await loadOwnedCatalogResourcesForCurrentUser();
        return normalizeResourceOptions(
            resources.map((resource) => ({
                id: resource.entry.id,
                name: resource.entry.name || resource.entry.id,
            })),
        );
    } catch (catalogError) {
        console.warn("Failed to load catalog resources for home filter", catalogError);
    }

    return [];
}

function normalizeDashboardDeviceNames(
    data: CreatorConsoleDashboardResponse,
    deviceNameMap: Map<string, string>,
): CreatorConsoleDashboardResponse {
    const next: CreatorConsoleDashboardResponse = {
        ...data,
        topDownloads: {
            ...data.topDownloads,
            topDevice: data.topDownloads.topDevice
                ? {
                      ...data.topDownloads.topDevice,
                      name: resolveDeviceName(
                          deviceNameMap,
                          data.topDownloads.topDevice.name,
                      ),
                  }
                : data.topDownloads.topDevice,
        },
        distributions: {
            resources: data.distributions.resources,
            devices: data.distributions.devices.map((item) => ({
                ...item,
                name: resolveDeviceName(deviceNameMap, item.name, item.id),
            })),
        },
    };

    return next;
}

export default function Home() {
    const [dashboardData, setDashboardData] =
        useState<CreatorConsoleDashboardResponse | null>(null);
    const [dashboardLoading, setDashboardLoading] = useState(true);
    const [dashboardError, setDashboardError] = useState("");
    const [dashboardWarning, setDashboardWarning] = useState("");
    const [resourceOptions, setResourceOptions] = useState<FilterBarResourceOption[]>([]);
    const [resourceOptionsLoading, setResourceOptionsLoading] = useState(true);
    const [period, setPeriod] = useState<DashboardPeriod>(DEFAULT_FILTERS.period);
    const [selectedResourceId, setSelectedResourceId] = useState(
        DEFAULT_FILTERS.resourceId,
    );
    const [appliedPeriod, setAppliedPeriod] = useState<DashboardPeriod>(
        DEFAULT_FILTERS.period,
    );
    const [appliedResourceId, setAppliedResourceId] = useState(
        DEFAULT_FILTERS.resourceId,
    );

    const selectedResourceName = useMemo(() => {
        if (!selectedResourceId) return "全部资源";
        return (
            resourceOptions.find((item) => item.id === selectedResourceId)?.name ||
            selectedResourceId
        );
    }, [resourceOptions, selectedResourceId]);

    const appliedResourceName = useMemo(() => {
        if (!appliedResourceId) return "全部资源";
        return (
            resourceOptions.find((item) => item.id === appliedResourceId)?.name ||
            appliedResourceId
        );
    }, [appliedResourceId, resourceOptions]);

    useEffect(() => {
        let active = true;

        const run = async () => {
            setResourceOptionsLoading(true);
            try {
                const options = await loadHomeFilterResources();
                if (active) {
                    setResourceOptions(options);
                }
            } finally {
                if (active) {
                    setResourceOptionsLoading(false);
                }
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!selectedResourceId) return;
        if (resourceOptions.some((item) => item.id === selectedResourceId)) return;
        setSelectedResourceId("");
    }, [resourceOptions, selectedResourceId]);

    useEffect(() => {
        let active = true;
        const shouldUseFilters = period !== "all" || Boolean(selectedResourceId);

        const run = async () => {
            setDashboardLoading(true);
            setDashboardError("");
            setDashboardWarning("");
            try {
                const data = await getCreatorConsoleDashboard(
                    shouldUseFilters
                        ? {
                              period,
                              resourceId: selectedResourceId || undefined,
                          }
                        : undefined,
                );
                let normalizedData = data;
                try {
                    const deviceNameMap = await loadDeviceNameMap();
                    normalizedData = normalizeDashboardDeviceNames(
                        data,
                        deviceNameMap,
                    );
                } catch (nameError) {
                    console.warn("Failed to normalize device names", nameError);
                }
                if (active) {
                    setDashboardData(normalizedData);
                    setAppliedPeriod(period);
                    setAppliedResourceId(selectedResourceId);
                }
            } catch (error) {
                if (shouldUseFilters) {
                    try {
                        const fallbackData = await getCreatorConsoleDashboard();
                        let normalizedFallback = fallbackData;
                        try {
                            const deviceNameMap = await loadDeviceNameMap();
                            normalizedFallback = normalizeDashboardDeviceNames(
                                fallbackData,
                                deviceNameMap,
                            );
                        } catch (nameError) {
                            console.warn("Failed to normalize device names", nameError);
                        }

                        if (active) {
                            setDashboardData(normalizedFallback);
                            setAppliedPeriod(DEFAULT_FILTERS.period);
                            setAppliedResourceId(DEFAULT_FILTERS.resourceId);
                            setDashboardWarning(
                                "当前服务端尚未返回按时间/资源筛选后的概览聚合，首页已回退到默认数据。若要让排行和分布随筛选联动，需要 `/dashboard/api/creator-console/home` 支持 `period`、`resourceId` 参数。",
                            );
                        }
                        return;
                    } catch (fallbackError) {
                        console.warn("Filtered dashboard fallback failed", fallbackError);
                    }
                }

                if (active) {
                    setDashboardData(null);
                    setDashboardError(
                        error instanceof Error
                            ? error.message
                            : "加载下载分析数据失败",
                    );
                }
            } finally {
                if (active) {
                    setDashboardLoading(false);
                }
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, [period, selectedResourceId]);

    const handleExport = async () => {
        if (!dashboardData) {
            toast.error("当前没有可导出的概览数据。");
            return;
        }

        const filename = `creator-console-overview-${toTimestampLabel()}.csv`;

        try {
            const saved = await saveTextFile(
                filename,
                buildCsv(
                    buildHumanReadableExportRows({
                        dashboardData,
                        requestedPeriod: period,
                        requestedResourceId: selectedResourceId,
                        requestedResourceName: selectedResourceName,
                        appliedPeriod,
                        appliedResourceId,
                        appliedResourceName,
                    }),
                ),
            );
            if (!saved) {
                return;
            }
            toast.success("概览导出已保存。");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "导出概览数据失败。",
            );
        }
    };

    return (
        <Page>
            <FilterBar
                period={period}
                onPeriodChange={setPeriod}
                resourceId={selectedResourceId}
                resources={resourceOptions}
                onResourceChange={setSelectedResourceId}
                onExport={handleExport}
                exportDisabled={dashboardLoading || !dashboardData}
                resourceLoading={resourceOptionsLoading}
            />
            {dashboardWarning && (
                <p className="px-3.5 pb-2 text-size-small text-amber-200/85">
                    {dashboardWarning}
                </p>
            )}
            <DownloadOverview
                data={dashboardData?.overview}
                loading={dashboardLoading}
                error={dashboardError}
            />
            <AnalysisSummary
                data={dashboardData}
                loading={dashboardLoading}
                error={dashboardError}
            />
        </Page>
    );
}

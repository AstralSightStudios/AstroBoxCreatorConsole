import { useEffect, useState } from "react";
import {
    getCreatorConsoleDashboard,
    type CreatorConsoleDashboardResponse,
} from "~/api/astrobox/dashboard";
import AnalysisSummary from "~/components/home/analysis-summary";
import DownloadOverview from "~/components/home/download-overview";
import FilterBar from "~/components/home/filter-bar";
import Page from "~/layout/page";
import { loadDeviceNameMap, resolveDeviceName } from "~/logic/devices/catalog";

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

    useEffect(() => {
        let active = true;

        const run = async () => {
            setDashboardLoading(true);
            setDashboardError("");
            try {
                const data = await getCreatorConsoleDashboard();
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
                }
            } catch (error) {
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
    }, []);

    return (
        <Page>
            <FilterBar />
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

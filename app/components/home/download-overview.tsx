import DataCard from "~/components/cards/datacard";
import type { DashboardOverviewData } from "~/api/astrobox/dashboard";

interface DownloadSummaryCard {
    label: string;
    value: string;
    isPlus?: boolean;
}

interface DownloadOverviewProps {
    data?: DashboardOverviewData;
    loading?: boolean;
    error?: string;
}

function formatInteger(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return value.toString();
}

function getDayOverDayLabel(data?: DashboardOverviewData) {
    if (!data) return "较昨日变化";
    if (data.dayOverDayChangeDirection === "increase") return "较昨日增加";
    if (data.dayOverDayChangeDirection === "decrease") return "较昨日减少";
    return "较昨日持平";
}

function getDayOverDayValue(data?: DashboardOverviewData, loading?: boolean) {
    if (loading) return "...";
    if (!data) return "--";
    if (data.dayOverDayChangeIsPlus && !data.dayOverDayChangeAccessible) {
        return "捐赠计划专享";
    }
    return formatInteger(data.dayOverDayChangeValue);
}

export default function DownloadOverview({
    data,
    loading,
    error,
}: DownloadOverviewProps) {
    const cards: DownloadSummaryCard[] = [
        {
            label: "今日下载量",
            value: loading ? "..." : formatInteger(data?.todayDownloads),
        },
        {
            label: "本周下载量",
            value: loading ? "..." : formatInteger(data?.weekDownloads),
        },
        {
            label: getDayOverDayLabel(data),
            value: getDayOverDayValue(data, loading),
            isPlus: Boolean(data?.dayOverDayChangeIsPlus),
        },
    ];

    return (
        <>
            <div className="pt-1.5 px-3.5">
                <p className="font-[520] text-size-large">下载数据</p>
            </div>
            <div className="p-1.5 grid gap-2.5 datacard-grid-sm">
                {cards.map(({ label, value, isPlus }) => (
                    <DataCard key={label} label={label} isPlus={isPlus}>
                        <p className="card-num">{value}</p>
                    </DataCard>
                ))}
            </div>
            {error && (
                <p className="px-3.5 text-size-small text-white/45">
                    下载数据暂不可用，已显示占位信息。
                </p>
            )}
        </>
    );
}

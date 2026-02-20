import { Tabs } from "@radix-ui/themes";
import { Cell, Pie, PieChart } from "recharts";
import type {
    CreatorConsoleDashboardResponse,
    DashboardDistributionItem,
} from "~/api/astrobox/dashboard";

interface DownloadsDistributionCardProps {
    data?: CreatorConsoleDashboardResponse["distributions"];
    isPlus?: boolean;
    accessible?: boolean;
    loading?: boolean;
    error?: string;
}

interface NormalizedDistributionEntry extends DashboardDistributionItem {
    color: string;
}

type PieChartDatum = {
    name: string;
    value: number;
    color: string;
};

const FALLBACK_COLORS = [
    "#e5484d",
    "#4287f5",
    "#f5a742",
    "#2fbf71",
    "#7c7cff",
    "#f97316",
];

function normalizeEntries(entries?: DashboardDistributionItem[]) {
    if (!entries || entries.length === 0) {
        return [];
    }

    return entries.map((entry, index): NormalizedDistributionEntry => {
        const color = entry.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
        return {
            ...entry,
            color,
        };
    });
}

function formatInteger(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return value.toString();
}

function formatPercent(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

export default function DownloadsDistributionCard({
    data,
    isPlus,
    accessible,
    loading,
    error,
}: DownloadsDistributionCardProps) {
    const plusLocked = Boolean(isPlus && accessible !== true);
    const resourceEntries = normalizeEntries(data?.resources);
    const deviceEntries = normalizeEntries(data?.devices);

    const renderDistributionContent = (entries: NormalizedDistributionEntry[]) => {
        if (loading) {
            return <p className="py-6 text-size-medium text-white/60">加载中...</p>;
        }

        if (plusLocked) {
            return (
                <p className="py-6 text-size-medium text-white/45">
                    该数据为 Plus 会员专享。
                </p>
            );
        }

        if (error) {
            return (
                <p className="py-6 text-size-medium text-white/45">
                    下载分布数据暂不可用。
                </p>
            );
        }

        if (entries.length === 0) {
            return (
                <p className="py-6 text-size-medium text-white/45">暂无下载分布数据。</p>
            );
        }

        const pieData: PieChartDatum[] = entries.map(({ name, downloads, color }) => ({
            name,
            value: downloads,
            color,
        }));

        return (
            <>
                <PieChart width={150} height={150}>
                    <Pie
                        data={pieData}
                        animationDuration={200}
                        innerRadius={35}
                        stroke="none"
                        dataKey="value"
                        nameKey="name"
                    >
                        {pieData.map(({ color, name }, index) => (
                            <Cell
                                key={`${name}-${index}`}
                                fill={color}
                                style={{ outline: "none" }}
                            />
                        ))}
                    </Pie>
                </PieChart>
                <div className="flex flex-col w-full gap-2">
                    {entries.map(({ id, name, color, percentage, downloads }) => (
                        <div key={id || name} className="flex flex-row w-full">
                            <div className="flex flex-row gap-2 items-center">
                                <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: color }}
                                />
                                <p className="font-[450] text-size-medium">{name}</p>
                            </div>
                            <div className="flex flex-row gap-4 items-center ml-auto">
                                <p className="font-[450] text-size-medium">
                                    占比{formatPercent(percentage)}%
                                </p>
                                <p className="font-[450] text-size-medium">
                                    累计下载{formatInteger(downloads)}次
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    };

    return (
        <div className="p-1.5 w-full lg:flex-1 flex">
            <div
                //@ts-ignore
                style={{ cornerShape: "superellipse(1.75)" }}
                className="pb-4 px-3.5 bg-nav-item rounded-2xl corner-rounded w-full h-full flex flex-col"
            >
                <Tabs.Root
                    className="dashboard-tabs w-full h-full"
                    defaultValue="resdown"
                >
                    <Tabs.List className="dashboard-tabs-list">
                        <Tabs.Trigger value="resdown">资源下载量</Tabs.Trigger>
                        <Tabs.Trigger value="devicedown">
                            设备下载量
                        </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content
                        value="resdown"
                        className="flex flex-col items-center w-full"
                    >
                        {renderDistributionContent(resourceEntries)}
                    </Tabs.Content>
                    <Tabs.Content
                        value="devicedown"
                        className="flex flex-col items-center w-full"
                    >
                        {renderDistributionContent(deviceEntries)}
                    </Tabs.Content>
                </Tabs.Root>
            </div>
        </div>
    );
}

import DataCard from "~/components/cards/datacard";
import AnimatedNumber from "~/components/animated-number";
import type { DashboardTopDownloadsData } from "~/api/astrobox/dashboard";

interface TopDownloadEntry {
    label: string;
    secondaryLabel: string;
    name: string;
    value: number | null;
    imageSrc?: string;
}

interface TopDownloadsProps {
    data?: DashboardTopDownloadsData;
    loading?: boolean;
    error?: string;
}

function buildEntries(
    data?: DashboardTopDownloadsData,
    loading?: boolean,
): TopDownloadEntry[] {
    return [
        {
            label: "资源下载最多",
            secondaryLabel: "下载量",
            name: loading ? "加载中..." : data?.topResource?.name || "--",
            value: loading ? null : data?.topResource?.downloads ?? null,
            imageSrc: data?.topResource?.imageUrl,
        },
        {
            label: "设备下载最多",
            secondaryLabel: "下载量",
            name: loading ? "加载中..." : data?.topDevice?.name || "--",
            value: loading ? null : data?.topDevice?.downloads ?? null,
        },
    ];
}

export default function TopDownloads({ data, loading, error }: TopDownloadsProps) {
    const entries = buildEntries(data, loading);

    return (
        <>
            <div className="py-1.5 gap-2.5 flex flex-col">
                {entries.map(
                    ({ label, secondaryLabel, name, value, imageSrc }) => (
                        <DataCard
                            key={label}
                            label={label}
                            secondaryLabel={secondaryLabel}
                        >
                            <div className="flex flex-row w-full items-center">
                                <div className="flex flex-row gap-2.5 items-center">
                                    {imageSrc && (
                                        <img
                                            width={40}
                                            height={40}
                                            style={{ objectFit: "scale-down" }}
                                            className="rounded-full"
                                            src={imageSrc}
                                            alt={name}
                                        />
                                    )}
                                    <p className="card-num">{name}</p>
                                </div>
                                <p className="card-num ml-auto">
                                    {loading ? (
                                        "..."
                                    ) : value === null || Number.isNaN(value) ? (
                                        "--"
                                    ) : (
                                        <AnimatedNumber
                                            value={value}
                                            initial
                                            locales="zh-CN"
                                            format={{
                                                useGrouping: false,
                                                maximumFractionDigits: 0,
                                            }}
                                            className="font-mono-sarasa"
                                        />
                                    )}
                                </p>
                            </div>
                        </DataCard>
                    ),
                )}
            </div>
            {error && (
                <p className="px-1.5 text-size-small text-white/45">
                    下载排行数据暂不可用，已显示占位信息。
                </p>
            )}
        </>
    );
}

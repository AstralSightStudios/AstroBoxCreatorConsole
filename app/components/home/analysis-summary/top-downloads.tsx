import DataCard from "~/components/cards/datacard";
import type { DashboardTopDownloadsData } from "~/api/astrobox/dashboard";

interface TopDownloadEntry {
    label: string;
    secondaryLabel: string;
    name: string;
    value: string;
    imageSrc?: string;
}

interface TopDownloadsProps {
    data?: DashboardTopDownloadsData;
    loading?: boolean;
    error?: string;
}

function formatInteger(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return value.toString();
}

function buildEntries(
    data?: DashboardTopDownloadsData,
    loading?: boolean,
): TopDownloadEntry[] {
    return [
        {
            label: "累计下载最多资源",
            secondaryLabel: "下载量",
            name: loading ? "加载中..." : data?.topResource?.name || "--",
            value: loading ? "..." : formatInteger(data?.topResource?.downloads),
            imageSrc: data?.topResource?.imageUrl,
        },
        {
            label: "累计下载最多设备",
            secondaryLabel: "下载量",
            name: loading ? "加载中..." : data?.topDevice?.name || "--",
            value: loading ? "..." : formatInteger(data?.topDevice?.downloads),
        },
    ];
}

export default function TopDownloads({ data, loading, error }: TopDownloadsProps) {
    const entries = buildEntries(data, loading);

    return (
        <>
            <div className="p-1.5 gap-2.5 flex flex-col">
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
                                            src={imageSrc}
                                            alt={name}
                                        />
                                    )}
                                    <p className="card-num">{name}</p>
                                </div>
                                <p className="card-num ml-auto">{value}</p>
                            </div>
                        </DataCard>
                    ),
                )}
            </div>
            {error && (
                <p className="px-3.5 text-size-small text-white/45">
                    下载排行数据暂不可用，已显示占位信息。
                </p>
            )}
        </>
    );
}

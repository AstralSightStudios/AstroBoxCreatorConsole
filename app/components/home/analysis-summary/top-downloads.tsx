import DataCard from "~/components/cards/datacard";

interface TopDownloadEntry {
    label: string;
    secondaryLabel: string;
    name: string;
    value: string;
    imageSrc?: string;
}

const TOP_DOWNLOADS: TopDownloadEntry[] = [
    {
        label: "累计下载最多资源",
        secondaryLabel: "下载量",
        name: "澎湃哔哩",
        value: "32906",
        imageSrc:
            "https://github.com/Searchstars/Hyperbilibili_AstroBox_Release/blob/main/icon.png?raw=true",
    },
    {
        label: "累计下载最多设备",
        secondaryLabel: "下载量",
        name: "Xiaomi Watch S4",
        value: "25643",
    },
];

export default function TopDownloads() {
    return (
        <div className="p-1.5 gap-2.5 flex flex-col">
            {TOP_DOWNLOADS.map(
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
    );
}

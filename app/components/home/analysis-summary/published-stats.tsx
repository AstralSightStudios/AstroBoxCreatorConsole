import DataCard from "~/components/cards/datacard";

interface PublishedStat {
    label: string;
    value: string;
}

const PUBLISHED_STATS: PublishedStat[] = [
    { label: "已发布资源数", value: "3" },
    { label: "已发布付费资源数", value: "0" },
    { label: "已发布表盘数", value: "1" },
    { label: "已发布快应用数", value: "2" },
];

export default function PublishedStats() {
    return (
        <div className="p-1.5 gap-2.5 datacard-grid-[150px]">
            {PUBLISHED_STATS.map(({ label, value }) => (
                <DataCard key={label} label={label}>
                    <p className="card-num">{value}</p>
                </DataCard>
            ))}
        </div>
    );
}

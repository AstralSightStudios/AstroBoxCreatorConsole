import DataCard from "~/components/cards/datacard";

interface DownloadSummaryCard {
    label: string;
    value: string;
    isPlus?: boolean;
}

const DOWNLOAD_SUMMARY_CARDS: DownloadSummaryCard[] = [
    { label: "今日下载量", value: "4312" },
    { label: "本周下载量", value: "25430" },
    { label: "较昨日减少", value: "121", isPlus: true },
];

export default function DownloadOverview() {
    return (
        <>
            <div className="pt-1.5 px-3.5">
                <p className="font-[520] text-size-large">下载数据</p>
            </div>
            <div className="p-1.5 grid gap-2.5 datacard-grid-sm">
                {DOWNLOAD_SUMMARY_CARDS.map(({ label, value, isPlus }) => (
                    <DataCard key={label} label={label} isPlus={isPlus}>
                        <p className="card-num">{value}</p>
                    </DataCard>
                ))}
            </div>
        </>
    );
}

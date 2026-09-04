import DataCard from "~/components/cards/datacard";
import AnimatedNumber from "~/components/animated-number";
import { useEffect, useMemo, useState } from "react";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";

interface PublishedStat {
    label: string;
    value: number | null;
}

function isPaidType(paidType: string) {
    const value = paidType.trim().toLowerCase();
    if (!value) return false;
    return !["0", "free", "none", "false", "unpaid", "免费"].includes(value);
}

export default function PublishedStats() {
    const [total, setTotal] = useState(0);
    const [paid, setPaid] = useState(0);
    const [watchface, setWatchface] = useState(0);
    const [quickApp, setQuickApp] = useState(0);
    const [canopus, setCanopus] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        const run = async () => {
            setLoading(true);
            setError("");
            try {
                const items = await loadOwnedCatalogResourcesForCurrentUser();
                if (!active) return;

                setTotal(items.length);
                setPaid(
                    items.filter((item) => isPaidType(item.entry.paid_type || ""))
                        .length,
                );
                setWatchface(
                    items.filter((item) => item.entry.restype === "watchface")
                        .length,
                );
                setQuickApp(
                    items.filter((item) => item.entry.restype === "quick_app")
                        .length,
                );
                setCanopus(
                    items.filter((item) => item.entry.restype === "canopus")
                        .length,
                );
            } catch (fetchError) {
                if (!active) return;
                setError(
                    fetchError instanceof Error
                        ? fetchError.message
                        : "加载已发布资源统计失败",
                );
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, []);

    const stats = useMemo<PublishedStat[]>(() => {
        if (loading) {
            return [
                { label: "已发布资源数", value: null },
                { label: "已发布付费资源数", value: null },
                { label: "已发布表盘数", value: null },
                { label: "已发布快应用数", value: null },
                { label: "已发布模块数", value: null },
            ];
        }

        if (error) {
            return [
                { label: "已发布资源数", value: null },
                { label: "已发布付费资源数", value: null },
                { label: "已发布表盘数", value: null },
                { label: "已发布快应用数", value: null },
                { label: "已发布模块数", value: null },
            ];
        }

        return [
            { label: "已发布资源数", value: total },
            { label: "已发布付费资源数", value: paid },
            { label: "已发布表盘数", value: watchface },
            { label: "已发布快应用数", value: quickApp },
            { label: "已发布模块数", value: canopus },
        ];
    }, [canopus, error, loading, paid, quickApp, total, watchface]);

    return (
        <>
            <div className="py-1.5 gap-2.5 datacard-grid-[150px]">
                {stats.map(({ label, value }) => (
                    <DataCard key={label} label={label}>
                        <p className="card-num">
                            {loading ? (
                                "..."
                            ) : value === null ? (
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
                    </DataCard>
                ))}
            </div>
            {error && (
                <p className="px-1.5 text-size-small text-white/45">
                    已发布资源统计暂不可用，已显示占位信息。
                </p>
            )}
        </>
    );
}

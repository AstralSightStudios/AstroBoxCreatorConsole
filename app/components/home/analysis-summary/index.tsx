import PublishedStats from "~/components/home/analysis-summary/published-stats";
import TopDownloads from "~/components/home/analysis-summary/top-downloads";
import DownloadsDistributionCard from "~/components/home/analysis-summary/downloads-distribution-card";
import { PlusIcon } from "~/components/svgs";
import type { CreatorConsoleDashboardResponse } from "~/api/astrobox/dashboard";

interface AnalysisSummaryProps {
    data?: CreatorConsoleDashboardResponse | null;
    loading?: boolean;
    error?: string;
}

export default function AnalysisSummary({
    data,
    loading,
    error,
}: AnalysisSummaryProps) {
    const showSummaryPlus = Boolean(data?.distributionsIsPlus);

    return (
        <>
            <div className="pt-1.5 px-3.5 mt-3.5 flex flex-row w-full">
                <p className="font-[520] text-size-large">分析摘要</p>
                {showSummaryPlus && <PlusIcon className="ml-auto" />}
            </div>
            <div className="flex flex-col w-full gap-2.5 lg:flex-row lg:items-stretch">
                <div className="flex flex-col w-full lg:flex-1">
                    <PublishedStats />
                    <TopDownloads
                        data={data?.topDownloads}
                        loading={loading}
                        error={error}
                    />
                </div>
                <DownloadsDistributionCard
                    data={data?.distributions}
                    isPlus={data?.distributionsIsPlus}
                    accessible={data?.distributionsAccessible}
                    loading={loading}
                    error={error}
                />
            </div>
        </>
    );
}

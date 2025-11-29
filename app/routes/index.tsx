import AnalysisSummary from "~/components/home/analysis-summary";
import DownloadOverview from "~/components/home/download-overview";
import FilterBar from "~/components/home/filter-bar";
import Page from "~/layout/page";

export default function Home() {
    return (
        <Page>
            <FilterBar />
            <DownloadOverview />
            <AnalysisSummary />
        </Page>
    );
}

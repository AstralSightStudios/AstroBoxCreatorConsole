import { Tabs } from "@radix-ui/themes";
import { Cell, Pie, PieChart } from "recharts";

interface DistributionEntry {
    name: string;
    value: number;
    color: string;
    percentage: string;
    downloads: string;
}

const DISTRIBUTION_ENTRIES: DistributionEntry[] = [
    {
        name: "澎湃哔哩",
        value: 760,
        color: "#e5484d",
        percentage: "占比76%",
        downloads: "累计下载32906次",
    },
    {
        name: "实时公交",
        value: 150,
        color: "#4287f5",
        percentage: "占比15%",
        downloads: "累计下载6494次",
    },
    {
        name: "Starfield Chronomark",
        value: 90,
        color: "#f5a742",
        percentage: "占比9%",
        downloads: "累计下载3896次",
    },
];

type PieChartDatum = {
    [key: string]: string | number;
    name: string;
    value: number;
    color: string;
};

const PIE_CHART_DATA: PieChartDatum[] = DISTRIBUTION_ENTRIES.map(
    ({ name, value, color }) => ({
        name,
        value,
        color,
    }),
);

export default function DownloadsDistributionCard() {
    return (
        <div className="p-1.5 w-full lg:flex-1 flex">
            <div
                //@ts-ignore
                style={{ cornerShape: "superellipse(1.75)" }}
                className="pb-4 px-3.5 bg-nav-item rounded-2xl w-full h-full flex flex-col"
            >
                <Tabs.Root className="dashboard-tabs w-full h-full" defaultValue="resdown">
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
                        <PieChart width={150} height={150}>
                            <Pie
                                data={PIE_CHART_DATA}
                                animationDuration={200}
                                innerRadius={35}
                                stroke="none"
                                dataKey="value"
                                nameKey="name"
                            >
                                {PIE_CHART_DATA.map(
                                    ({ color, name }, index) => (
                                        <Cell
                                            key={`${name}-${index}`}
                                            fill={color}
                                            style={{ outline: "none" }}
                                        />
                                    ),
                                )}
                            </Pie>
                        </PieChart>
                        <div className="flex flex-col w-full gap-2">
                            {DISTRIBUTION_ENTRIES.map(
                                ({ name, color, percentage, downloads }) => (
                                    <div
                                        key={name}
                                        className="flex flex-row w-full"
                                    >
                                        <div className="flex flex-row gap-2 items-center">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{
                                                    backgroundColor: color,
                                                }}
                                            ></div>
                                            <p className="font-[450] text-size-medium">
                                                {name}
                                            </p>
                                        </div>
                                        <div className="flex flex-row gap-4 items-center ml-auto">
                                            <p className="font-[450] text-size-medium">
                                                {percentage}
                                            </p>
                                            <p className="font-[450] text-size-medium">
                                                {downloads}
                                            </p>
                                        </div>
                                    </div>
                                ),
                            )}
                        </div>
                    </Tabs.Content>
                </Tabs.Root>
            </div>
        </div>
    );
}

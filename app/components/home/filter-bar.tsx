import {
    CaretDownIcon,
    ClockCountdownIcon,
    FunnelIcon,
    TrayArrowDownIcon,
} from "@phosphor-icons/react";
import { Button, DropdownMenu } from "@radix-ui/themes";
import type { DashboardPeriod } from "~/api/astrobox/dashboard";

export interface FilterBarResourceOption {
    id: string;
    name: string;
}

interface FilterBarProps {
    period: DashboardPeriod;
    onPeriodChange: (value: DashboardPeriod) => void;
    resourceId: string;
    resources: FilterBarResourceOption[];
    onResourceChange: (value: string) => void;
    onExport: () => void;
    exportDisabled?: boolean;
    resourceLoading?: boolean;
    resourceDisabled?: boolean;
}

const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
    { value: "all", label: "全部时间" },
    { value: "7d", label: "过去7天" },
    { value: "30d", label: "过去30天" },
    { value: "90d", label: "过去90天" },
];

const ALL_RESOURCES_VALUE = "__all_resources__";

export default function FilterBar({
    period,
    onPeriodChange,
    resourceId,
    resources,
    onResourceChange,
    onExport,
    exportDisabled,
    resourceLoading,
    resourceDisabled,
}: FilterBarProps) {
    const selectedResource = resources.find((item) => item.id === resourceId);
    const periodLabel =
        PERIOD_OPTIONS.find((option) => option.value === period)?.label || "全部时间";

    return (
        <div className="flex flex-row flex-wrap px-2 pt-1.5 pb-3 gap-2.5">
            <DropdownMenu.Root>
                <DropdownMenu.Trigger disabled={resourceDisabled}>
                    <Button
                        className="styledbtn max-w-[280px]"
                        radius="large"
                        disabled={resourceDisabled}
                    >
                        <FunnelIcon size={16} weight="fill" />
                        <span>筛选</span>
                        {selectedResource && (
                            <span
                                className="max-w-[140px] truncate text-white/70"
                                title={selectedResource.name}
                            >
                                · {selectedResource.name}
                            </span>
                        )}
                        <CaretDownIcon size={16} weight="bold" />
                    </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                    <DropdownMenu.Label>资源筛选</DropdownMenu.Label>
                    <DropdownMenu.Separator />
                    <DropdownMenu.RadioGroup
                        value={resourceId || ALL_RESOURCES_VALUE}
                        onValueChange={(value) =>
                            onResourceChange(value === ALL_RESOURCES_VALUE ? "" : value)
                        }
                    >
                        <DropdownMenu.RadioItem value={ALL_RESOURCES_VALUE}>
                            全部资源
                        </DropdownMenu.RadioItem>
                        {resourceLoading && (
                            <DropdownMenu.Item disabled>加载资源中...</DropdownMenu.Item>
                        )}
                        {!resourceLoading && resources.length === 0 && (
                            <DropdownMenu.Item disabled>暂无可筛选资源</DropdownMenu.Item>
                        )}
                        {resources.map((resource) => (
                            <DropdownMenu.RadioItem
                                key={resource.id}
                                value={resource.id}
                            >
                                {resource.name
                                    ? `${resource.name} (${resource.id})`
                                    : resource.id}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <Button className="styledbtn" radius="large">
                        <ClockCountdownIcon size={16} weight="fill" />
                        {periodLabel}
                        <CaretDownIcon size={16} weight="bold" />
                    </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                    <DropdownMenu.Label>时间范围</DropdownMenu.Label>
                    <DropdownMenu.Separator />
                    <DropdownMenu.RadioGroup
                        value={period}
                        onValueChange={(value) => onPeriodChange(value as DashboardPeriod)}
                    >
                        {PERIOD_OPTIONS.map((option) => (
                            <DropdownMenu.RadioItem
                                key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <Button
                className="styledbtn ml-auto"
                radius="large"
                onClick={onExport}
                disabled={exportDisabled}
            >
                <TrayArrowDownIcon size={16} weight="fill" />
                导出
            </Button>
        </div>
    );
}

import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import {
    CaretDownIcon,
    ClockCountdownIcon,
    FunnelIcon,
    TrayArrowDownIcon,
} from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";

type IconComponent = ComponentType<IconProps>;

interface FilterButtonConfig {
    label: string;
    Icon: IconComponent;
    alignRight?: boolean;
}

const FILTER_BUTTONS: FilterButtonConfig[] = [
    { label: "筛选", Icon: FunnelIcon },
    { label: "过去3天", Icon: ClockCountdownIcon },
    { label: "导出", Icon: TrayArrowDownIcon, alignRight: true },
];

export default function FilterBar() {
    return (
        <div className="flex flex-row px-2 pt-1.5 pb-3 gap-2.5">
            {FILTER_BUTTONS.map(({ label, Icon, alignRight }) => (
                <Button
                    key={label}
                    className="styledbtn"
                    style={alignRight ? { marginLeft: "auto" } : undefined}
                >
                    <Icon size={16} weight="fill" /> {label}{" "}
                    <CaretDownIcon size={16} weight="bold" />
                </Button>
            ))}
        </div>
    );
}

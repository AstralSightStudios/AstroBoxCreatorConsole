import type { Icon } from "@phosphor-icons/react";
import { PlusIcon } from "../svgs";

export interface NavItemProps {
    icon: Icon;
    label: string;
    onClick?: () => void;
    className?: string;
    isPlus?: boolean;
    disabled?: boolean;
    selected: boolean;
}

export default function NavItem({
    icon: IconComponent,
    label,
    onClick,
    className,
    isPlus,
    disabled,
    selected,
}: NavItemProps) {
    const isDisabled = Boolean(disabled);

    return (
        <div
            className={`flex flex-row corner-rounded self-stretch items-center ${selected ? "bg-nav-item-selected" : "bg-nav-item"} ${selected || isDisabled ? "" : "hover:bg-nav-item-hover"} ${isDisabled ? "opacity-45 cursor-not-allowed pointer-events-none" : ""} px-3 py-3.5 gap-2.5 rounded-[20px] ${className}`}
            onClick={isDisabled ? undefined : onClick}
            aria-disabled={isDisabled}
        >
            <IconComponent
                size={20}
                format="outline"
                weight={`${selected ? "fill" : "regular"}`}
            />
            <p
                className={`text-size-medium font-[450] select-none ${selected ? "" : "text-btn-text-unselected"}`}
            >
                {label}
            </p>
            {isPlus && <PlusIcon className="ml-auto"></PlusIcon>}
        </div>
    );
}

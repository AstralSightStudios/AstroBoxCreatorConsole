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
      className={`mt-1 flex min-h-10 flex-row items-center self-stretch gap-3 rounded-[12px] px-3 py-2.5 text-[14px] leading-5 transition-colors ${selected ? "bg-white/10 text-white" : "bg-transparent text-white/75 hover:bg-white/6 hover:text-white"} ${isDisabled ? "pointer-events-none cursor-not-allowed opacity-45" : ""} ${className ?? ""}`}
      onClick={isDisabled ? undefined : onClick}
      aria-disabled={isDisabled}
    >
      <IconComponent
        size={18}
        format="outline"
        weight="regular"
        className="shrink-0"
      />
      <p className="select-none w-full">{label}</p>
      {isPlus && <PlusIcon className="h-3 shrink-0" />}
    </div>
  );
}

import { DotsNineIcon } from "@phosphor-icons/react";
import { useNavVisibility } from "../../layout/nav-visibility-context";
import { CreatorConsoleLogoIcon } from "../svgs";

interface FunctionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export default function FunctionButton({
  className = "",
  "aria-label": ariaLabel,
  title,
  ...props
}: FunctionButtonProps) {
  const { isDesktop } = useNavVisibility();

  const mergedClassName = [
    "z-50 flex h-9 w-9 items-center justify-center gap-2.5 rounded-[14px] corner-rounded transition-all duration-150 ease-in-out hover:bg-white/8 active:scale-95 active:opacity-75",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (isDesktop) {
    return (
      <button
        type="button"
        className={mergedClassName}
        title={title ?? "CreatorConsole"}
        style={{ pointerEvents: "none" }}
      >
        <CreatorConsoleLogoIcon />
      </button>
    );
  }

  return (
    <button
      type="button"
      {...props}
      className={mergedClassName}
      aria-label={ariaLabel ?? "切换功能导航"}
      title={title ?? "切换功能导航"}
    >
      <DotsNineIcon className="fill-icon-primary" size={20} weight="bold" />
    </button>
  );
}

import { motion, type HTMLMotionProps } from "framer-motion";

interface IconButtonProps extends HTMLMotionProps<"button"> {
  children?: React.ReactNode;
  tint?: boolean;
}

function isTouchDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return (
    (navigator.maxTouchPoints ?? 0) > 0 ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches)
  );
}

export default function NavIconButton({
  children,
  className,
  tint,
  ...props
}: IconButtonProps) {
  const isTouch = isTouchDevice();

  const mergedClassName = [
    isTouch ? "size-[44px]" : "size-9",
    tint
      ? "bg-accent-9/30 hover:bg-accent-9/50"
      : "bg-[#47474a]/30 hover:bg-[#47474a]/50",
    "rounded-full cursor-pointer",
    "outline -outline-offset-1 outline-white/5",
    "overflow-visible",
    "disabled:opacity-50 disabled:pointer-events-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.button
      whileTap={{ scale: 1.1 }}
      type="button"
      className={mergedClassName}
      {...props}
    >
      <motion.div
        whileTap={{ scale: 0.9 }}
        className="flex items-center justify-center size-full rounded-full"
      >
        {children}
      </motion.div>
    </motion.button>
  );
}

export interface NavIconButtonGroupProps {
  children?: React.ReactNode;
  className?: string;
}

export function NavIconButtonGroup({
  children,
  className,
}: NavIconButtonGroupProps) {
  const isTouch = isTouchDevice();

  const mergedClassName = [
    isTouch ? "h-[44px]" : "h-9",
    "bg-[#47474a]/30 rounded-full cursor-pointer",
    "outline -outline-offset-1 outline-white/5",
    "overflow-hidden",
    "flex flex-row",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={mergedClassName}>{children}</div>;
}

import {
  createContext,
  useContext,
  type ComponentProps,
  type CSSProperties,
} from "react";

export type BubblePosition = "single" | "first" | "middle" | "last";

type BubbleVariant =
  | "default"
  | "secondary"
  | "muted"
  | "tinted"
  | "outline"
  | "ghost"
  | "destructive";

type BubbleContextValue = {
  align: "start" | "end";
  position: BubblePosition;
  showTail: boolean;
  tailColor: string;
};

type IMessageTypingIndicatorProps = {
  typing?: boolean;
  label?: string;
  className?: string;
};

const BubbleContext = createContext<BubbleContextValue | null>(null);

const bubbleVariantClasses: Record<BubbleVariant, string> = {
  default:
    "[&>[data-slot=bubble-content]]:bg-[#0b84ff] [&>[data-slot=bubble-content]]:text-white",
  secondary:
    "[&>[data-slot=bubble-content]]:bg-[#2c2c2e] [&>[data-slot=bubble-content]]:text-white/90",
  muted:
    "[&>[data-slot=bubble-content]]:bg-white/[0.05] [&>[data-slot=bubble-content]]:text-white/70",
  tinted:
    "[&>[data-slot=bubble-content]]:bg-blue-500/15 [&>[data-slot=bubble-content]]:text-white/90",
  outline:
    "[&>[data-slot=bubble-content]]:border-white/15 [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:text-white/90",
  ghost:
    "max-w-full [&>[data-slot=bubble-content]]:rounded-none [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0",
  destructive:
    "[&>[data-slot=bubble-content]]:bg-red-500/15 [&>[data-slot=bubble-content]]:text-red-200",
};

const bubbleTailColors: Record<BubbleVariant, string> = {
  default: "#0b84ff",
  secondary: "#2c2c2e",
  muted: "rgba(255, 255, 255, 0.05)",
  tinted: "rgba(59, 130, 246, 0.15)",
  outline: "transparent",
  ghost: "transparent",
  destructive: "rgba(239, 68, 68, 0.15)",
};

function groupedRadius(
  position: BubblePosition,
  align: "start" | "end",
) {
  const full = "18px";
  const tight = "5px";
  if (position === "single") return full;

  const spineTop = position === "first" ? full : tight;
  const spineBottom = position === "last" ? full : tight;
  return align === "end"
    ? `${full} ${spineTop} ${spineBottom} ${full}`
    : `${spineTop} ${full} ${full} ${spineBottom}`;
}

function Tail({
  align,
  color,
}: {
  align: "start" | "end";
  color: string;
}) {
  const flip = align === "start";

  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      className="pointer-events-none absolute bottom-0"
      style={{
        [flip ? "left" : "right"]: -10,
        transform: flip ? "scaleX(-1)" : undefined,
      }}
    >
      <path
        d="M0 5 C 0 13 5 19 17 20 C 12 17 10 12 10 5 Z"
        fill={color}
      />
    </svg>
  );
}

function Bubble({
  platform = "imessage",
  variant = "default",
  align = "start",
  position = "single",
  tailColor,
  className = "",
  ...props
}: ComponentProps<"div"> & {
  platform?: "imessage";
  variant?: BubbleVariant;
  align?: "start" | "end";
  position?: BubblePosition;
  tailColor?: string;
}) {
  const showTail =
    platform === "imessage" &&
    variant !== "ghost" &&
    (position === "single" || position === "last");

  return (
    <BubbleContext.Provider
      value={{
        align,
        position,
        showTail,
        tailColor: tailColor ?? bubbleTailColors[variant],
      }}
    >
      <div
        data-slot="bubble"
        data-platform={platform}
        data-variant={variant}
        data-align={align}
        data-position={position}
        className={`relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 ${
          align === "end" ? "self-end" : "self-start"
        } ${bubbleVariantClasses[variant]} ${className}`}
        {...props}
      />
    </BubbleContext.Provider>
  );
}

function BubbleContent({
  className = "",
  style,
  children,
  ...props
}: ComponentProps<"div">) {
  const bubble = useContext(BubbleContext);
  const contentStyle: CSSProperties = {
    borderRadius: bubble
      ? groupedRadius(bubble.position, bubble.align)
      : "18px",
    boxShadow: "0 1px 1px rgba(0, 0, 0, 0.12)",
    ...style,
  };

  return (
    <div
      data-slot="bubble-content"
      className={`relative w-fit max-w-full min-w-0 overflow-visible border border-transparent px-3 py-[7px] text-[14.5px] leading-[1.3] break-words ${className}`}
      style={contentStyle}
      {...props}
    >
      {children}
      {bubble?.showTail && (
        <Tail align={bubble.align} color={bubble.tailColor} />
      )}
    </div>
  );
}

function IMessageTypingIndicator({
  typing = false,
  label = "AI 正在生成回复",
  className = "",
}: IMessageTypingIndicatorProps) {
  if (!typing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex self-end ${className}`}
    >
      <span className="sr-only">{label}</span>
      <Bubble platform="imessage" align="end" variant="default">
        <BubbleContent
          aria-hidden="true"
          className="flex w-max! max-w-none! items-center gap-[5px] overflow-visible! px-[13px]! py-[13px]!"
        >
          <span className="s11a-imsg-dot relative z-10 block size-2 min-w-2 shrink-0 rounded-full bg-white/80" />
          <span className="s11a-imsg-dot relative z-10 block size-2 min-w-2 shrink-0 rounded-full bg-white/80" />
          <span className="s11a-imsg-dot relative z-10 block size-2 min-w-2 shrink-0 rounded-full bg-white/80" />
        </BubbleContent>
      </Bubble>
    </div>
  );
}

export { Bubble, BubbleContent, IMessageTypingIndicator };

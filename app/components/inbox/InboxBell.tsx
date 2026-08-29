import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useInboxUnreadCount } from "~/logic/inbox/store";

// 样式参考 ABNG 首页右上角信箱按钮（NavIconButton）：
// 圆形外圈 + 半透明背景 + backdrop-blur，按下缩放。
export default function InboxBell({ onClick }: { onClick: () => void }) {
  const count = useInboxUnreadCount();

  return (
    <button
      type="button"
      aria-label="信箱"
      onClick={onClick}
      className="relative inline-flex h-9 w-9 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 outline-none backdrop-blur-lg backdrop-saturate-150 transition-[transform,background-color,border-color] duration-200 ease-out hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.96]"
    >
      <EnvelopeSimpleIcon size={18} weight="regular" />
      {count > 0 ? (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white ring-2 ring-bg">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

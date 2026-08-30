import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useInboxUnreadCount } from "~/logic/inbox/store";

/**
 * 信箱铃铛按钮：圆形外圈 + 半透明背景 + backdrop-blur，按下缩放；
 * 有未读时在图标旁内联显示红底未读数胶囊。
 */
export default function InboxBell({ onClick }: { onClick: () => void }) {
  const count = useInboxUnreadCount();

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      type="button"
      aria-label="信箱"
      onClick={onClick}
      className={`tauri-no-drag relative inline-flex h-9 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 outline-none backdrop-blur-lg backdrop-saturate-150 transition-[transform,width,background-color,border-color] duration-200 ease-out hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.96] ${
        count > 0 ? "px-2" : "w-9"
      }`}
    >
      <span className="flex items-center justify-center gap-1.5">
        <EnvelopeSimpleIcon size={18} weight="regular" />
        {count > 0 ? (
          <span className="pointer-events-none min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

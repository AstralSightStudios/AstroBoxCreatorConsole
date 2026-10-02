import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
} from "framer-motion";
import { XIcon } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import DynamicDrawerHandle from "~/components/inbox/DynamicDrawerHandle";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import Settings, { type SettingsSectionId } from "~/routes/settings";

/** 欢迎页的设置抽屉只保留通用设置，账号 / AI 私信 / UI 比例 / 导航在这里隐藏。 */
const HIDDEN_SECTIONS: SettingsSectionId[] = [
  "accounts",
  "aiAutoReply",
  "uiScale",
  "navigation",
];

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 设置抽屉。形态照搬信箱：底部 sheet 上滑，全平台一致；
 * 与信箱不同之处是桌面端也贴底，并限制最大宽度 600px。
 */
export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { factor, logicalHeight, portalContainer } = useUiScaleViewport();
  const sheetY = useMotionValue(0);
  const [dragProgress, setDragProgress] = useState(0);
  const dragStateRef = useRef<{ startY: number; baseY: number } | null>(null);

  const handleDragMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = (event.clientY - drag.startY) / factor;
      sheetY.set(Math.max(0, drag.baseY + delta));
      setDragProgress(Math.min(1, Math.max(0, delta / 240)));
    },
    [factor, sheetY],
  );

  const handleDragEnd = useCallback(
    (event: PointerEvent) => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      const drag = dragStateRef.current;
      dragStateRef.current = null;
      setDragProgress(0);
      if (!drag) return;
      const delta = (event.clientY - drag.startY) / factor;
      if (delta > 110) {
        // 先让 sheet 跟手滑出屏幕，再触发关闭动画，避免突兀跳走。
        void animate(sheetY, logicalHeight || 800, {
          type: "tween",
          duration: 0.18,
          ease: "easeIn",
          onComplete: () => onClose(),
        });
        return;
      }
      void animate(sheetY, 0, { type: "spring", stiffness: 320, damping: 32 });
    },
    [factor, handleDragMove, logicalHeight, onClose, sheetY],
  );

  const handleDragStart = useCallback(
    (event: React.PointerEvent) => {
      dragStateRef.current = { startY: event.clientY, baseY: sheetY.get() };
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", handleDragEnd);
    },
    [handleDragEnd, handleDragMove, sheetY],
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
    },
    [handleDragEnd, handleDragMove],
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      sheetY.set(0);
      setDragProgress(0);
    }
  }, [open, sheetY]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-[110] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {portalContainer
            ? createPortal(
                <motion.div
                  className="fixed inset-x-0 top-0 z-[120] flex w-full justify-center"
                  style={{
                    height: "var(--ui-viewport-height)",
                    paddingTop: "max(100px, calc(var(--ui-safe-area-top) + 56px))",
                    pointerEvents: "none",
                  }}
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    type: "tween",
                    duration: 0.28,
                    ease: [0.32, 0.72, 0, 1],
                  }}
                >
                  {/* 浮层面板底：信箱同款透明度 + 背景模糊 */}
                  <motion.div
                    style={{ y: sheetY, pointerEvents: "auto" }}
                    className="relative flex h-full w-full max-w-[600px] flex-col overflow-hidden rounded-t-[28px] border-t-[1.5px] border-[var(--nav-border-strong)] bg-[rgba(0,0,0,0.75)] pt-2.5 text-[color:var(--text-color)] backdrop-blur-md"
                  >
                    <button
                      type="button"
                      aria-label="收起设置"
                      onPointerDown={handleDragStart}
                      style={{ touchAction: "none" }}
                      className="tauri-no-drag mx-auto flex h-[15px] w-16 shrink-0 items-center justify-center bg-transparent text-[color:var(--floating-panel-handle-bg)]"
                    >
                      <DynamicDrawerHandle progress={dragProgress} direction="down" />
                    </button>
                    <header className="flex items-center justify-between gap-3 px-5.5 pt-1.5">
                      <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
                        设置
                      </h1>
                      <button
                        type="button"
                        aria-label="关闭设置"
                        onClick={onClose}
                        className="flex size-8 items-center justify-center rounded-full text-[color:var(--text-color)] opacity-60 transition hover:bg-[var(--nav-btn-bg)] hover:opacity-100"
                      >
                        <XIcon size={18} />
                      </button>
                    </header>
                    <div className="relative z-1 mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.875rem,var(--ui-safe-area-bottom))]">
                      <Settings hideSections={HIDDEN_SECTIONS} />
                    </div>
                  </motion.div>
                </motion.div>,
                portalContainer,
              )
            : null}
        </>
      ) : null}
    </AnimatePresence>
  );
}

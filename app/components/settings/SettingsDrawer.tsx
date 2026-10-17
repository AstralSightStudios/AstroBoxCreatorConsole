import { XIcon } from "@phosphor-icons/react";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
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
 * 设置抽屉。外壳走通用 `FloatingDrawer`（全平台贴底 sheet，最大宽度 600px）。
 */
export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="设置"
      handleLabel="收起设置"
      maxWidth={600}
    >
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
      <div
        data-vaul-no-drag
        className="relative z-1 mt-1 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[max(0.875rem,var(--ui-safe-area-bottom))]"
      >
        <Settings hideSections={HIDDEN_SECTIONS} />
      </div>
    </FloatingDrawer>
  );
}

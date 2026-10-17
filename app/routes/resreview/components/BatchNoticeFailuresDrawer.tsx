import { ArrowsClockwise, WarningCircle, XIcon } from "@phosphor-icons/react";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
import { Button } from "~/components/ScaleAwareThemes";
import type { CcNoticeFailure } from "~/logic/inbox/batch-failures";

interface BatchNoticeFailuresDrawerProps {
  open: boolean;
  onClose: () => void;
  failures: CcNoticeFailure[];
  /** 正在重试的 PR 号集合，用于禁用对应项按钮。 */
  retryingNumbers: Set<number>;
  onRetry: (item: CcNoticeFailure) => void;
  onIgnore: (item: CcNoticeFailure) => void;
  onIgnoreAll: () => void;
}

/**
 * 批量关闭失败通知抽屉：列出批量关闭时 AstroBox 信箱通知没发出去的 PR，
 * 支持逐条重试/忽略，或一键全部忽略。作者未绑定账号（根本没有收件人）的
 * 情况不算失败，不会进入这里。
 */
export default function BatchNoticeFailuresDrawer({
  open,
  onClose,
  failures,
  retryingNumbers,
  onRetry,
  onIgnore,
  onIgnoreAll,
}: BatchNoticeFailuresDrawerProps) {
  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="未发送的关闭通知"
      description="批量关闭时 AstroBox 信箱通知发送失败的 PR"
      handleLabel="收起未发送通知"
      maxWidth={600}
    >
      <header className="flex items-center justify-between gap-3 px-5.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
            未发送的关闭通知
          </h1>
          <p className="mt-1 truncate text-[12px] text-white/50">
            共 {failures.length} 条发送失败
          </p>
        </div>
        {failures.length > 1 && (
          <Button size="1" variant="soft" color="gray" onClick={onIgnoreAll}>
            全部忽略
          </Button>
        )}
        <button
          type="button"
          aria-label="关闭未发送通知"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--text-color)] opacity-60 transition hover:bg-[var(--nav-btn-bg)] hover:opacity-100"
        >
          <XIcon size={18} />
        </button>
      </header>

      <div
        data-vaul-no-drag
        className="mt-2 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-[max(0.875rem,var(--ui-safe-area-bottom))]"
      >
        {failures.length === 0 ? (
          <div className="py-16 text-center text-sm text-white/45">
            没有未发送的通知
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {failures.map((item) => {
              const retrying = retryingNumbers.has(item.prNumber);
              return (
                <div
                  key={`${item.subtype}:${item.prNumber}`}
                  className="rounded-[14px] border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <WarningCircle
                      size={18}
                      weight="duotone"
                      className="mt-0.5 shrink-0 text-amber-300/80"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        #{item.prNumber} {item.title}
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        {item.error || "AstroBox 信箱通知发送失败，可重试补发。"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex justify-end gap-2">
                    <Button
                      size="1"
                      variant="soft"
                      color="gray"
                      disabled={retrying}
                      onClick={() => onIgnore(item)}
                    >
                      忽略
                    </Button>
                    <Button
                      size="1"
                      color="blue"
                      disabled={retrying}
                      onClick={() => onRetry(item)}
                    >
                      {retrying ? "重试中..." : "重试"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FloatingDrawer>
  );
}

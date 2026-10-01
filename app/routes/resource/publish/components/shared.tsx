import { Button } from "@radix-ui/themes";
import { Dialog } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import {
    ArrowSquareOutIcon,
    QuestionIcon,
    UploadSimpleIcon,
    XCircleIcon,
} from "@phosphor-icons/react";

export function SectionCard({
  title,
  description,
  children,
  className,
  padding = true,
  headerExtra,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
  headerExtra?: React.ReactNode;
}) {
  return (
    <div
      className={`min-w-0 rounded-[14px] border border-white/10 bg-nav-item w-full ${className}`}
    >
      <div className={`flex min-w-0 flex-col gap-2.5 ${padding ? "p-2" : ""} w-full`}>
        <div
          className={`flex min-w-0 flex-col px-3.5 pt-3.5 ${padding ? "-mx-2 -mt-2 w-[calc(100%+16px)]" : "w-full"}`}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 text-[18px] font-medium text-white">{title}</p>
            {headerExtra}
          </div>
          {description && (
            <p className="text-sm text-white/70">{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1.5 pt-1.5">
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-white/60">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export interface FieldHelpLink {
    label: string;
    href: string;
}

export interface FieldHelpItem {
    label: string;
    description: string;
    links?: FieldHelpLink[];
}

/** 卡片头部的字段说明圆钮，配合 FieldHelpDialog 使用。 */
export function FieldHelpButton({
    onClick,
    title,
}: {
    onClick: () => void;
    title: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={title}
            title={title}
            className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/60 transition hover:bg-white/10 hover:text-white"
        >
            <QuestionIcon size={14} weight="bold" />
        </button>
    );
}

/** Tauri 下走系统浏览器打开，纯浏览器环境退回 window.open。 */
function openExternalUrl(href: string) {
    void import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(href))
        .catch(() => window.open(href, "_blank", "noopener,noreferrer"));
}

export function FieldHelpDialog({
    open,
    onOpenChange,
    title,
    items,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    items: FieldHelpItem[];
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content maxWidth="520px">
                <Dialog.Title>{title}</Dialog.Title>
                <ScrollArea className="mt-3 max-h-[var(--ui-viewport-height-56pct)]">
                    <div className="flex flex-col gap-3 pr-1">
                        {items.map((item) => (
                            <div
                                key={item.label}
                                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
                            >
                                <div className="text-sm font-medium text-white/80">
                                    {item.label}
                                </div>
                                <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">
                                    {item.description}
                                </div>
                                {item.links && item.links.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                        {item.links.map((link) => (
                                            <button
                                                key={link.href}
                                                type="button"
                                                onClick={() =>
                                                    openExternalUrl(link.href)
                                                }
                                                className="inline-flex items-center gap-1 text-[13px] text-sky-300 underline underline-offset-2 transition hover:text-sky-200"
                                            >
                                                <ArrowSquareOutIcon
                                                    size={12}
                                                    weight="bold"
                                                />
                                                {link.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <div className="mt-4 flex justify-end">
                    <Dialog.Close>
                        <Button variant="soft" color="gray">
                            关闭
                        </Button>
                    </Dialog.Close>
                </div>
            </Dialog.Content>
        </Dialog.Root>
    );
}

export interface UploadItem {
  id: string;
  name: string;
  url: string;
  file: File;
  pathOverride?: string;
  skipUpload?: boolean;
  source?: "upload" | "existing";
  width?: number;
  height?: number;
  processing?: boolean;
  progress?: number;
}

export function UploadSlot({
  label,
  description,
  media,
  onPick,
  onRemove,
  compact,
  showRatio,
  recommendedMaxSize,
  onDimensions,
}: {
  label: string;
  description?: string;
  media: UploadItem | null;
  onPick: () => void;
  onRemove: () => void;
  compact?: boolean;
  showRatio?: boolean;
  recommendedMaxSize?: number;
  onDimensions?: (width: number, height: number) => void;
}) {
  const ratio = media?.width && media.height ? media.width / media.height : null;
  const ratioWarning = showRatio && ratio !== null && Math.abs(ratio - 1.5) > 0.02;
  const sizeWarning = Boolean(
    recommendedMaxSize &&
      media?.width &&
      media.height &&
      (media.width > recommendedMaxSize || media.height > recommendedMaxSize),
  );
  const warning = ratioWarning || sizeWarning;
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg ${compact ? "" : "border bg-white/5 p-1 h-full"} ${warning ? "border-red-400/70" : compact ? "" : "border-white/10"}`}
    >
      <div className="flex items-center gap-2 pt-1.5 px-2 pb-1">
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-white/60">{description}</p>}
      </div>
      {media ? (
        <div className="flex items-center gap-3  bg-black/30 p-2 rounded-md">
          <div
            className={`h-12 w-12 overflow-hidden ${compact ? "rounded-sm" : "rounded-lg"} border border-white/10 bg-white/5`}
          >
            <img
              src={media.url}
              alt={media.name}
              className="h-full w-full object-cover"
              onLoad={(event) => {
                const image = event.currentTarget;
                if ((!media.width || !media.height) && image.naturalWidth && image.naturalHeight) {
                  onDimensions?.(image.naturalWidth, image.naturalHeight);
                }
              }}
            />
          </div>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-white">{media.name}</span>
            <span className={`text-xs ${warning ? "text-red-400" : "text-white/60"}`}>
              {sizeWarning
                ? `建议不超过 ${recommendedMaxSize}×${recommendedMaxSize}，当前 ${media.width}×${media.height}；不影响提交`
                : ratio !== null
                  ? ratioWarning
                    ? `必须 3:2（1.5），当前 ${ratio.toFixed(2)}；不满足将无法提交`
                    : `${media.width}×${media.height} · 比例 ${ratio.toFixed(2)}`
                  : "已就绪"}
            </span>
          </div>
          <button
            className="text-white/60 transition hover:text-red-400"
            onClick={onRemove}
          >
            <XCircleIcon size={18} weight="fill" />
          </button>
        </div>
      ) : (
        <div
          className="flex flex-col items-start gap-1 rounded-sm border border-dashed border-white/10 bg-black/20 px-3 py-3 text-sm text-white/70"
          onClick={onPick}
        >
          <p className="flex items-center gap-1">
            <UploadSimpleIcon size={16} />
            上传图片文件
          </p>
          <p className="text-xs text-white/50">支持上传 PNG/JPG/WebP 文件</p>
        </div>
      )}
    </div>
  );
}

export function StepList({
  steps,
  activeIndex,
  onSelect,
}: {
  steps: Array<{ label: string; status: "active" | "pending" | "done" }>;
  activeIndex: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <div className="flex flex-col flex-wrap gap-0.5 select-none">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const base =
          step.status === "done"
            ? "text-emerald-300 hover:bg-emerald-500/10"
            : step.status === "active" || isActive
              ? "hover:bg-white/10 text-white"
              : "hover:bg-white/5 text-white/70";
        const dot =
          step.status === "done"
            ? "w-1.5 bg-emerald-500!"
            : step.status === "active" || isActive
              ? "w-2.5 bg-white/70!"
              : "w-0.5 bg-white/20!";
        return (
          <button
            key={step.label}
            className={`flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-sm transition hover:border-white/40 ${base}`}
            onClick={() => onSelect?.(index)}
            type="button"
          >
            <span className="text-sm lining-nums opacity-70">0{index + 1}</span>
            <span className="w-3 h-1">
              <span
                className={`${dot} transition-all mt-px h-0.5 block m-auto rounded-full shrink-0 bg-white/60`}
              />
            </span>
            <span className="shrink-0">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

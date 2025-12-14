import { Button } from "@radix-ui/themes";
import { UploadSimpleIcon, XCircleIcon } from "@phosphor-icons/react";

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-white/10 bg-nav-item shadow-[0_18px_36px_rgba(0,0,0,0.32)] w-full">
      <div className="flex flex-col gap-2.5 p-2 w-full">
        <div className="flex flex-col px-1.5 pt-1.5 w-full">
          <p className="text-[15px] font-semibold text-white">{title}</p>
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

export interface UploadItem {
  id: string;
  name: string;
  url: string;
  file: File;
  pathOverride?: string;
  skipUpload?: boolean;
  source?: "upload" | "existing";
}

export function UploadSlot({
  label,
  description,
  media,
  onPick,
  onRemove,
  compact,
}: {
  label: string;
  description?: string;
  media: UploadItem | null;
  onPick: () => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg ${compact ? "" : "border border-white/10 bg-white/5 p-1 h-full"}`}
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
            />
          </div>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-white">{media.name}</span>
            <span className="text-xs text-white/60">已就绪</span>
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
    <div className="flex flex-col flex-wrap gap-0.5">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const base =
          step.status === "done"
            ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
            : step.status === "active" || isActive
              ? "hover:bg-white/10 text-white"
              : "hover:bg-white/5 text-white/70";
        return (
          <button
            key={step.label}
            className={`flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-sm transition hover:border-white/40 ${base}`}
            onClick={() => onSelect?.(index)}
            type="button"
          >
            <span className="text-[14px] lining-nums opacity-70">
              0{index + 1}
            </span>
            <span className="w-3 h-1">
              <span
                className={`transition-all mt-[1px] h-0.5 ${isActive ? "w-2.5" : "w-0.5"} block m-auto rounded-full shrink-0 bg-white/60 ${isActive ? "bg-white/70" : "bg-white/20"}`}
              />
            </span>
            <span className="shrink-0">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

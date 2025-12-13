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
        <div className="rounded-2xl border border-white/10 bg-nav-item shadow-[0_18px_36px_rgba(0,0,0,0.32)]">
            <div className="flex flex-col gap-3 p-4 sm:p-5">
                <div>
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
            <div className="flex items-center gap-2">
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
            className={`flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 ${compact ? "" : "h-full"}`}
        >
            <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">{label}</p>
                {description && <p className="text-xs text-white/60">{description}</p>}
                <Button className="ml-auto styledbtn" onClick={onPick}>
                    <UploadSimpleIcon size={16} /> 选择文件
                </Button>
            </div>
            {media ? (
                <div className="flex items-center gap-3 rounded-lg bg-black/30 p-2">
                    <div className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                        <img
                            src={media.url}
                            alt={media.name}
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium text-white">
                            {media.name}
                        </span>
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
                <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-white/10 bg-black/20 px-3 py-3 text-sm text-white/70">
                    <p>尚未选择文件</p>
                    <p className="text-xs text-white/50">
                        点击“选择文件”上传，支持 PNG/JPG/WebP
                    </p>
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
        <div className="flex flex-wrap gap-2">
            {steps.map((step, index) => {
                const isActive = index === activeIndex;
                const base =
                    step.status === "done"
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                        : step.status === "active" || isActive
                          ? "border-white/25 bg-white/10 text-white"
                          : "border-white/10 bg-white/5 text-white/70";
                return (
                    <button
                        key={step.label}
                        className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition hover:border-white/40 ${base}`}
                        onClick={() => onSelect?.(index)}
                        type="button"
                    >
                        <span className="text-xs opacity-70">Step {index + 1}</span>
                        <span>{step.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

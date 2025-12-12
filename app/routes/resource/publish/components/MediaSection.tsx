import {
    ArrowLineDownIcon,
    ImagesSquareIcon,
    UploadSimpleIcon,
    XCircleIcon,
} from "@phosphor-icons/react";
import { Badge, Button, Switch } from "@radix-ui/themes";
import { useRef } from "react";
import type { UploadItem } from "./shared";
import { SectionCard, UploadSlot } from "./shared";

interface MediaSectionProps {
    previews: UploadItem[];
    icon: UploadItem | null;
    cover: UploadItem | null;
    usePreviewAsCover: boolean;
    coverPreviewId: string | null;
    onPreviewUpload: (files: FileList | null) => void;
    onRemovePreview: (id: string) => void;
    onIconUpload: (files: FileList | null) => void;
    onCoverUpload: (files: FileList | null) => void;
    onSelectCoverPreview: (id: string) => void;
    onToggleUsePreviewAsCover: (checked: boolean) => void;
    onRemoveIcon: () => void;
    onRemoveCover: () => void;
}

export function MediaSection({
    previews,
    icon,
    cover,
    usePreviewAsCover,
    coverPreviewId,
    onPreviewUpload,
    onRemovePreview,
    onIconUpload,
    onCoverUpload,
    onSelectCoverPreview,
    onToggleUsePreviewAsCover,
    onRemoveIcon,
    onRemoveCover,
}: MediaSectionProps) {
    const previewInputRef = useRef<HTMLInputElement>(null);
    const iconInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);

    return (
        <SectionCard
            title="媒体素材"
            description="上传或导入预览图组、应用图标与封面。封面可以直接选择已有的预览图。"
        >
            <input
                ref={previewInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => {
                    onPreviewUpload(e.target.files);
                    e.target.value = "";
                }}
            />
            <input
                ref={iconInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => {
                    onIconUpload(e.target.files);
                    e.target.value = "";
                }}
            />
            <input
                ref={coverInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => {
                    onCoverUpload(e.target.files);
                    e.target.value = "";
                }}
            />

            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white">预览图组</p>
                    <Badge color="gray" variant="soft">
                        支持拖拽/多选
                    </Badge>
                    <Button
                        className="ml-auto styledbtn"
                        onClick={() => previewInputRef.current?.click()}
                    >
                        <UploadSimpleIcon size={16} /> 添加预览图
                    </Button>
                </div>
                {previews.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-sm text-white/60">
                        <ImagesSquareIcon size={28} weight="duotone" />
                        <p>尚未上传预览图，点击上方按钮选择文件</p>
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-3">
                        {previews.map((item) => {
                            const isCover =
                                usePreviewAsCover &&
                                (coverPreviewId
                                    ? coverPreviewId === item.id
                                    : previews[0]?.id === item.id);
                            return (
                                <div
                                    key={item.id}
                                    className={`group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-white/25 ${isCover ? "ring-2 ring-emerald-400/70" : ""}`}
                                >
                                    <img
                                        src={item.url}
                                        alt={item.name}
                                        className="h-40 w-full object-cover"
                                    />
                                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                                        <span className="truncate">{item.name}</span>
                                        <button
                                            className="ml-auto text-white/60 transition hover:text-white"
                                            onClick={() => {
                                                if (usePreviewAsCover) {
                                                    onSelectCoverPreview(item.id);
                                                }
                                            }}
                                        >
                                            <ArrowLineDownIcon size={16} />
                                        </button>
                                        <button
                                            className="text-white/60 transition hover:text-red-400"
                                            onClick={() => onRemovePreview(item.id)}
                                            aria-label="移除预览图"
                                        >
                                            <XCircleIcon size={16} weight="fill" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                    <UploadSlot
                        label="图标"
                        description="建议 1:1，PNG 或 WebP"
                        media={icon}
                        onPick={() => iconInputRef.current?.click()}
                        onRemove={onRemoveIcon}
                    />
                    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-white">封面</p>
                            <Badge color="grass" variant="soft">
                                可复用预览
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={usePreviewAsCover}
                                    onCheckedChange={(checked) =>
                                        onToggleUsePreviewAsCover(Boolean(checked))
                                    }
                                />
                                <p className="text-sm text-white/80">使用预览图作为封面</p>
                            </div>
                            {!usePreviewAsCover && (
                                <Button
                                    className="styledbtn"
                                    onClick={() => coverInputRef.current?.click()}
                                >
                                    <UploadSimpleIcon size={16} /> 选择封面
                                </Button>
                            )}
                        </div>
                        {usePreviewAsCover ? (
                            <div className="flex flex-wrap gap-2">
                                {previews.length === 0 ? (
                                    <p className="text-sm text-white/60">
                                        请先上传预览图以便选作封面
                                    </p>
                                ) : (
                                    previews.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => onSelectCoverPreview(item.id)}
                                            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                                                coverPreviewId === item.id
                                                    ? "border-emerald-400/70 bg-emerald-400/10 text-white"
                                                    : "border-white/15 bg-white/5 text-white/80 hover:border-white/30"
                                            }`}
                                        >
                                            <ImagesSquareIcon size={14} />
                                            {item.name}
                                        </button>
                                    ))
                                )}
                            </div>
                        ) : (
                            <UploadSlot
                                compact
                                label="单独上传封面"
                                description="建议 3:2，PNG/JPG"
                                media={cover}
                                onPick={() => coverInputRef.current?.click()}
                                onRemove={onRemoveCover}
                            />
                        )}
                    </div>
                </div>
            </div>
        </SectionCard>
    );
}

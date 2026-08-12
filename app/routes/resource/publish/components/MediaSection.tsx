import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DotsSixVerticalIcon,
  ImagesSquareIcon,
  InfoIcon,
  UploadSimpleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Badge, Button } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import type { UploadItem } from "./shared";
import { SectionCard } from "./shared";

interface MediaSectionProps {
  previews: UploadItem[];
  icon: UploadItem | null;
  iconUploading?: boolean;
  cover: UploadItem | null;
  onPreviewUpload: (files: FileList | null) => void;
  onRemovePreview: (id: string) => void;
  onReorderPreview: (fromId: string, toId: string) => void;
  onIconUpload: (files: FileList | null) => void;
  onCoverUpload: (files: FileList | null) => void;
  onRemoveIcon: () => void;
  onRemoveCover: () => void;
  onMediaDimensions: (
    kind: "preview" | "icon" | "cover",
    id: string,
    width: number,
    height: number,
  ) => void;
}

function formatFileSize(size?: number): string {
  if (size == null || !Number.isFinite(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function MediaTile({
  label,
  hint,
  media,
  uploading,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  media: UploadItem | null;
  uploading?: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-xs text-white/55">{hint}</p>
        </div>
        {media && (
          <button
            type="button"
            className="rounded-full p-1 text-white/55 transition hover:bg-red-500/15 hover:text-red-300"
            onClick={onRemove}
            aria-label={`移除${label}`}
          >
            <XIcon size={16} weight="bold" />
          </button>
        )}
      </div>

      {uploading ? (
        <div className="flex h-36 flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-black/25 text-sm text-white/70">
          <p>正在压缩图标...</p>
          <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-400" />
          </div>
        </div>
      ) : media ? (
        <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/25">
          <img
            src={media.url}
            alt={media.name}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85"
          onClick={onPick}
        >
          <UploadSimpleIcon size={24} weight="duotone" />
          选择文件
        </button>
      )}
    </div>
  );
}

export function MediaSection({
  previews,
  icon,
  iconUploading,
  cover,
  onPreviewUpload,
  onRemovePreview,
  onReorderPreview,
  onIconUpload,
  onCoverUpload,
  onRemoveIcon,
  onRemoveCover,
  onMediaDimensions,
}: MediaSectionProps) {
  const previewInputRef = useRef<HTMLInputElement>(null);
  const draggedPreviewIdRef = useRef<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const lightboxItem =
    lightboxIndex != null ? previews[lightboxIndex] ?? null : null;

  useEffect(() => {
    if (lightboxIndex == null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxIndex(null);
        setShowInfo(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex]);

  return (
    <SectionCard
      title="媒体素材"
      description="上传或导入预览图组、应用图标与封面。相同文件会自动复用，无需重复上传。"
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

      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <MediaTile
            label="图标"
            hint="必须 1:1，建议不超过 500×500"
            media={icon}
            uploading={iconUploading}
            onPick={() => iconInputRef.current?.click()}
            onRemove={onRemoveIcon}
          />
          <MediaTile
            label="封面"
            hint="必须 3:2，不超过 1MB，PNG/JPG"
            media={cover}
            onPick={() => coverInputRef.current?.click()}
            onRemove={onRemoveCover}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">预览图</p>
              <Badge color="gray" variant="soft">
                支持多选
              </Badge>
              {previews.length > 0 && (
                <span className="text-xs text-white/45">共 {previews.length} 张</span>
              )}
            </div>
            <Button
              type="button"
              variant="soft"
              onClick={() => previewInputRef.current?.click()}
            >
              <UploadSimpleIcon size={15} weight="bold" />
              添加预览图
            </Button>
          </div>

          {previews.length === 0 ? (
            <button
              type="button"
              className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85"
              onClick={() => previewInputRef.current?.click()}
            >
              <ImagesSquareIcon size={28} weight="duotone" />
              尚未上传预览图，点击选择文件
            </button>
          ) : (
            <div className="scrollbar-none flex flex-nowrap gap-2 overflow-x-auto pb-1">
              {previews.map((item, index) => (
                <div
                  key={item.id}
                  className="group relative w-[260px] shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromId =
                      draggedPreviewIdRef.current ||
                      event.dataTransfer.getData("text/plain");
                    if (fromId && fromId !== item.id) {
                      onReorderPreview(fromId, item.id);
                    }
                    draggedPreviewIdRef.current = null;
                  }}
                >
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded-lg border border-white/10 bg-black/25"
                    onClick={() => {
                      setShowInfo(false);
                      setLightboxIndex(index);
                    }}
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      className="h-44 w-full object-cover"
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (
                          (!item.width || !item.height) &&
                          image.naturalWidth &&
                          image.naturalHeight
                        ) {
                          onMediaDimensions(
                            "preview",
                            item.id,
                            image.naturalWidth,
                            image.naturalHeight,
                          );
                        }
                      }}
                    />
                  </button>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      draggable
                      className="cursor-grab rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-white active:cursor-grabbing"
                      onDragStart={(event) => {
                        draggedPreviewIdRef.current = item.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        draggedPreviewIdRef.current = null;
                      }}
                      aria-label="拖拽排序"
                    >
                      <DotsSixVerticalIcon size={15} weight="bold" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs text-white/70">
                      {item.name}
                    </span>
                    <button
                      type="button"
                      disabled={index === 0}
                      className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
                      onClick={() => onReorderPreview(item.id, previews[index - 1].id)}
                      aria-label="前移"
                    >
                      <ArrowLeftIcon size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === previews.length - 1}
                      className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
                      onClick={() => onReorderPreview(item.id, previews[index + 1].id)}
                      aria-label="后移"
                    >
                      <ArrowRightIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-white/50 transition hover:bg-red-500/15 hover:text-red-300"
                      onClick={() => onRemovePreview(item.id)}
                      aria-label="移除预览图"
                    >
                      <XCircleIcon size={15} weight="fill" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="flex min-h-[180px] w-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85"
                onClick={() => previewInputRef.current?.click()}
              >
                <UploadSimpleIcon size={24} weight="duotone" />
                添加预览图
              </button>
            </div>
          )}
        </div>
      </div>

      {lightboxIndex != null && lightboxItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <button
              type="button"
              className="grid size-10 place-items-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 hover:text-white"
              onClick={() => setShowInfo((prev) => !prev)}
              aria-label="查看图片信息"
            >
              <InfoIcon size={18} weight="bold" />
            </button>
            <button
              type="button"
              className="grid size-10 place-items-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 hover:text-white"
              onClick={() => {
                setLightboxIndex(null);
                setShowInfo(false);
              }}
              aria-label="关闭"
            >
              <XIcon size={18} weight="bold" />
            </button>
          </div>

          <img
            src={lightboxItem.url}
            alt={lightboxItem.name}
            className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded-xl object-contain"
          />

          {showInfo && (
            <div className="absolute right-0 top-0 flex h-full w-[min(88vw,360px)] flex-col border-l border-white/15 bg-[#111] p-5 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">图片信息</h2>
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                  onClick={() => setShowInfo(false)}
                  aria-label="关闭信息"
                >
                  <XIcon size={17} />
                </button>
              </div>
              <div className="mt-5 flex flex-col gap-3 text-sm text-white/75">
                <div className="break-all">
                  <div className="text-xs text-white/45">文件名</div>
                  <div>{lightboxItem.name}</div>
                </div>
                <div>
                  <div className="text-xs text-white/45">分辨率</div>
                  <div>
                    {lightboxItem.width && lightboxItem.height
                      ? `${lightboxItem.width} × ${lightboxItem.height}`
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/45">体积</div>
                  <div>{formatFileSize(lightboxItem.file.size)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ImagesSquareIcon,
  UploadSimpleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Badge } from "@radix-ui/themes";
import { useRef } from "react";
import type { UploadItem } from "./shared";
import { SectionCard, UploadSlot } from "./shared";

interface MediaSectionProps {
  previews: UploadItem[];
  icon: UploadItem | null;
  cover: UploadItem | null;
  onPreviewUpload: (files: FileList | null) => void;
  onRemovePreview: (id: string) => void;
  onReorderPreview: (fromId: string, toId: string) => void;
  onIconUpload: (files: FileList | null) => void;
  onCoverUpload: (files: FileList | null) => void;
  onRemoveIcon: () => void;
  onRemoveCover: () => void;
  onMediaDimensions: (kind: "preview" | "icon" | "cover", id: string, width: number, height: number) => void;
}

export function MediaSection({
  previews,
  icon,
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 px-1.5 pt-1.5">
          <p className="text-sm font-medium text-white">预览图组</p>
          <Badge color="gray" variant="soft">
            支持拖拽/多选
          </Badge>
        </div>
        {previews.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-6 text-sm text-white/60 mb-1.5"
            onClick={() => previewInputRef.current?.click()}
          >
            <ImagesSquareIcon size={28} weight="duotone" />
            <p>尚未上传预览图，点击以选择文件并上传</p>
          </div>
        ) : (
          <div className="grid gap-1.5 md:grid-cols-3 pb-1.5">
            {previews.map((item, index) => {
              return (
                <div
                  key={item.id}
                  draggable
                  className="group relative overflow-hidden rounded-lg border border-white/10 bg-white/5 transition cursor-grab active:cursor-grabbing hover:border-white/25"
                  onDragStart={(event) => {
                    draggedPreviewIdRef.current = item.id;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => {
                    draggedPreviewIdRef.current = null;
                  }}
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
                  <img
                    src={item.url}
                    alt={item.name}
                     className="h-40 w-full object-cover pointer-events-none"
                     onLoad={(event) => {
                       const image = event.currentTarget;
                       if ((!item.width || !item.height) && image.naturalWidth && image.naturalHeight) {
                         onMediaDimensions("preview", item.id, image.naturalWidth, image.naturalHeight);
                       }
                     }}
                   />
                   <div className="flex items-center gap-2 px-3 py-2 text-sm">
                     <span className="truncate">
                       {item.name}
                     </span>
                    <button
                      type="button"
                      disabled={index === 0}
                      className="ml-auto text-white/60 transition hover:text-white disabled:opacity-25"
                      onClick={() => onReorderPreview(item.id, previews[index - 1].id)}
                      aria-label="预览图前移"
                    >
                      <ArrowLeftIcon size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={index === previews.length - 1}
                      className="text-white/60 transition hover:text-white disabled:opacity-25"
                      onClick={() => onReorderPreview(item.id, previews[index + 1].id)}
                      aria-label="预览图后移"
                    >
                      <ArrowRightIcon size={16} />
                    </button>
                    <button
                      type="button"
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
            <div
              className={`group relative overflow-hidden rounded-lg border border-white/10 bg-white/5 transition hover:border-white/25 p-3 pb-2.5 flex flex-col items-start justify-between`}
              onClick={() => previewInputRef.current?.click()}
            >
              <UploadSimpleIcon size={16} />
              <span className="truncate text-sm">添加预览图</span>
            </div>
          </div>
        )}

        <div className="gap-3 flex flex-col">
          <UploadSlot
            label="图标"
            description="必须 1:1，建议不超过 500×500"
            media={icon}
            onPick={() => iconInputRef.current?.click()}
            onRemove={onRemoveIcon}
            recommendedMaxSize={500}
            onDimensions={(width, height) => icon && onMediaDimensions("icon", icon.id, width, height)}
          />
          <UploadSlot
            label="封面"
            description="必须 3:2，不超过 1MB，PNG/JPG"
            media={cover}
            onPick={() => coverInputRef.current?.click()}
            onRemove={onRemoveCover}
            showRatio
            onDimensions={(width, height) => cover && onMediaDimensions("cover", cover.id, width, height)}
          />
        </div>
      </div>
    </SectionCard>
  );
}

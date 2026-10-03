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
import { pickFiles } from "~/logic/publish/file-picker";
import type { PublishFieldKey } from "~/logic/publish/validation";
import type { UploadItem } from "./shared";
import { SectionCard } from "./shared";

interface MediaSectionProps {
  previews: UploadItem[];
  previewUploading?: boolean;
  previewProcessingId?: string | null;
  icon: UploadItem | null;
  iconUploading?: boolean;
  cover: UploadItem | null;
  onPreviewUpload: (files: File[]) => void;
  onRemovePreview: (id: string) => void;
  onReorderPreview: (fromId: string, toId: string) => void;
  onMovePreviewToSlot: (fromIndex: number, slot: number) => void;
  onIconUpload: (files: File[]) => void;
  onCoverUpload: (files: File[]) => void;
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
  emptyClassName,
  mediaClassName,
  imageClassName,
  fieldKey,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  media: UploadItem | null;
  uploading?: boolean;
  emptyClassName?: string;
  mediaClassName?: string;
  imageClassName?: string;
  /** 校验失败时滚动闪烁的锚点，取值见 PublishFieldKey。 */
  fieldKey?: PublishFieldKey;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-publish-field={fieldKey}
      className="relative flex min-w-0 flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
    >
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
        <div
          className={`flex min-h-56 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/25 ${
            mediaClassName || ""
          }`}
        >
          <img
            src={media.url}
            alt={media.name}
            className={
              imageClassName || "h-full w-full object-cover"
            }
          />
        </div>
      ) : (
        <button
          type="button"
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85 ${
            emptyClassName || "h-36"
          }`}
          onClick={onPick}
        >
          <UploadSimpleIcon size={24} weight="duotone" />
          选择文件
        </button>
      )}
    </div>
  );
}

/** 高次幂的缓入缓出，两端很平、中间很陡。 */
function easeInOutPow(t: number, power: number) {
  const clamped = Math.min(1, Math.max(0, t));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return scale * clamped ** power;
  return 1 - (-2 * clamped + 2) ** power / 2;
}

function easeInOutPowInverse(amount: number, power: number) {
  const clamped = Math.min(1, Math.max(0, amount));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return (clamped / scale) ** (1 / power);
  return 1 - ((1 - clamped) / scale) ** (1 / power);
}

function PreviewCard({
  item,
  index,
  count,
  width,
  showProgress,
  onGripPointerDown,
  onOpen,
  onMove,
  onRemove,
  onLoad,
}: {
  item: UploadItem;
  index: number;
  count: number;
  width: number;
  showProgress: boolean;
  onGripPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onOpen: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onLoad?: (width: number, height: number) => void;
}) {
  return (
    <div
      data-preview-slot=""
      data-preview-id={item.id}
      data-preview-index={index}
      className="group relative shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-2"
      style={{ width }}
    >
      <button
        type="button"
        className="relative block w-full overflow-hidden rounded-lg border border-white/10 bg-black/25"
        onClick={onOpen}
      >
        <img
          src={item.url}
          alt={item.name}
          className="h-64 w-full object-contain"
          onLoad={(event) => {
            if (!onLoad) return;
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              onLoad(image.naturalWidth, image.naturalHeight);
            }
          }}
        />
        {item.processing && (
          <>
            <div className="absolute inset-0 bg-black/55" />
            {showProgress && (
              <div className="absolute left-1 right-1 top-1 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-blue-400 transition-all"
                  style={{ width: `${Math.min(100, item.progress || 0)}%` }}
                />
              </div>
            )}
          </>
        )}
      </button>
      <div className="mt-2 flex items-center gap-1">
        <div
          role="button"
          tabIndex={0}
          aria-label="拖动排序"
          className="cursor-grab touch-none rounded p-1 text-white/40 active:cursor-grabbing"
          onPointerDown={onGripPointerDown}
        >
          <DotsSixVerticalIcon size={15} weight="bold" />
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-white/70">
          {item.name}
        </span>
        <button
          type="button"
          disabled={index === 0}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(-1)}
          aria-label="前移"
        >
          <ArrowLeftIcon size={14} />
        </button>
        <button
          type="button"
          disabled={index === count - 1}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(1)}
          aria-label="后移"
        >
          <ArrowRightIcon size={14} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-white/50 transition hover:bg-red-500/15 hover:text-red-300"
          onClick={onRemove}
          aria-label="移除预览图"
        >
          <XCircleIcon size={15} weight="fill" />
        </button>
      </div>
    </div>
  );
}

export function MediaSection({
  previews,
  previewUploading,
  previewProcessingId,
  icon,
  iconUploading,
  cover,
  onPreviewUpload,
  onRemovePreview,
  onReorderPreview,
  onMovePreviewToSlot,
  onIconUpload,
  onCoverUpload,
  onRemoveIcon,
  onRemoveCover,
  onMediaDimensions,
}: MediaSectionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previewScrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moveToSlotRef = useRef(onMovePreviewToSlot);
  const dragSessionRef = useRef<{
    pointerId: number;
    id: string;
    fromIndex: number;
    slot: number;
    scroll: number;
    visual: number;
    animFrom: number;
    animTo: number;
    animStart: number;
    landingWidth: number;
    cardCenterX: number;
    lastTick: number;
    ready: boolean;
    dropping: boolean;
  } | null>(null);
  const pointerListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const dropTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [edgePad, setEdgePad] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [lifted, setLifted] = useState<{
    id: string;
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  moveToSlotRef.current = onMovePreviewToSlot;

  const pickPreview = async () => {
    const files = await pickFiles({
      multiple: true,
      accept: "image/*",
      title: "选择预览图",
    });
    if (files.length > 0) onPreviewUpload(files);
  };

  const pickIcon = async () => {
    const files = await pickFiles({ accept: "image/*", title: "选择图标" });
    if (files.length > 0) onIconUpload(files);
  };

  const pickCover = async () => {
    const files = await pickFiles({ accept: "image/*", title: "选择封面" });
    if (files.length > 0) onCoverUpload(files);
  };

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

  useEffect(() => {
    const node = previewScrollerRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth + 1) return;
      event.preventDefault();
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      node.scrollLeft += delta;
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [previews.length]);

  const scrollPreview = (direction: -1 | 1) => {
    const nextIndex = Math.min(
      previews.length - 1,
      Math.max(0, activeIndex + direction),
    );
    scrollPreviewTo(nextIndex);
  };

  const previewWidthFor = (item: UploadItem): number => {
    if (!item.width || !item.height) return 240;
    const ratio = item.width / item.height;
    return Math.min(360, Math.max(180, Math.round(ratio * 208)));
  };

  const syncActivePreview = () => {
    if (dragSessionRef.current) return;
    const node = previewScrollerRef.current;
    if (!node) return;
    const cards = Array.from(
      node.querySelectorAll<HTMLElement>("[data-preview-index]"),
    );
    if (cards.length === 0) return;
    const center = node.scrollLeft + node.clientWidth / 2;
    let matchedIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - center);
      if (distance < minDistance) {
        minDistance = distance;
        matchedIndex = index;
      }
    });
    setActiveIndex(matchedIndex);
  };

  const scrollPreviewTo = (index: number) => {
    const node = previewScrollerRef.current;
    if (!node) return;
    const cards = Array.from(
      node.querySelectorAll<HTMLElement>("[data-preview-index]"),
    );
    const target = cards[index];
    if (target) {
      node.scrollTo({
        left: Math.max(target.offsetLeft - 12, 0),
        behavior: "smooth",
      });
    }
  };

  const localScale = (node: HTMLElement) => {
    const layoutWidth = node.offsetWidth;
    if (layoutWidth <= 0) return 1;
    const scale = node.getBoundingClientRect().width / layoutWidth;
    return scale > 0.01 ? scale : 1;
  };

  const slotCards = () => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLElement>("[data-preview-slot]"));
  };

  /** 每个缝对齐到固定竖线时，滚动容器应处的 scrollLeft。 */
  const measureSlotScrollLefts = (scroller: HTMLElement, cards: HTMLElement[]) => {
    const scrollerRect = scroller.getBoundingClientRect();
    const lineX = scrollerRect.left + scrollerRect.width / 2;
    const transform = getComputedStyle(scroller).transform;
    const scale =
      !transform || transform === "none" ? 1 : new DOMMatrix(transform).a || 1;
    const toScrollLeft = (anchorX: number) =>
      scroller.scrollLeft + (anchorX - lineX) / (scale > 0.01 ? scale : 1);
    if (cards.length === 0) return [scroller.scrollLeft];
    const landing = dragSessionRef.current?.landingWidth ?? 0;
    const clearance = (landing / 2 + 8) * (scale > 0.01 ? scale : 1);
    const first = cards[0].getBoundingClientRect();
    const targets = [toScrollLeft(first.left - clearance)];
    for (let index = 0; index < cards.length - 1; index++) {
      const before = cards[index].getBoundingClientRect();
      const after = cards[index + 1].getBoundingClientRect();
      targets.push(toScrollLeft((before.right + after.left) / 2));
    }
    const last = cards[cards.length - 1].getBoundingClientRect();
    targets.push(toScrollLeft(last.right + clearance));
    return targets;
  };

  const detachPointerListeners = () => {
    const listeners = pointerListenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.up);
    pointerListenersRef.current = null;
  };

  const endDrag = () => {
    if (dropTimerRef.current != null) {
      window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const scroller = previewScrollerRef.current;
    if (scroller) {
      scroller.style.width = "";
      scroller.style.maxWidth = "";
      scroller.style.transform = "";
      const node = scroller;
      window.setTimeout(() => {
        node.style.transition = "";
        node.style.transformOrigin = "";
      }, 170);
    }
    detachPointerListeners();
    dragSessionRef.current = null;
    setDraggingId(null);
    setLifted(null);
    setDropping(false);
    setEdgePad(0);
  };

  useEffect(() => {
    if (!draggingId) return;
    const scroller = previewScrollerRef.current;
    const session = dragSessionRef.current;
    if (!scroller || !session) return;
    scroller.style.transition = "transform 150ms ease";
    scroller.style.transformOrigin = "center center";
    scroller.style.transform = "scale(0.9)";
    const align = (markReady: boolean) => {
      const current = dragSessionRef.current;
      if (!current || current.dropping || current.ready) return;
      const targets = measureSlotScrollLefts(scroller, slotCards());
      if (targets.length === 0) return;
      const slot = Math.min(current.fromIndex, targets.length - 1);
      scroller.scrollLeft = Math.max(0, targets[slot]);
      current.slot = slot;
      current.scroll = scroller.scrollLeft;
      current.visual = scroller.scrollLeft;
      current.animFrom = scroller.scrollLeft;
      current.animTo = scroller.scrollLeft;
      current.animStart = 0;
      if (markReady) current.ready = true;
    };
    const frame = requestAnimationFrame(() => align(false));
    const timer = window.setTimeout(() => align(true), 160);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [draggingId, edgePad]);

  useEffect(() => {
    return () => {
      if (dropTimerRef.current != null) {
        window.clearTimeout(dropTimerRef.current);
      }
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      const listeners = pointerListenersRef.current;
      if (!listeners) return;
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
    };
  }, []);

  const startGripDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    id: string,
    index: number,
  ) => {
    if (previews.length < 2 || dragSessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-preview-id]");
    const frame = viewportRef.current;
    const scroller = previewScrollerRef.current;
    if (!(card instanceof HTMLElement) || !frame || !scroller) return;
    const cardRect = card.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const uiScale = localScale(frame);
    const lockedWidth = scroller.clientWidth;
    const landingWidth = card.offsetWidth;
    scroller.style.width = `${lockedWidth}px`;
    scroller.style.maxWidth = `${lockedWidth}px`;
    dragSessionRef.current = {
      pointerId: event.pointerId,
      id,
      fromIndex: index,
      slot: index,
      scroll: scroller.scrollLeft,
      visual: scroller.scrollLeft,
      animFrom: scroller.scrollLeft,
      animTo: scroller.scrollLeft,
      animStart: 0,
      landingWidth,
      cardCenterX: cardRect.left + cardRect.width / 2,
      lastTick: 0,
      ready: false,
      dropping: false,
    };
    setEdgePad(lockedWidth / 2 + landingWidth / 2 + 8);
    setDropping(false);
    setLifted({
      id,
      left: (cardRect.left - frameRect.left) / uiScale,
      top: (cardRect.top - frameRect.top) / uiScale,
      width: cardRect.width / uiScale,
    });
    setDraggingId(id);

    const move = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      if (!session || session.dropping || ev.pointerId !== session.pointerId) return;
      if (!frameNode) return;
      ev.preventDefault();
      const frameRectNow = frameNode.getBoundingClientRect();
      const scaleNow = localScale(frameNode);
      session.cardCenterX =
        ev.clientX - (event.clientX - cardRect.left) + cardRect.width / 2;
      const rawLeft =
        (ev.clientX - frameRectNow.left - (event.clientX - cardRect.left)) / scaleNow;
      setLifted((current) =>
        current
          ? {
              ...current,
              left: Math.min(
                Math.max(0, frameNode.clientWidth - current.width),
                Math.max(0, rawLeft),
              ),
            }
          : current,
      );
    };
    const tick = (now: number) => {
      scrollRafRef.current = window.requestAnimationFrame(tick);
      const session = dragSessionRef.current;
      const scrollNode = previewScrollerRef.current;
      if (!session || !scrollNode || session.dropping || !session.ready) {
        if (session) session.lastTick = now;
        return;
      }
      const dt = session.lastTick
        ? Math.min(0.05, (now - session.lastTick) / 1000)
        : 0;
      session.lastTick = now;
      if (dt <= 0) return;
      const targets = measureSlotScrollLefts(scrollNode, slotCards());
      if (targets.length === 0) return;
      const scrollRect = scrollNode.getBoundingClientRect();
      const lineX = scrollRect.left + scrollRect.width / 2;
      const offset = session.cardCenterX - lineX;
      const distance = Math.abs(offset) - 12;
      if (distance > 0) {
        const direction = offset > 0 ? 1 : -1;
        const speed = Math.min(distance / 120, 1) * 460;
        session.scroll += direction * speed * dt;
        const lo = Math.min(...targets);
        const hi = Math.max(...targets);
        session.scroll = Math.min(hi, Math.max(lo, session.scroll));
      }
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let slot = 0; slot < targets.length; slot++) {
        const gap = Math.abs(session.scroll - targets[slot]);
        if (gap < best) {
          best = gap;
          nearest = slot;
        }
      }
      session.slot = nearest;
      const target = Math.max(0, targets[nearest]);
      const easePower = 6;
      const easeMs = 240;
      if (Math.abs(target - session.animTo) > 0.5) {
        const previousSpan = session.animTo - session.animFrom;
        const traveled =
          previousSpan === 0
            ? 0
            : (session.visual - session.animFrom) / previousSpan;
        const sameWay =
          Math.abs(previousSpan) > 0.5 &&
          Math.sign(target - session.visual) === Math.sign(previousSpan) &&
          traveled > 0 &&
          traveled < 1;
        if (sameWay) {
          const nextSpan = target - session.animFrom;
          const nextAmount =
            nextSpan === 0 ? 1 : (session.visual - session.animFrom) / nextSpan;
          const progress = easeInOutPowInverse(nextAmount, easePower);
          session.animTo = target;
          session.animStart = now - progress * easeMs;
        } else {
          session.animFrom = session.visual;
          session.animTo = target;
          session.animStart = now;
        }
      }
      const progress = Math.min(1, Math.max(0, (now - session.animStart) / easeMs));
      session.visual =
        session.animFrom +
        (session.animTo - session.animFrom) * easeInOutPow(progress, easePower);
      if (Math.abs(target - session.visual) < 0.4) {
        session.visual = target;
        session.animFrom = target;
        session.animTo = target;
      }
      scrollNode.scrollLeft = Math.max(0, session.visual);
    };
    const up = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      const scrollNode = previewScrollerRef.current;
      if (!session || ev.pointerId !== session.pointerId || session.dropping) return;
      session.dropping = true;
      detachPointerListeners();
      if (!frameNode || !scrollNode) {
        endDrag();
        return;
      }
      setDropping(true);
      requestAnimationFrame(() => {
        const frameRectNow = frameNode.getBoundingClientRect();
        const scrollRect = scrollNode.getBoundingClientRect();
        const lineX = scrollRect.left + scrollRect.width / 2;
        const scaleNow = localScale(frameNode);
        setLifted((current) =>
          current
            ? {
                ...current,
                left: (lineX - frameRectNow.left) / scaleNow - current.width / 2,
              }
            : current,
        );
        dropTimerRef.current = window.setTimeout(() => {
          dropTimerRef.current = null;
          const latest = dragSessionRef.current;
          if (latest) moveToSlotRef.current(latest.fromIndex, latest.slot);
          endDrag();
        }, 160);
      });
    };
    detachPointerListeners();
    pointerListenersRef.current = { move, up };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    scrollRafRef.current = window.requestAnimationFrame(tick);
  };

  return (
    <SectionCard
      title="媒体素材"
      description="上传或导入预览图组、应用图标与封面。相同文件会自动复用，无需重复上传。"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <MediaTile
            label="图标"
            hint="宽高比 1:1"
            fieldKey="icon"
            media={icon}
            uploading={iconUploading}
            emptyClassName="aspect-square max-md:aspect-[3/1]"
            mediaClassName="aspect-square max-md:aspect-[3/1]"
            imageClassName="max-h-full max-w-full object-contain"
            onPick={() => void pickIcon()}
            onRemove={onRemoveIcon}
          />
          <MediaTile
            label="封面"
            hint="宽高比 3:2"
            fieldKey="cover"
            media={cover}
            emptyClassName="aspect-[3/2]"
            mediaClassName="aspect-[3/2]"
            onPick={() => void pickCover()}
            onRemove={onRemoveCover}
          />
        </div>

        <div data-publish-field="previews" className="flex flex-col gap-2">
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
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2 py-1.5 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                onClick={() => scrollPreview(-1)}
                aria-label="上一组预览图"
              >
                <ArrowLeftIcon size={15} />
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2 py-1.5 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                onClick={() => scrollPreview(1)}
                aria-label="下一组预览图"
              >
                <ArrowRightIcon size={15} />
              </button>
              <Button
                type="button"
                variant="soft"
                disabled={previewUploading}
                onClick={() => void pickPreview()}
              >
                <UploadSimpleIcon size={15} weight="bold" />
                {previewUploading ? "处理中..." : "添加预览图"}
              </Button>
            </div>
          </div>

          {previews.length === 0 ? (
            <button
              type="button"
              className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85"
              onClick={() => void pickPreview()}
            >
              <ImagesSquareIcon size={28} weight="duotone" />
              尚未上传预览图，点击选择文件
            </button>
          ) : (
            <>
            <div ref={viewportRef} className="relative overflow-hidden">
            <div
              ref={previewScrollerRef}
              className={`scrollbar-none overflow-x-auto pb-1 ${
                draggingId ? "touch-none no-scrollbar" : ""
              }`}
              onScroll={syncActivePreview}
            >
              <div
                ref={listRef}
                className="flex w-max flex-nowrap gap-2"
                style={
                  edgePad > 0
                    ? { paddingLeft: edgePad, paddingRight: edgePad }
                    : undefined
                }
              >
              {previews.map((item, index) => {
                if (item.id === draggingId) return null;
                return (
                  <PreviewCard
                    key={item.id}
                    item={item}
                    index={index}
                    count={previews.length}
                    width={previewWidthFor(item)}
                    showProgress={item.id === previewProcessingId}
                    onGripPointerDown={(event) => startGripDrag(event, item.id, index)}
                    onOpen={() => {
                      setShowInfo(false);
                      setLightboxIndex(index);
                    }}
                    onMove={(direction) => {
                      const target = previews[index + direction];
                      if (target) onReorderPreview(item.id, target.id);
                    }}
                    onRemove={() => onRemovePreview(item.id)}
                    onLoad={(width, height) => {
                      if (!item.width || !item.height) {
                        onMediaDimensions("preview", item.id, width, height);
                      }
                    }}
                  />
                );
              })}
              <button
                type="button"
                className="flex min-h-[180px] w-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-center text-sm text-white/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.06] hover:text-white/85"
                onClick={() => void pickPreview()}
              >
                <UploadSimpleIcon size={24} weight="duotone" />
                {previewUploading ? "处理中..." : "添加预览图"}
              </button>
              </div>
            </div>
            {draggingId && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-0.5 -translate-x-1/2 rounded-full bg-blue-400"
              />
            )}
            {lifted &&
              previews
                .filter((item) => item.id === lifted.id)
                .map((item) => {
                  const index = previews.findIndex((entry) => entry.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className={`pointer-events-none absolute z-20 ${
                        dropping ? "transition-[left] duration-150 ease-out" : ""
                      }`}
                      style={{
                        left: lifted.left,
                        top: lifted.top,
                        width: lifted.width,
                      }}
                    >
                      <PreviewCard
                        item={item}
                        index={index}
                        count={previews.length}
                        width={lifted.width}
                        showProgress={item.id === previewProcessingId}
                        onGripPointerDown={() => {}}
                        onOpen={() => {}}
                        onMove={() => {}}
                        onRemove={() => {}}
                      />
                    </div>
                  );
                })}
            </div>
            {previews.length > 1 && (
              <div className="flex justify-center gap-1.5 pt-1">
                {previews.map((_, index) => (
                  <button
                    key={`preview-dot-${index}`}
                    type="button"
                    className={`h-1.5 rounded-full transition-all ${
                      index === activeIndex
                        ? "w-5 bg-white/80"
                        : "w-2 bg-white/25 hover:bg-white/45"
                    }`}
                    onClick={() => scrollPreviewTo(index)}
                    aria-label={`跳转到第 ${index + 1} 张预览图`}
                  />
                ))}
              </div>
            )}
            </>
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
            className="max-h-[calc(var(--ui-viewport-height)-2rem)] max-w-[calc(var(--ui-viewport-width)-2rem)] rounded-xl object-contain"
          />

          {showInfo && (
            <div className="absolute right-0 top-0 flex h-full w-[min(88%,360px)] flex-col border-l border-white/15 bg-[#111] p-5 shadow-2xl">
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

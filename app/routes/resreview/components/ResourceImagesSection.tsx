import { useCallback, useEffect, useRef, useState } from "react";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import type { PrResourcePreview } from "../types";

interface ImageMeta {
  width: number;
  height: number;
}

function DimensionTrackedImage({
  rawUrl,
  alt,
  className,
  onLoad,
}: {
  rawUrl: string;
  alt: string;
  className?: string;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}) {
  const proxiedUrl = useProxiedMediaUrl(rawUrl);
  return <img src={proxiedUrl} alt={alt} className={className} onLoad={onLoad} loading="lazy" />;
}

function PreviewLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const proxiedUrl = useProxiedMediaUrl(url);
  const [actual, setActual] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 z-50 overflow-auto bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="grid min-h-full min-w-full place-items-center p-6">
        <img
          src={proxiedUrl}
          alt="预览大图"
          onClick={(event) => {
            event.stopPropagation();
            setActual((value) => !value);
          }}
          className={
            actual
              ? "max-h-none max-w-none cursor-zoom-out"
              : "max-h-[88vh] max-w-[88vw] cursor-zoom-in object-contain"
          }
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="fixed right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/70 hover:bg-white/20 transition"
        aria-label="关闭"
      >
        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" /></svg>
      </button>
    </div>
  );
}

function useImageMeta() {
  const [imageMetaMap, setImageMetaMap] = useState<Record<string, ImageMeta>>({});

  const handleImageLoad = useCallback(
    (url: string, event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) return;
      setImageMetaMap((previous) => ({ ...previous, [url]: { width, height } }));
    },
    [],
  );

  const formatImageDimensions = (url: string): string => {
    const meta = imageMetaMap[url];
    if (!meta?.width || !meta?.height) return "-";
    return `${meta.width} × ${meta.height}`;
  };

  const formatAspectRatio = (url: string): string => {
    const meta = imageMetaMap[url];
    if (!meta?.width || !meta?.height) return "-";
    return (meta.width / meta.height).toFixed(2);
  };

  const getAspectRatioValue = (url: string): number | null => {
    const meta = imageMetaMap[url];
    if (!meta?.width || !meta?.height) return null;
    return meta.width / meta.height;
  };

  const isRatioValid = (url: string, expected: number): boolean => {
    const ratio = getAspectRatioValue(url);
    return ratio === null || Math.abs(ratio - expected) <= 0.01;
  };

  return {
    imageMetaMap,
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid: (url: string) => isRatioValid(url, 1),
    isCoverRatioValid: (url: string) => isRatioValid(url, 1.5),
  };
}

export function ResourceImagesSection({ resource }: { resource: PrResourcePreview }) {
  const {
    imageMetaMap,
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid,
    isCoverRatioValid,
  } = useImageMeta();
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [previewEdgeWidths, setPreviewEdgeWidths] = useState({ first: 0, last: 0 });
  const [previewAvailWidth, setPreviewAvailWidth] = useState(0);

  const syncPreviewScroll = useCallback(() => {
    const element = previewScrollRef.current;
    if (!element) return;
    const slides = element.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    if (slides.length === 0) return;
    const center = element.scrollLeft + element.clientWidth / 2;
    let minimumDistance = Infinity;
    let index = 0;
    slides.forEach((slide, slideIndex) => {
      const distance = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - center);
      if (distance < minimumDistance) {
        minimumDistance = distance;
        index = slideIndex;
      }
    });
    setPreviewActiveIndex(index);
  }, []);

  const scrollPreviewTo = useCallback((index: number) => {
    const element = previewScrollRef.current;
    if (!element) return;
    const slides = element.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    const target = slides[index];
    if (!target) return;
    const scrollTarget = target.offsetLeft + target.offsetWidth / 2 - element.clientWidth / 2;
    element.scrollTo({ left: scrollTarget, behavior: "smooth" });
  }, []);

  const measureAvailWidth = useCallback(() => {
    const element = previewScrollRef.current;
    if (element) setPreviewAvailWidth(element.clientWidth);
  }, []);

  const measurePreviewEdges = useCallback(() => {
    const element = previewScrollRef.current;
    if (!element) return;
    const slides = element.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    if (slides.length === 0) return;
    setPreviewEdgeWidths({
      first: slides[0].offsetWidth,
      last: slides[slides.length - 1].offsetWidth,
    });
  }, []);

  useEffect(() => {
    measureAvailWidth();
  }, [measureAvailWidth]);

  useEffect(() => {
    const id = requestAnimationFrame(measurePreviewEdges);
    return () => cancelAnimationFrame(id);
  }, [measurePreviewEdges, imageMetaMap, resource.previewUrls, previewAvailWidth]);

  useEffect(() => {
    const handler = () => measureAvailWidth();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [measureAvailWidth]);

  const handleIconLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => handleImageLoad(resource.iconUrl, event),
    [handleImageLoad, resource.iconUrl],
  );
  const handleCoverLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => handleImageLoad(resource.coverUrl, event),
    [handleImageLoad, resource.coverUrl],
  );
  const handlePreviewLoad = useCallback(
    (url: string) => (event: React.SyntheticEvent<HTMLImageElement>) => handleImageLoad(url, event),
    [handleImageLoad],
  );

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-xs font-semibold text-white/55">图片资源（Raw）</div>
        <div className="space-y-3">
          {(resource.iconUrl || resource.coverUrl) && (
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
              {resource.iconUrl && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <div className="text-xs text-white/55">Icon · {resource.iconUrl.split("/").pop() || "icon"}</div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.iconUrl)} ·
                    <span className={isIconRatioValid(resource.iconUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.iconUrl)}
                    </span>
                  </div>
                  <a href={resource.iconUrl} target="_blank" rel="noopener noreferrer" className="mx-auto mt-2 flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/40">
                    <DimensionTrackedImage rawUrl={resource.iconUrl} alt="Icon 预览" className="h-full w-full rounded-full object-contain p-3" onLoad={handleIconLoad} />
                  </a>
                </div>
              )}
              {resource.coverUrl && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <div className="text-xs text-white/55">Cover · {resource.coverUrl.split("/").pop() || "cover"}</div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.coverUrl)} ·
                    <span className={isCoverRatioValid(resource.coverUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.coverUrl)}
                    </span>
                  </div>
                  <a href={resource.coverUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-black/40">
                    <DimensionTrackedImage rawUrl={resource.coverUrl} alt="Cover 预览" className="max-h-[30vh] w-full object-contain" onLoad={handleCoverLoad} />
                  </a>
                </div>
              )}
            </div>
          )}
          {resource.previewUrls.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/55">预览图（{resource.previewUrls.length} 张）</div>
                {resource.previewUrls.length > 1 && (
                  <div className="inline-flex items-center gap-1">
                    <button type="button" aria-label="上一张预览图" onClick={() => scrollPreviewTo(Math.max(0, previewActiveIndex - 1))} disabled={previewActiveIndex === 0} className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 transition">
                      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z" /></svg>
                    </button>
                    <button type="button" aria-label="下一张预览图" onClick={() => scrollPreviewTo(Math.min(resource.previewUrls.length - 1, previewActiveIndex + 1))} disabled={previewActiveIndex === resource.previewUrls.length - 1} className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 transition">
                      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M101.66,53.66a8,8,0,0,1,11.32-11.32l80,80a8,8,0,0,1,0,11.32l-80,80a8,8,0,0,1-11.32-11.32L164.69,128Z" /></svg>
                    </button>
                  </div>
                )}
              </div>
              <div ref={previewScrollRef} onScroll={syncPreviewScroll} className="scrollbar-none overflow-x-auto pb-1">
                <div className="flex flex-nowrap gap-2 snap-x snap-mandatory sm:gap-3" style={{ minWidth: "min-content", paddingLeft: previewEdgeWidths.first ? `calc(50% - ${previewEdgeWidths.first / 2}px)` : "calc(50% - 160px)", paddingRight: previewEdgeWidths.last ? `calc(50% - ${previewEdgeWidths.last / 2}px)` : "calc(50% - 160px)" }}>
                  {resource.previewUrls.map((url, index) => {
                    const meta = imageMetaMap[url];
                    const ratio = meta?.width && meta?.height ? meta.width / meta.height : 0;
                    const cap = previewAvailWidth ? `${previewAvailWidth - 32}px` : "calc(100vw - 64px)";
                    return (
                      <div key={url} data-preview-slide="1" className="shrink-0 snap-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-center sm:px-3 sm:py-2">
                        <button type="button" onClick={() => setLightboxUrl(url)} className="inline-block cursor-zoom-in overflow-hidden rounded-md border border-white/10 bg-black/40 p-0" style={ratio ? { width: `min(${meta!.width}px, calc(40vh * ${ratio}), ${cap})` } : undefined}>
                          <DimensionTrackedImage rawUrl={url} alt={`Preview ${index + 1}`} className="block h-auto w-full" onLoad={handlePreviewLoad(url)} />
                        </button>
                        <div className="mt-2 break-all text-xs text-white/45">{url.split("/").pop() || `预览 ${index + 1}`}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {resource.previewUrls.length > 1 && (
                <div className="flex items-center justify-center gap-1.5">
                  {resource.previewUrls.map((_, index) => (
                    <button type="button" key={index} aria-label={`查看第 ${index + 1} 张预览图`} onClick={() => scrollPreviewTo(index)} className={`h-1.5 rounded-full transition-all ${index === previewActiveIndex ? "w-5 bg-white/70" : "w-2 bg-white/20 hover:bg-white/35"}`} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            !resource.manifestError && <div className="text-xs text-white/45">未检测到预览图</div>
          )}
        </div>
      </div>
      {lightboxUrl && <PreviewLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}

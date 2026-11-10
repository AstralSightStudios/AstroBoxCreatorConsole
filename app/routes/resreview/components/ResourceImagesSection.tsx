import { ArrowClockwiseIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import { rawGithubUrlToBlobUrl } from "~/logic/github-raw";
import { scrollAndFlash } from "~/logic/publish/scroll-highlight";
import { useOverlayHistoryDismiss } from "~/logic/ui/overlay-history";
import { ScrollArea } from "~/components/scroll-area";
import {
  fetchProxiedMediaUrl,
  useProxiedMediaUrl,
} from "~/logic/media-proxy";
import { inspectImageFile, type ImageMeta as ImageContentMeta } from "~/logic/publish/image-meta";
import { hasCoverRatio } from "~/logic/publish/pre-publish-checks";
import type { PrResourcePreview } from "../types";

/** 在系统浏览器打开 GitHub 文件页；非 Tauri 环境回退 window.open。 */
function openExternalSource(url: string) {
  openUrl(url).catch(() =>
    window.open(url, "_blank", "noopener,noreferrer"),
  );
}

interface ImageMeta {
  width: number;
  height: number;
}

/**
 * 动图/格式解析会读取最多 4MB 字节并逐帧扫描；图片改为进入页面即全部
 * 加载后，必须串行执行，避免十几张图同时解析把主线程卡住。
 */
let imageInspectQueue: Promise<void> = Promise.resolve();

interface EagerMediaState {
  rawUrl: string;
  src: string;
  status: "loading" | "ready" | "error";
}

/**
 * 进入资源详情就立即请求图片，不再用 IntersectionObserver 等待滚动。
 *
 * 底层由 media-proxy 统一限制并发（6），这里的 retry 会重新走一次
 * 「raw → Contents API → 主账号兜底」的链路。
 */
function useEagerMedia(rawUrl: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EagerMediaState>({
    rawUrl,
    src: "",
    status: "loading",
  });

  useEffect(() => {
    if (!rawUrl) {
      setState({ rawUrl, src: "", status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ rawUrl, src: "", status: "loading" });
    // 重试时绕过缓存，排除上次写入的空/损坏 blob。
    fetchProxiedMediaUrl(rawUrl, { forceFresh: attempt > 0 })
      .then((src) => {
        if (!cancelled) setState({ rawUrl, src, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ rawUrl, src: "", status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [rawUrl, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current =
    state.rawUrl === rawUrl
      ? state
      : { rawUrl, src: "", status: "loading" as const };

  return { src: current.src, status: current.status, retry };
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
  const { src, status, retry } = useEagerMedia(rawUrl);
  return (
    <>
      <img
        src={src || undefined}
        alt={alt}
        className={`${className ?? ""} ${src ? "" : "min-h-24 min-w-16 bg-white/[0.03]"}`}
        onLoad={onLoad}
      />
      {status === "error" && (
        <span
          role="button"
          tabIndex={0}
          aria-label="图片加载失败，点击重试"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            retry();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            retry();
          }}
          className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md bg-black/60 px-2 text-center text-[11px] text-white/85 transition hover:bg-black/70"
        >
          <ArrowClockwiseIcon size={16} />
          加载失败，点击重试
        </span>
      )}
    </>
  );
}

function PreviewLightbox({
  url,
  animated,
  onClose,
}: {
  url: string;
  animated?: boolean;
  onClose: () => void;
}) {
  const proxiedUrl = useProxiedMediaUrl(url);
  const { portalContainer } = useUiScaleViewport();
  const [actual, setActual] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const githubUrl = rawGithubUrlToBlobUrl(url);

  // 返回手势只关闭大图，不再退掉审核页。
  useOverlayHistoryDismiss(true, onClose);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!portalContainer) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 bg-black/85 backdrop-blur-sm"
      style={{ zIndex: 65 }}
      onClick={onClose}
    >
      <ScrollArea horizontal className="h-full w-full overscroll-contain">
        <div className="grid min-h-full min-w-full place-items-center p-6">
          <img
            key={replayKey}
            src={proxiedUrl}
            alt={animated ? "动图预览" : "预览大图"}
            onClick={(event) => {
              event.stopPropagation();
              setActual((value) => !value);
            }}
            className={
              actual
                ? "max-h-none max-w-none cursor-zoom-out"
                : "max-h-[calc(var(--ui-viewport-height)-4rem)] max-w-[calc(var(--ui-viewport-width)-4rem)] cursor-zoom-in object-contain"
            }
          />
        </div>
      </ScrollArea>
      {animated && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setReplayKey((value) => value + 1);
          }}
          className="fixed bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs text-white/80 transition hover:bg-white/20"
          style={{ bottom: "max(1.25rem, var(--ui-safe-area-bottom))" }}
        >
          重播动图
        </button>
      )}
      <div
        className="fixed z-10 flex items-center gap-2"
        style={{
          top: "max(1rem, var(--ui-safe-area-top))",
          right: "max(1rem, var(--ui-safe-area-right))",
        }}
      >
        {githubUrl && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openExternalSource(githubUrl);
            }}
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
            aria-label="在 GitHub 查看源文件"
            title="在 GitHub 查看源文件"
          >
            <GithubLogoIcon size={16} weight="fill" />
            <span className="hidden sm:inline">查看源文件</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/70 transition hover:bg-white/20"
          aria-label="关闭"
        >
          <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" /></svg>
        </button>
      </div>
    </div>,
    portalContainer,
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
    // cover 与「自动检查」共用同一判定：宽/高保留两位小数等于 1.50。
    // 原来这里的 ±0.01 容差会把 1.49、1.51 也标成合格，和自动检查结论相反。
    isCoverRatioValid: (url: string) => {
      const meta = imageMetaMap[url];
      if (!meta?.width || !meta?.height) return true;
      return hasCoverRatio(meta.width, meta.height);
    },
  };
}

export function ResourceImagesSection({
  resource,
  highlightLabel,
  onHighlightHandled,
}: {
  resource: PrResourcePreview;
  /** 自动检查 Tab 传下来的待高亮标签：`icon` / `cover` / `preview N`。 */
  highlightLabel?: string | null;
  onHighlightHandled?: () => void;
}) {
  const { logicalHeight } = useUiScaleViewport();
  const {
    imageMetaMap,
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid,
    isCoverRatioValid,
  } = useImageMeta();
  const [contentMetaMap, setContentMetaMap] = useState<Record<string, ImageContentMeta>>({});
  const inspectedUrlsRef = useRef(new Set<string>());
  const inspectPreviewMeta = useCallback((url: string) => {
    if (inspectedUrlsRef.current.has(url)) return;
    inspectedUrlsRef.current.add(url);
    imageInspectQueue = imageInspectQueue.then(async () => {
      try {
        // 图片已经通过 useProxiedMediaUrl 加载过，这里读的是同一个 blob 缓存，
        // 不会再发一次 GitHub 请求。
        const proxied = await fetchProxiedMediaUrl(url);
        const blob = await (await fetch(proxied)).blob();
        const meta = await inspectImageFile(blob);
        setContentMetaMap((previous) =>
          previous[url] ? previous : { ...previous, [url]: meta },
        );
      } catch {
        // 取不到内容不影响图片展示；审核仍可从 rule-checks 的 magic 结果判断。
      }
    });
  }, []);
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [previewEdgeWidths, setPreviewEdgeWidths] = useState({ first: 0, last: 0 });
  const [previewAvailWidth, setPreviewAvailWidth] = useState(0);

  // 从「自动检查」跳过来的高亮：滚动到对应图片并闪烁。
  // 闪烁样式复用发布流程「前往修改」的 scrollAndFlash，两处观感一致。
  const iconRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlightLabel) return;
    // 预览图 label 形如 `preview 3`，需要先把对应那张滚到可视区。
    const previewMatch = /^preview\s+(\d+)$/.exec(highlightLabel);
    if (previewMatch) {
      const index = Math.max(0, Number(previewMatch[1]) - 1);
      if (index < resource.previewUrls.length) scrollPreviewTo(index);
      window.requestAnimationFrame(() => {
        const slide = previewScrollRef.current
          ?.querySelectorAll<HTMLElement>('[data-preview-slide="1"]')
          [index];
        scrollAndFlash(slide);
      });
    } else {
      scrollAndFlash(highlightLabel === "icon" ? iconRef.current : coverRef.current);
    }
    onHighlightHandled?.();
  }, [highlightLabel, resource.previewUrls.length, onHighlightHandled]);

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
    (url: string) => (event: React.SyntheticEvent<HTMLImageElement>) => {
      handleImageLoad(url, event);
      void inspectPreviewMeta(url);
    },
    [handleImageLoad, inspectPreviewMeta],
  );

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className="font-semibold text-white/55">图片资源</span>
          <span className="text-white/35">点击 Icon / Cover 在 GitHub 查看源文件</span>
        </div>
        <div className="space-y-3">
          {(resource.iconUrl || resource.coverUrl) && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
              {resource.iconUrl && (
                <div ref={iconRef} className={`rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm`}>
                  <div className="break-all text-xs text-white/55">Icon · {resource.iconUrl.split("/").pop() || "icon"}</div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.iconUrl)} ·
                    <span className={isIconRatioValid(resource.iconUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.iconUrl)}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="在 GitHub 查看 Icon 源文件"
                    onClick={() =>
                      openExternalSource(
                        rawGithubUrlToBlobUrl(resource.iconUrl) ?? resource.iconUrl,
                      )
                    }
                    className="relative mx-auto mt-2 flex h-[200px] w-[200px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/40 transition hover:border-white/30"
                  >
                    <DimensionTrackedImage rawUrl={resource.iconUrl} alt="Icon 预览" className="h-full w-full rounded-full object-contain p-3" onLoad={handleIconLoad} />
                  </button>
                </div>
              )}
              {resource.coverUrl && (
                <div ref={coverRef} className={`rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm`}>
                  <div className="break-all text-xs text-white/55">Cover · {resource.coverUrl.split("/").pop() || "cover"}</div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.coverUrl)} ·
                    <span className={isCoverRatioValid(resource.coverUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.coverUrl)}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="在 GitHub 查看 Cover 源文件"
                    onClick={() =>
                      openExternalSource(
                        rawGithubUrlToBlobUrl(resource.coverUrl) ?? resource.coverUrl,
                      )
                    }
                    className="relative mt-2 block w-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-black/40 transition hover:border-white/30"
                  >
                    <DimensionTrackedImage rawUrl={resource.coverUrl} alt="Cover 预览" className="max-h-[var(--ui-viewport-height-30pct)] w-full object-contain" onLoad={handleCoverLoad} />
                  </button>
                </div>
              )}
            </div>
          )}
          {resource.previewUrls.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/55">
                  预览图（{resource.previewUrls.length} 张
                  {(() => {
                    const animatedCount = resource.previewUrls.filter(
                      (url) => contentMetaMap[url]?.animated,
                    ).length;
                    return animatedCount > 0 ? `，${animatedCount} 张动图` : "";
                  })()}
                  ）
                </div>
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
                    const contentMeta = contentMetaMap[url];
                    const ratio = meta?.width && meta?.height ? meta.width / meta.height : 0;
                    const cap = previewAvailWidth ? `${previewAvailWidth - 32}px` : "calc(var(--ui-viewport-width) - 64px)";
                    const formatLabel = contentMeta?.animated && contentMeta.format === "png"
                      ? "APNG"
                      : (contentMeta?.format ?? "").toUpperCase();
                    return (
                      <div key={url} data-preview-slide="1" className={`shrink-0 snap-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-center sm:px-3 sm:py-2`}>
                        <button type="button" onClick={() => setLightboxUrl(url)} className="relative inline-block cursor-zoom-in overflow-hidden rounded-md border border-white/10 bg-black/40 p-0" style={ratio ? { width: `min(${meta!.width}px, ${logicalHeight * 0.4 * ratio}px, ${cap})` } : undefined}>
                          <DimensionTrackedImage rawUrl={url} alt={`Preview ${index + 1}`} className="block h-auto w-full" onLoad={handlePreviewLoad(url)} />
                          {contentMeta?.animated && (
                            <span className="absolute left-1.5 top-1.5 rounded border border-sky-300/30 bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
                              动图
                            </span>
                          )}
                        </button>
                        <div className="mt-2 flex min-w-0 items-center justify-center gap-1 text-xs text-white/45">
                          <span className="min-w-0 break-all">{url.split("/").pop() || `预览 ${index + 1}`}</span>
                          <button
                            type="button"
                            onClick={() =>
                              openExternalSource(
                                rawGithubUrlToBlobUrl(url) ?? url,
                              )
                            }
                            className="shrink-0 rounded p-0.5 text-white/35 transition hover:bg-white/10 hover:text-blue-300"
                            aria-label="在 GitHub 查看源文件"
                            title="在 GitHub 查看源文件"
                          >
                            <GithubLogoIcon size={13} weight="fill" />
                          </button>
                        </div>
                        {contentMeta?.animated && (
                          <div className="mt-1 text-[10px] text-sky-300/80">
                            {formatLabel}
                            {contentMeta.partial
                              ? " · 文件较大，帧率未完整解析"
                              : ` · 峰值 ${contentMeta.peakFps != null ? `${contentMeta.peakFps.toFixed(1)}fps` : "未知"} · ${contentMeta.frames != null ? `${contentMeta.frames} 帧` : "帧数未知"}${contentMeta.durationMs != null ? ` · ${(contentMeta.durationMs / 1000).toFixed(2)}s` : ""}`}
                          </div>
                        )}
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
      {lightboxUrl && (
        <PreviewLightbox
          url={lightboxUrl}
          animated={Boolean(contentMetaMap[lightboxUrl]?.animated)}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </>
  );
}

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Globe, Link as LinkIcon, YoutubeLogo, GithubLogo, TwitterLogo, DiscordLogo, MapPin, Play, ShoppingCart, File, Cube, Storefront, Download, ArrowLineDown } from "@phosphor-icons/react";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import { loadDeviceNameMap } from "~/logic/devices/catalog";
import type { PrResourcePreview } from "../types";

// --- Helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasUrl(value: string): boolean {
  return /https?:\/\/[^\s)]+/.test(value);
}

function renderTextWithLinks(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline break-all">${url}</a>`,
  );
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  globe: Globe,
  link: LinkIcon,
  youtube: YoutubeLogo,
  github: GithubLogo,
  twitter: TwitterLogo,
  discord: DiscordLogo,
  map: MapPin,
  play: Play,
  cart: ShoppingCart,
  file: File,
  cube: Cube,
  store: Storefront,
  storefront: Storefront,
};

function resolveLinkIcon(iconName?: string) {
  if (!iconName) return null;
  const key = iconName.trim().toLowerCase().replace(/[_-]/g, "");
  return ICON_MAP[key] || null;
}

// --- DimensionTrackedImage ---

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

// --- PreviewLightbox ---

function PreviewLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const proxiedUrl = useProxiedMediaUrl(url);
  const [actual, setActual] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/85 backdrop-blur-sm" onClick={onClose}>
      <div className="grid min-h-full min-w-full place-items-center p-6">
        <img
          src={proxiedUrl}
          alt="预览大图"
          onClick={(e) => {
            e.stopPropagation();
            setActual((a) => !a);
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
        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>
      </button>
    </div>
  );
}

// --- useImageMeta hook ---

interface ImageMeta {
  width: number;
  height: number;
}

function useImageMeta() {
  const [imageMetaMap, setImageMetaMap] = useState<Record<string, ImageMeta>>({});

  const handleImageLoad = useCallback(
    (url: string, event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) return;
      setImageMetaMap((prev) => ({ ...prev, [url]: { width, height } }));
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

  const isIconRatioValid = (url: string): boolean => {
    const ratio = getAspectRatioValue(url);
    if (ratio === null) return true;
    return Math.abs(ratio - 1) <= 0.01;
  };

  const isCoverRatioValid = (url: string): boolean => {
    const ratio = getAspectRatioValue(url);
    if (ratio === null) return true;
    return Math.abs(ratio - 1.5) <= 0.01;
  };

  return {
    imageMetaMap,
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid,
    isCoverRatioValid,
  };
}

// --- Grouped downloads ---

interface DownloadGroup {
  raw: string;
  file: string;
  version: string;
  devices: string[];
}

function groupDownloads(packages: PrResourcePreview["packages"]): DownloadGroup[] {
  const map = new Map<string, DownloadGroup>();
  for (const pkg of packages) {
    const key = `${pkg.url || ""}||${pkg.fileName || ""}||${pkg.version || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        raw: pkg.url || "",
        file: pkg.fileName || "",
        version: pkg.version || "",
        devices: [],
      });
    }
    const group = map.get(key)!;
    if (pkg.deviceId && !group.devices.includes(pkg.deviceId)) {
      group.devices.push(pkg.deviceId);
    }
  }
  return Array.from(map.values());
}

// --- Main Export ---

export function ResourceDetailTab({ resources }: { resources: PrResourcePreview[] }) {
  if (resources.length === 0) {
    return <p className="text-sm text-white/45">没有从目录 diff 中识别到资源条目。</p>;
  }

  if (resources.length === 1) {
    return <ResourceDetailView resource={resources[0]} />;
  }

  const [activeIdx, setActiveIdx] = useState(0);
  const resource = resources[activeIdx];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {resources.map((r, i) => (
          <button
            key={r.entry.id}
            onClick={() => setActiveIdx(i)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              i === activeIdx
                ? "bg-white/15 text-white"
                : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {r.manifest?.item?.name || r.entry.name || r.entry.id}
          </button>
        ))}
      </div>
      <ResourceDetailView key={resource.entry.id} resource={resource} />
    </div>
  );
}

// --- Full Resource Detail View ---

function ResourceDetailView({ resource }: { resource: PrResourcePreview }) {
  const {
    imageMetaMap,
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid,
    isCoverRatioValid,
  } = useImageMeta();

  const manifest = resource.manifest;
  const manifestItem = manifest?.item;
  const entry = resource.entry;

  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);
  const previewActiveUrl = resource.previewUrls[previewActiveIndex] ?? "";
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const syncPreviewScroll = useCallback(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    const slides = el.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    if (slides.length === 0) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let minDist = Infinity;
    let idx = 0;
    slides.forEach((s, i) => {
      const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - center);
      if (d < minDist) { minDist = d; idx = i; }
    });
    setPreviewActiveIndex(idx);
  }, []);

  const scrollPreviewTo = useCallback((index: number) => {
    const el = previewScrollRef.current;
    if (!el) return;
    const slides = el.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    const target = slides[index];
    if (!target) return;
    const scrollTarget = target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2;
    el.scrollTo({ left: scrollTarget, behavior: "smooth" });
  }, []);

  const [previewEdgeWidths, setPreviewEdgeWidths] = useState<{ first: number; last: number }>({ first: 0, last: 0 });
  const [previewAvailWidth, setPreviewAvailWidth] = useState(0);

  const measureAvailWidth = useCallback(() => {
    const el = previewScrollRef.current;
    if (el) setPreviewAvailWidth(el.clientWidth);
  }, []);

  const measurePreviewEdges = useCallback(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    const slides = el.querySelectorAll<HTMLElement>('[data-preview-slide="1"]');
    if (slides.length === 0) return;
    setPreviewEdgeWidths({
      first: (slides[0] as HTMLElement).offsetWidth,
      last: (slides[slides.length - 1] as HTMLElement).offsetWidth,
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
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      handleImageLoad(resource.iconUrl, e);
    },
    [handleImageLoad, resource.iconUrl],
  );

  const handleCoverLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      handleImageLoad(resource.coverUrl, e);
    },
    [handleImageLoad, resource.coverUrl],
  );

  const handlePreviewLoad = useCallback(
    (url: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
      handleImageLoad(url, e);
    },
    [handleImageLoad],
  );

  const groupedDownloads = useMemo(() => groupDownloads(resource.packages), [resource.packages]);

  const [deviceNameMap, setDeviceNameMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    loadDeviceNameMap().then(setDeviceNameMap).catch(() => {});
  }, []);

  const allDownloadUrls = useMemo(
    () => groupedDownloads.map((g) => g.raw).filter(Boolean) as string[],
    [groupedDownloads],
  );

  const handleDownloadAll = useCallback(() => {
    for (const url of allDownloadUrls) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [allDownloadUrls]);

  const links = useMemo(() => {
    const raw = manifest?.links;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is { title: string; url: string; icon?: string } => Boolean(l?.title || l?.url),
    );
  }, [manifest?.links]);

  const authors = useMemo(() => {
    const raw = manifest?.item?.author;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (a): a is { name: string; bindABAccount?: boolean } => Boolean(a?.name),
    );
  }, [manifest?.item?.author]);

  return (
    <div className="flex flex-col gap-3">
      {/* Manifest Error Banner */}
      {resource.manifestError && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          manifest 读取失败：{resource.manifestError}
        </div>
      )}

      {/* Resource Info Grid (2 columns) */}
      <div className="grid gap-2 sm:grid-cols-2">
        <InfoCell label="资源仓库">
          <a
            href={`https://github.com/${entry.repo_owner}/${entry.repo_name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-300 hover:underline"
          >
            {entry.repo_owner}/{entry.repo_name}
          </a>
        </InfoCell>
        <InfoCell label="资源分支">
          <a
            href={`https://github.com/${entry.repo_owner}/${entry.repo_name}/tree/${resource.ref}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-300 hover:underline"
          >
            {resource.ref || "-"}
          </a>
        </InfoCell>
      </div>

      {/* Resource Info + Devices (2 columns on xl) */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Resource Info Section */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold text-white/55">资源信息</div>
          <div className="space-y-2">
            <InfoRow label="资源名称" value={manifestItem?.name || entry.name || "-"} />
            <InfoRow label="资源 ID" value={manifestItem?.id || entry.id || "-"} />
            <InfoRow label="资源类型" value={manifestItem?.restype || entry.restype || "-"} />
            <InfoRow label="资源描述" value={manifestItem?.description || "-"} />
            <InfoRow
              label="AstroBoxCreator 加密功能"
              value={manifest?.ext?.enableAstroBoxCreatorFeatures ? "开启" : "关闭"}
            />

            {/* Authors */}
            <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-xs text-white/55">作者</span>
              <div className="flex flex-col gap-1">
                {authors.length > 0 ? (
                  authors.map((author, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <span className="min-w-0 break-all text-white">{author.name}</span>
                      {author.bindABAccount ? (
                        <span className="ml-auto shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                          已绑定 AstroBox
                        </span>
                      ) : (
                        <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/45">
                          未绑定
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-white/45">未填写作者</span>
                )}
              </div>
            </div>

            {/* Links */}
            {links.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-xs text-white/55">链接</span>
                <div className="flex flex-col gap-1">
                  {links.map((link, i) => {
                    const IconComp = resolveLinkIcon(link.icon);
                    return (
                      <a
                        key={i}
                        href={link.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/10 transition"
                      >
                        {IconComp ? (
                          <IconComp size={18} className="shrink-0 text-white/55" />
                        ) : null}
                        <span className="min-w-0 break-all text-white">{link.title || link.url}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Supported Devices Section */}
        <div className="relative rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-white/55">支持设备</span>
            {groupedDownloads.length > 0 && (
              <button
                onClick={handleDownloadAll}
                className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 transition"
              >
                <ArrowLineDown size={12} />
                下载所有包
              </button>
            )}
          </div>
          <div className="space-y-2">
            {groupedDownloads.map((group, i) => (
              <div
                key={i}
                className="relative rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="text-xs text-white/55">
                  支持设备：
                  {group.devices.map((d) => {
                    const name = deviceNameMap.get(d);
                    return name ? `${d}（${name}）` : d;
                  }).join(" / ") || "-"}
                </div>
                <div className="mt-1 text-xs text-white/55">版本：{group.version || "-"}</div>
                <div className="mt-1 break-all text-xs text-white/55">
                  文件：
                  <a
                    href={`https://github.com/${entry.repo_owner}/${entry.repo_name}/blob/${resource.ref}/${group.file}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-300 hover:underline"
                  >
                    {group.file || "-"}
                  </a>
                </div>
                <div className="mt-1 text-right">
                  {group.raw ? (
                    <button
                      onClick={() => window.open(group.raw, "_blank", "noopener,noreferrer")}
                      className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 transition"
                    >
                      <Download size={12} />
                      下载包
                    </button>
                  ) : (
                    <span className="text-xs text-white/45">下载包</span>
                  )}
                </div>
              </div>
            ))}
            {groupedDownloads.length === 0 && (
              <div className="text-sm text-white/45">无包体配置</div>
            )}
          </div>
        </div>
      </div>

      {/* Images Section */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-xs font-semibold text-white/55">图片资源（Raw）</div>
        <div className="space-y-3">
          {(resource.iconUrl || resource.coverUrl) && (
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
{/* Icon */}
              {resource.iconUrl && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <div className="text-xs text-white/55">
                    Icon · {resource.iconUrl.split("/").pop() || "icon"}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.iconUrl)} ·
                    <span className={isIconRatioValid(resource.iconUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.iconUrl)}
                    </span>
                  </div>
                  <a
                    href={resource.iconUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-auto mt-2 flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/40"
                  >
                    <DimensionTrackedImage
                      rawUrl={resource.iconUrl}
                      alt="Icon 预览"
                      className="h-full w-full rounded-full object-contain p-3"
                      onLoad={handleIconLoad}
                    />
                  </a>
                </div>
              )}

{/* Cover */}
              {resource.coverUrl && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <div className="text-xs text-white/55">
                    Cover · {resource.coverUrl.split("/").pop() || "cover"}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    像素：{formatImageDimensions(resource.coverUrl)} ·
                    <span className={isCoverRatioValid(resource.coverUrl) ? "" : "font-semibold text-red-400"}>
                      {" "}宽高比：{formatAspectRatio(resource.coverUrl)}
                    </span>
                  </div>
                  <a
                    href={resource.coverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-black/40"
                  >
                    <DimensionTrackedImage
                      rawUrl={resource.coverUrl}
                      alt="Cover 预览"
                      className="max-h-[30vh] w-full object-contain"
                      onLoad={handleCoverLoad}
                    />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Previews */}
          {resource.previewUrls.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/55">
                  预览图（{resource.previewUrls.length} 张）
                </div>
                {resource.previewUrls.length > 1 && (
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => scrollPreviewTo(Math.max(0, previewActiveIndex - 1))}
                      disabled={previewActiveIndex === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 transition"
                    >
                      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"></path></svg>
                    </button>
                    <button
                      onClick={() => scrollPreviewTo(Math.min(resource.previewUrls.length - 1, previewActiveIndex + 1))}
                      disabled={previewActiveIndex === resource.previewUrls.length - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 transition"
                    >
                      <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M101.66,53.66a8,8,0,0,1,11.32-11.32l80,80a8,8,0,0,1,0,11.32l-80,80a8,8,0,0,1-11.32-11.32L164.69,128Z"></path></svg>
                    </button>
                  </div>
                )}
              </div>
              <div
                ref={previewScrollRef}
                onScroll={syncPreviewScroll}
                className="scrollbar-none overflow-x-auto pb-1"
              >
                <div className="flex flex-nowrap gap-2 snap-x snap-mandatory sm:gap-3" style={{ minWidth: "min-content", paddingLeft: previewEdgeWidths.first ? `calc(50% - ${previewEdgeWidths.first / 2}px)` : "calc(50% - 160px)", paddingRight: previewEdgeWidths.last ? `calc(50% - ${previewEdgeWidths.last / 2}px)` : "calc(50% - 160px)" }}>
                  {resource.previewUrls.map((url, i) => {
                    const meta = imageMetaMap[url];
                    const ratio = meta?.width && meta?.height ? meta.width / meta.height : 0;
                    const cap = previewAvailWidth ? `${previewAvailWidth - 32}px` : "calc(100vw - 64px)";
                    return (
                    <div key={url} data-preview-slide="1" className="shrink-0 snap-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-center sm:px-3 sm:py-2">
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(url)}
                        className="inline-block cursor-zoom-in overflow-hidden rounded-md border border-white/10 bg-black/40 p-0"
                        style={ratio ? { width: `min(${meta!.width}px, calc(40vh * ${ratio}), ${cap})` } : undefined}
                      >
                        <DimensionTrackedImage
                          rawUrl={url}
                          alt={`Preview ${i + 1}`}
                          className="block h-auto w-full"
                          onLoad={handlePreviewLoad(url)}
                        />
                      </button>
                      <div className="mt-2 break-all text-xs text-white/45">
                        {url.split("/").pop() || `预览 ${i + 1}`}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
              {resource.previewUrls.length > 1 && (
                <div className="flex items-center justify-center gap-1.5">
                  {resource.previewUrls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => scrollPreviewTo(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === previewActiveIndex ? "w-5 bg-white/70" : "w-2 bg-white/20 hover:bg-white/35"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            !resource.manifestError && (
              <div className="text-xs text-white/45">未检测到预览图</div>
            )
          )}
        </div>
      </div>

      {lightboxUrl && <PreviewLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

    </div>
  );
}

// --- Sub-components ---

function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-xs text-white/55">{label}</span>
      <p className="mt-0.5 break-all text-sm font-medium text-white">{children}</p>
    </div>
  );
}

function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  const isUrl = value ? hasUrl(value) : false;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 md:flex-row md:items-start md:justify-between">
      <span className="text-xs text-white/55">{label}</span>
      {children ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : isUrl ? (
        <span
          className="min-w-0 break-all text-sm font-medium text-white"
          dangerouslySetInnerHTML={{ __html: renderTextWithLinks(value!) }}
        />
      ) : (
        <span className="min-w-0 break-all text-sm font-medium text-white">{value}</span>
      )}
    </div>
  );
}

import { useState, useMemo, useCallback } from "react";
import { Globe, Link as LinkIcon, YoutubeLogo, GithubLogo, TwitterLogo, DiscordLogo, MapPin, Play, ShoppingCart, File, Cube, Storefront } from "@phosphor-icons/react";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
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
    const divisor = gcd(meta.width, meta.height);
    return `${meta.width / divisor}:${meta.height / divisor}`;
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
    handleImageLoad,
    formatImageDimensions,
    formatAspectRatio,
    isIconRatioValid,
    isCoverRatioValid,
  } = useImageMeta();

  const manifest = resource.manifest;
  const manifestItem = manifest?.item;
  const entry = resource.entry;

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

  const links = useMemo(() => {
    const raw = manifest?.links;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is { title: string; url: string; icon?: string } => Boolean(l?.title || l?.url),
    );
  }, [manifest?.links]);

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
        <InfoCell label="资源仓库" value={`${entry.repo_owner}/${entry.repo_name}`} />
        <InfoCell label="资源分支" value={resource.ref || "-"} />
        <InfoCell label="资源 ID" value={entry.id || "-"} />
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

            {/* Links */}
            {links.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-xs text-white/55">链接（manifest_v2.links）</span>
                <div className="space-y-1 text-sm font-medium text-white">
                  {links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-blue-400 hover:underline"
                    >
                      {(() => {
                        const IconComp = resolveLinkIcon(link.icon);
                        return IconComp ? (
                          <IconComp size={16} className="shrink-0 text-white/55" />
                        ) : null;
                      })()}
                      {link.title && (
                        <span className="min-w-0 break-all text-white">{link.title}</span>
                      )}
                      <span className="min-w-0 break-all text-white/55">{link.url || "-"}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Supported Devices Section */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold text-white/55">支持设备</div>
          <div className="space-y-2">
            {groupedDownloads.map((group, i) => (
              <div
                key={i}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="text-xs text-white/55">
                  支持设备：
                  {group.devices.map((d) => d || "unknown").join(" / ") || "-"}
                </div>
                <div className="mt-1 text-xs text-white/55">版本：{group.version || "-"}</div>
                <div className="mt-1 break-all text-xs text-white/55">文件：{group.file || "-"}</div>
                {group.raw && (
                  <a
                    href={group.raw}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block break-all text-xs text-blue-400 hover:underline"
                  >
                    {group.raw}
                  </a>
                )}
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
                    <span
                      className={
                        isIconRatioValid(resource.iconUrl)
                          ? ""
                          : "font-semibold text-red-400"
                      }
                    >
                      宽高比：{formatAspectRatio(resource.iconUrl)}
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
                    <span
                      className={
                        isCoverRatioValid(resource.coverUrl)
                          ? ""
                          : "font-semibold text-red-400"
                      }
                    >
                      宽高比：{formatAspectRatio(resource.coverUrl)}
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
              <div className="text-xs text-white/55">
                预览图（{resource.previewUrls.length} 张）
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {resource.previewUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <DimensionTrackedImage
                      rawUrl={url}
                      alt={`Preview ${i + 1}`}
                      className="h-24 w-36 rounded-lg border border-white/10 object-cover"
                      onLoad={handlePreviewLoad(url)}
                    />
                  </a>
                ))}
              </div>
            </div>
          ) : (
            !resource.manifestError && (
              <div className="text-xs text-white/45">未检测到预览图</div>
            )
          )}
        </div>
      </div>


    </div>
  );
}

// --- Sub-components ---

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-xs text-white/55">{label}</span>
      <p className="mt-0.5 break-all text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const isUrl = hasUrl(value);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 md:flex-row md:items-center md:justify-between">
      <span className="text-xs text-white/55">{label}</span>
      {isUrl ? (
        <span
          className="min-w-0 break-all text-sm font-medium text-white"
          dangerouslySetInnerHTML={{ __html: renderTextWithLinks(value) }}
        />
      ) : (
        <span className="min-w-0 break-all text-sm font-medium text-white">{value}</span>
      )}
    </div>
  );
}

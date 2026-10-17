import { PackageIcon } from "@phosphor-icons/react";
import { Badge } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import {
  formatIndexPaidType,
  formatIndexResourceType,
  type IndexPaidType,
  type IndexResourceType,
  type IndexV2Entry,
} from "~/logic/catalog/index-v2";
import { useProxiedMediaUrl } from "~/logic/media-proxy";

export type BadgeColor =
  | "gray"
  | "blue"
  | "cyan"
  | "purple"
  | "orange"
  | "green"
  | "amber"
  | "red";

const RESOURCE_TYPE_COLORS: Record<IndexResourceType, BadgeColor> = {
  quick_app: "blue",
  watchface: "purple",
  canopus: "cyan",
  firmware: "orange",
  res_pack: "gray",
};

const PAID_TYPE_COLORS: Record<IndexPaidType, BadgeColor> = {
  free: "gray",
  paid: "amber",
  force_paid: "amber",
};

/** 在系统浏览器打开外链：Tauri 走 opener 插件，纯浏览器环境回退到 window.open。 */
export function openExternal(url: string) {
  openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

/**
 * 资源类型 / 付费类型徽章。免费资源不标注付费类型。
 */
export function ResourceBadges({
  entry,
  size = "1",
}: {
  entry: IndexV2Entry;
  size?: "1" | "2" | "3";
}) {
  return (
    <>
      <Badge
        size={size}
        variant="soft"
        color={RESOURCE_TYPE_COLORS[entry.restype]}
      >
        {formatIndexResourceType(entry.restype)}
      </Badge>
      {entry.paid_type !== "free" && (
        <Badge
          size={size}
          variant="soft"
          color={PAID_TYPE_COLORS[entry.paid_type]}
        >
          {formatIndexPaidType(entry.paid_type)}
        </Badge>
      )}
    </>
  );
}

/**
 * 资源图标：进入视口后再加载，未加载或无图标时展示占位图标。
 */
export function ResourceIcon({
  rawUrl,
  className = "size-8 rounded-md",
}: {
  rawUrl: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || active || !rawUrl) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, rawUrl]);

  return (
    <span
      ref={ref}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white/5 ${className}`}
    >
      <PackageIcon size={18} className="text-white/20" />
      {active && rawUrl ? (
        <LoadedIcon rawUrl={rawUrl} className="absolute inset-0" />
      ) : null}
    </span>
  );
}

function LoadedIcon({
  rawUrl,
  className = "",
}: {
  rawUrl: string;
  className?: string;
}) {
  const url = useProxiedMediaUrl(rawUrl);
  if (!url) return null;
  return (
    <img src={url} alt="" className={`size-full object-cover ${className}`} />
  );
}

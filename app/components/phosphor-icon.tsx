import { useEffect, useState, type ComponentType } from "react";
import { GlobeIcon } from "@phosphor-icons/react";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import {
  isLinkIconUrl,
  resolveAstroboxPhosphorIcon,
} from "~/logic/publish/phosphor-link-icon";

type PhosphorIconComponent = ComponentType<{ size?: number; className?: string }>;

/** kebab-case 图标名转 PascalCase，例如 github-logo -> GithubLogo。 */
export function phosphorIconNameToPascal(name: string): string {
  return name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

const phosphorIconModules = import.meta.glob<Record<string, PhosphorIconComponent>>(
  "/node_modules/@phosphor-icons/react/dist/csr/*.es.js",
);

/**
 * 按名称动态加载 Phosphor 图标（支持 manifest.links[].icon 里的任意图标名）。
 * 未匹配到图标时渲染同尺寸占位，避免布局抖动。
 */
export function PhosphorIconByName({
  name,
  size = 16,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const [Component, setComponent] = useState<PhosphorIconComponent | null>(null);

  useEffect(() => {
    let active = true;
    const modulePath = `/node_modules/@phosphor-icons/react/dist/csr/${phosphorIconNameToPascal(
      name,
    )}.es.js`;
    const loader = phosphorIconModules[modulePath];
    if (!loader) {
      setComponent(null);
      return;
    }
    loader()
      .then((module) => {
        if (!active) return;
        const pascalName = phosphorIconNameToPascal(name);
        const component =
          module[`${pascalName}Icon`] || module[pascalName] || null;
        setComponent(() => component);
      })
      .catch(() => {
        if (active) setComponent(null);
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (!Component) {
    return (
      <span
        className={className}
        style={{ display: "inline-block", width: size, height: size }}
      />
    );
  }
  return <Component size={size} className={className} />;
}

/**
 * 与 AstroBox 资源页一致的链接图标渲染：圆形灰底 + Phosphor 图标，
 * 含 `/` 或 `.` 的 icon 按图片 URL 渲染，无法解析时回退地球图标。
 * 与 `resolveAstroboxPhosphorIcon` 配套，保证 CC 预览和客户端一致。
 */
export function AstroboxLinkIcon({
  icon,
  size = 16,
  className = "text-white/70",
}: {
  icon?: string;
  size?: number;
  className?: string;
}) {
  const raw = (icon || "").trim();
  const box = size + 4;
  const isUrl = isLinkIconUrl(raw);
  const proxiedUrl = useProxiedMediaUrl(isUrl ? raw : undefined);

  if (isUrl) {
    return (
      <img
        src={proxiedUrl}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: box, height: box }}
      />
    );
  }

  const resolved = resolveAstroboxPhosphorIcon(raw);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-white/10"
      style={{ width: box, height: box }}
    >
      {resolved ? (
        <PhosphorIconByName name={resolved} size={size} className={className} />
      ) : (
        <GlobeIcon size={size} className={className} />
      )}
    </span>
  );
}

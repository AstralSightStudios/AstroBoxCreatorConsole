import { useEffect, useState, type ComponentType } from "react";

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

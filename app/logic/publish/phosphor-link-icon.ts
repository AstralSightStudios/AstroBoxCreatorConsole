import { PHOSPHOR_ICON_NAMES } from "~/routes/resreview/phosphor-icons";

/**
 * AstroBox 客户端（AstroBox-NG `RelatedLinks.getIconComponent`）解析 `links[].icon`
 * 的规则：
 *   1. 若 icon 含 `/` 或 `.`，按图片 URL 处理（Avatar src）；
 *   2. 否则 `toPascalCase(icon) + "Icon"` 查 regular 图标表，查不到回退 Globe。
 * 其中 `toPascalCase` 会按 `-` 分词并把每段除首字母外全部小写，因此 manifest 里
 * 必须写 kebab-case（如 `github-logo`）；写成 PascalCase（如 `GithubLogo`）会被
 * 解析成 `Githublogo` 而失败。
 *
 * 这里复刻同一套解析，保证 CC 的预览与校验结果和 AstroBox 一致。
 */

/** 与 AstroBox 完全一致的 kebab-case -> PascalCase 转换。 */
export function astroboxPascalFromIcon(icon: string): string {
  return icon
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/** AstroBox 对含 `/` 或 `.` 的 icon 按图片 URL 处理。 */
export function isLinkIconUrl(icon: string): boolean {
  return icon.includes("/") || icon.includes(".");
}

// 生成清单里混入了 `index`（打包 barrel 文件）这类无效项，需要剔除。
const VALID_ICON_SET = new Set(
  PHOSPHOR_ICON_NAMES.map((name) => name.toLowerCase()).filter(
    (name) => name !== "index",
  ),
);

/**
 * 返回 AstroBox 能解析出的规范 PascalCase 图标名；解析不出返回 null。
 * URL 形式的 icon 不属于 Phosphor 名，同样返回 null。
 */
export function resolveAstroboxPhosphorIcon(icon: string): string | null {
  const raw = (icon || "").trim();
  if (!raw || isLinkIconUrl(raw)) return null;
  const pascal = astroboxPascalFromIcon(raw);
  return VALID_ICON_SET.has(pascal.toLowerCase()) ? pascal : null;
}

/** PascalCase -> kebab-case，与 `astroboxPascalFromIcon` 互为逆运算。 */
export function phosphorPascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** 供发布选择器使用的 kebab-case 图标名列表（AstroBox 可直接解析）。 */
export const PHOSPHOR_LINK_ICON_NAMES: readonly string[] = PHOSPHOR_ICON_NAMES.filter(
  (name) => name.toLowerCase() !== "index",
).map(phosphorPascalToKebab);

/**
 * 归一化历史图标名：把 PascalCase（如 `GithubLogo`）转成 AstroBox 可解析的
 * kebab-case（`github-logo`）；URL 与已是 kebab-case 的保持不变。
 */
export function normalizeLinkIconName(icon: string): string {
  const raw = (icon || "").trim();
  if (!raw || isLinkIconUrl(raw)) return raw;
  return /[A-Z]/.test(raw) ? phosphorPascalToKebab(raw) : raw;
}

import {
  NG_PLUGIN_REPO_CONFIG,
  ngPluginIndexJsonUrl,
} from "~/config/pluginRepo";

/**
 * 插件 manifest。字段与 `AstroBox-NG-Module-PluginSystem/src/manifest.rs` 的
 * PluginManifest 对齐；额外允许几个 NG 版本已支持的展示字段。
 */
export interface NgPluginManifest {
  name: string;
  icon: string;
  version: string;
  description: string;
  author: string;
  website: string;
  entry: string;
  wasi_version: number;
  api_level: number;
  permissions: string[];
  additional_files?: string[];
  enableSettingsButton?: boolean;
  disable_default_padding?: boolean;
}

export interface NgPluginIndexEntry {
  repo: string;
  folder?: string;
  manifest?: Partial<NgPluginManifest> & { name?: string };
}

export async function fetchNgPluginIndex(): Promise<NgPluginIndexEntry[]> {
  const response = await fetch(ngPluginIndexJsonUrl());
  if (!response.ok) {
    throw new Error(`加载插件索引失败（HTTP ${response.status}）`);
  }
  const data = await response.json();
  const plugins = data?.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins.filter(
    (entry): entry is NgPluginIndexEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as NgPluginIndexEntry).repo === "string" &&
      Boolean((entry as NgPluginIndexEntry).manifest?.name),
  );
}

export function ngPluginDisplayName(entry: NgPluginIndexEntry): string {
  return entry.manifest?.name || "";
}

/**
 * 与 AstroBox-NG `web/src/logic/pluginMarket.ts` 的 `normalizeFolderPath` +
 * `buildFileUrl` 保持一致：清理 `./`、前导 /、尾随 / 与反斜杠，再按
 * `repo + folder + file` 拼接。index.json 里 icon 一律是相对路径（如 `icon.png`），
 * 但仍兜底绝对 URL，避免拼出 `.../dist/https://...` 这种非法地址。
 */
export function normalizePluginFolder(folder?: string): string {
  const trimmed = (folder || "").trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === ".") return "";
  return trimmed.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function ngPluginIconUrl(entry: NgPluginIndexEntry): string {
  const icon = (entry.manifest?.icon || "").trim();
  if (!icon) return "";
  if (icon.startsWith("http://") || icon.startsWith("https://")) return icon;
  const base = entry.repo.replace(/\/+$/, "");
  const folder = normalizePluginFolder(entry.folder);
  const file = icon.replace(/^\/+/, "");
  if (!folder) return `${base}/${file}`;
  return `${base}/${folder}/${file}`;
}

export const NG_PLUGIN_REPO = NG_PLUGIN_REPO_CONFIG;

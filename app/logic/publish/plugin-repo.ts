export interface NgPluginIndexEntry {
    repo: string;
    folder?: string;
    manifest?: {
        name?: string;
        icon?: string;
        version?: string;
        description?: string;
        author?: string;
        website?: string;
    };
}

const PLUGIN_INDEX_URL =
    "https://raw.githubusercontent.com/AstralSightStudios/AstroBox-NG-Plugin-Repo/main/index.json";

export async function fetchNgPluginIndex(): Promise<NgPluginIndexEntry[]> {
    const response = await fetch(PLUGIN_INDEX_URL);
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

export function ngPluginIconUrl(entry: NgPluginIndexEntry): string {
    const icon = entry.manifest?.icon;
    if (!icon) return "";
    const base = entry.repo.endsWith("/") ? entry.repo : `${entry.repo}/`;
    const folder = entry.folder ? `${entry.folder.replace(/\/+$/, "")}/` : "";
    return `${base}${folder}${icon}`;
}

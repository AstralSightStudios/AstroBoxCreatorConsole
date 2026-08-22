import { PUBLISH_CONFIG } from "~/config/publish";
import type { ResourceType } from "./resource-type";

export interface BasicAuthor {
    name: string;
    bindABAccount: boolean;
}

export interface BasicLink {
    icon: string;
    title: string;
    url: string;
}

export interface UploadAssetInput {
    id?: string;
    name: string;
    file: File;
    pathOverride?: string;
    skipUpload?: boolean;
}

export interface DownloadUploadInput {
    platformId: string;
    version: string;
    file: UploadAssetInput | null;
    pathOverride?: string;
    skipUpload?: boolean;
    encryptOnUpload?: boolean;
}

export interface ManifestDownloadInfo {
    version: string;
    file_name: string;
}

export interface ManifestBundledResource {
    type: string;
    /** resource 类型：目录资源 ID；plugin 类型：不使用 */
    id?: string;
    /** plugin 类型：插件仓库 index.json 中的 manifest.name；resource 类型：展示名（可选） */
    name?: string;
}

export type BundledResourceMode = "required" | "recommend";

export type BundledResourceType = "resource" | "plugin";

export interface BundledResourceEntry
    extends Omit<ManifestBundledResource, "type"> {
    mode: BundledResourceMode;
    type: BundledResourceType;
}

export interface ManifestExtObject extends Record<string, unknown> {
    enableAstroBoxCreatorFeatures?: boolean;
    trialDownloads?: Record<string, ManifestDownloadInfo>;
    bundledResources?: {
        required?: ManifestBundledResource[];
        recommend?: ManifestBundledResource[];
    };
    wallpaperGenerator?: {
        configUrl: string;
    };
}

function normalizeBundledList(
    list: unknown,
    mode: BundledResourceMode,
    seen: Set<string>,
): BundledResourceEntry[] {
    if (!Array.isArray(list)) return [];
    const result: BundledResourceEntry[] = [];
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const raw = item as { type?: unknown; id?: unknown; name?: unknown };
        const rawType = String(raw.type ?? "resource").trim();
        if (rawType === "plugin") {
            const pluginName =
                String(raw.name ?? raw.id ?? "").trim();
            if (!pluginName || seen.has(`plugin:${pluginName}`)) continue;
            seen.add(`plugin:${pluginName}`);
            result.push({ mode, type: "plugin", id: pluginName, name: pluginName });
            continue;
        }
        const id = String(raw.id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = String(raw.name ?? "").trim();
        result.push({
            mode,
            type: "resource",
            id,
            ...(name ? { name } : {}),
        });
    }
    return result;
}

/** 解析 manifest ext 中的 bundledResources。 */
export function normalizeBundledResources(
    value: unknown,
): BundledResourceEntry[] {
    const container = value as
        | { required?: unknown; recommend?: unknown }
        | undefined
        | null;
    const seen = new Set<string>();
    const required = normalizeBundledList(container?.required, "required", seen);
    const recommend = normalizeBundledList(container?.recommend, "recommend", seen);
    return [...required, ...recommend];
}

export interface ManifestWallpaperInput {
    configJson: string;
    configUrl: string;
    assets: Array<{
        path: string;
        file?: File;
        skipUpload?: boolean;
    }>;
}

export interface ManifestBuildInput {
    itemId: string;
    itemName: string;
    description: string;
    resourceType: ResourceType;
    previews: UploadAssetInput[];
    icon: UploadAssetInput | null;
    cover: UploadAssetInput | null;
    usePreviewAsCover: boolean;
    coverPreviewId: string | null;
    authors: BasicAuthor[];
    links: BasicLink[];
    downloads: DownloadUploadInput[];
    trialDownloads: DownloadUploadInput[];
    bundledResources?: BundledResourceEntry[];
    ext: ManifestExtObject;
    enableAstroBoxCreatorFeatures: boolean;
    wallpaper?: ManifestWallpaperInput;
}

export interface AssetDescriptor {
    path: string;
    file: File;
    skipUpload?: boolean;
}

export interface DownloadAssetDescriptor extends AssetDescriptor {
    platformId: string;
    version: string;
    encryptOnUpload?: boolean;
}

export interface ManifestBuildResult {
    manifestJson: string;
    previewAssets: AssetDescriptor[];
    iconAsset?: AssetDescriptor;
    coverAsset?: AssetDescriptor;
    downloadAssets: DownloadAssetDescriptor[];
    trialDownloadAssets: DownloadAssetDescriptor[];
    iconPath: string;
    coverPath: string;
    previewPaths: string[];
    wallpaperConfigJson?: string;
    wallpaperConfigPath?: string;
    wallpaperAssets: AssetDescriptor[];
}

function buildDownloadsObject(
    assets: DownloadAssetDescriptor[],
): Record<string, ManifestDownloadInfo> {
    return assets.reduce(
        (acc, current) => {
            acc[current.platformId] = {
                version: current.version,
                file_name: current.path,
            };
            return acc;
        },
        {} as Record<string, ManifestDownloadInfo>,
    );
}

function mediaAssetFingerprint(file: File): string {
    return `${file.name}|${file.size}|${file.type}`;
}

function reuseDuplicateAsset(
    asset: AssetDescriptor,
    seen: Map<string, AssetDescriptor>,
): AssetDescriptor {
    const fingerprint = mediaAssetFingerprint(asset.file);
    const existing = seen.get(fingerprint);
    if (existing) {
        return { ...asset, path: existing.path, skipUpload: true };
    }
    seen.set(fingerprint, asset);
    return asset;
}

export function buildManifest(input: ManifestBuildInput): ManifestBuildResult {
    const mediaDir = PUBLISH_CONFIG.mediaDirectory.replace(/\/+$/, "");
    const downloadsDir = PUBLISH_CONFIG.downloadsDirectory.replace(/\/+$/, "");
    const trialDownloadsDir = PUBLISH_CONFIG.trialDownloadsDirectory.replace(
        /\/+$/,
        "",
    );

    const seenAssets = new Map<string, AssetDescriptor>();
    const previewAssets: AssetDescriptor[] = input.previews.map((item) =>
        reuseDuplicateAsset(
            {
                path: item.pathOverride || `${mediaDir}/${item.name}`,
                file: item.file,
                skipUpload: item.skipUpload,
            },
            seenAssets,
        ),
    );
    const previewPathMap = new Map<string | undefined, string>();
    input.previews.forEach((item) => {
        previewPathMap.set(
            item.id ?? item.name,
            item.pathOverride || `${mediaDir}/${item.name}`,
        );
    });
    const previewPaths = Array.from(
        new Set(previewAssets.map((asset) => asset.path)),
    );

    const iconAsset = input.icon
        ? reuseDuplicateAsset(
              {
                  path: input.icon.pathOverride || `${mediaDir}/${input.icon.name}`,
                  file: input.icon.file,
                  skipUpload: input.icon.skipUpload,
              },
              seenAssets,
          )
        : undefined;

    const coverAsset =
        !input.usePreviewAsCover && input.cover
            ? reuseDuplicateAsset(
                  {
                      path: input.cover.pathOverride || `${mediaDir}/${input.cover.name}`,
                      file: input.cover.file,
                      skipUpload: input.cover.skipUpload,
                  },
                  seenAssets,
              )
            : undefined;

    const coverPath = input.usePreviewAsCover
        ? previewPathMap.get(input.coverPreviewId ?? input.previews[0]?.id) || ""
        : coverAsset?.path || "";

    const downloadAssets: DownloadAssetDescriptor[] = input.downloads
        .filter((d) => d.platformId.trim() && d.file)
        .map((d) => ({
            platformId: d.platformId.trim(),
            version: d.version.trim(),
            path: d.file?.pathOverride || d.pathOverride || `${downloadsDir}/${d.file!.name}`,
            file: d.file!.file,
            skipUpload: d.file?.skipUpload ?? d.skipUpload,
            encryptOnUpload: d.encryptOnUpload,
        }));

    const trialDownloadAssets: DownloadAssetDescriptor[] = input.trialDownloads
        .filter((d) => d.platformId.trim() && d.file)
        .map((d) => ({
            platformId: d.platformId.trim(),
            version: d.version.trim(),
            path:
                d.file?.pathOverride ||
                d.pathOverride ||
                `${trialDownloadsDir}/${d.file!.name}`,
            file: d.file!.file,
            skipUpload: d.file?.skipUpload ?? d.skipUpload,
            encryptOnUpload: false,
        }));

    const downloadsObject = buildDownloadsObject(downloadAssets);
    const trialDownloadsObject = buildDownloadsObject(trialDownloadAssets);
    const ext: ManifestExtObject = { ...input.ext };

    if (input.enableAstroBoxCreatorFeatures) {
        ext.enableAstroBoxCreatorFeatures = true;
    } else {
        delete ext.enableAstroBoxCreatorFeatures;
    }

    if (Object.keys(trialDownloadsObject).length > 0) {
        ext.trialDownloads = trialDownloadsObject;
    } else {
        delete ext.trialDownloads;
    }

    const bundledEntries: BundledResourceEntry[] = [];
    const seenBundledIds = new Set<string>();
    for (const item of input.bundledResources ?? []) {
        const isPlugin = item.type === "plugin";
        const identifier = String(
            (isPlugin ? item.name ?? item.id : item.id) ?? "",
        ).trim();
        if (!identifier || seenBundledIds.has(identifier)) continue;
        seenBundledIds.add(identifier);
        const trimmedName = item.name?.trim();
        bundledEntries.push({
            mode: item.mode === "recommend" ? "recommend" : "required",
            type: isPlugin ? "plugin" : "resource",
            id: identifier,
            ...(trimmedName ? { name: trimmedName } : {}),
        });
    }
    delete ext.bundledResources;
    if (bundledEntries.length > 0) {
        ext.bundledResources = {};
        const toManifestEntry = ({
            type,
            id,
            name,
        }: BundledResourceEntry) =>
            type === "plugin"
                ? { type, name: name ?? id }
                : { type, id };
        const required = bundledEntries
            .filter((item) => item.mode === "required")
            .map(toManifestEntry);
        const recommend = bundledEntries
            .filter((item) => item.mode === "recommend")
            .map(toManifestEntry);
        if (required.length > 0) {
            ext.bundledResources.required = required;
        }
        if (recommend.length > 0) {
            ext.bundledResources.recommend = recommend;
        }
    }

    let wallpaperConfigJson: string | undefined;
    let wallpaperConfigPath: string | undefined;
    const wallpaperAssets: AssetDescriptor[] = [];
    if (input.wallpaper && input.wallpaper.configJson.trim()) {
        wallpaperConfigJson = input.wallpaper.configJson;
        wallpaperConfigPath = "wallpaper/wallpaper.json";
        ext.wallpaperGenerator = { configUrl: input.wallpaper.configUrl };
        const seen = new Set<string>();
        for (const asset of input.wallpaper.assets) {
            if (!asset.file || asset.skipUpload) continue;
            if (seen.has(asset.path)) continue;
            seen.add(asset.path);
            wallpaperAssets.push({ path: asset.path, file: asset.file });
        }
    } else {
        delete ext.wallpaperGenerator;
    }

    const manifest = {
        item: {
            id: input.itemId.trim(),
            restype: input.resourceType,
            name: input.itemName.trim(),
            description: input.description.trim(),
            preview: previewPaths,
            icon: iconAsset?.path || "",
            cover: coverPath,
            author: input.authors
                .filter((a) => a.name.trim())
                .map((a) => ({
                    name: a.name.trim(),
                    bindABAccount: a.bindABAccount,
                })),
        },
        links: input.links
            .filter((link) => link.title.trim() || link.url.trim() || link.icon.trim())
            .map((link) => ({
                title: link.title.trim(),
                url: link.url.trim(),
                icon: link.icon.trim(),
            })),
        downloads: downloadsObject,
        ext,
    };

    return {
        manifestJson: JSON.stringify(manifest, null, 2),
        previewAssets,
        iconAsset,
        coverAsset,
        downloadAssets,
        trialDownloadAssets,
        iconPath: iconAsset?.path || "",
        coverPath,
        previewPaths,
        wallpaperConfigJson,
        wallpaperConfigPath,
        wallpaperAssets,
    };
}

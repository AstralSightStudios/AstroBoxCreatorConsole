import { PUBLISH_CONFIG } from "~/config/publish";

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

export interface ManifestExtObject extends Record<string, unknown> {
    enableAstroBoxCreatorFeatures?: boolean;
    trialDownloads?: Record<string, ManifestDownloadInfo>;
}

export interface ManifestBuildInput {
    itemId: string;
    itemName: string;
    description: string;
    resourceType: "quick_app" | "watchface";
    previews: UploadAssetInput[];
    icon: UploadAssetInput | null;
    cover: UploadAssetInput | null;
    usePreviewAsCover: boolean;
    coverPreviewId: string | null;
    authors: BasicAuthor[];
    links: BasicLink[];
    downloads: DownloadUploadInput[];
    trialDownloads: DownloadUploadInput[];
    ext: ManifestExtObject;
    enableAstroBoxCreatorFeatures: boolean;
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

export function buildManifest(input: ManifestBuildInput): ManifestBuildResult {
    const mediaDir = PUBLISH_CONFIG.mediaDirectory.replace(/\/+$/, "");
    const downloadsDir = PUBLISH_CONFIG.downloadsDirectory.replace(/\/+$/, "");
    const trialDownloadsDir = PUBLISH_CONFIG.trialDownloadsDirectory.replace(
        /\/+$/,
        "",
    );

    const previewAssets: AssetDescriptor[] = input.previews.map((item) => ({
        path: item.pathOverride || `${mediaDir}/${item.name}`,
        file: item.file,
        skipUpload: item.skipUpload,
    }));
    const previewPathMap = new Map<string | undefined, string>();
    input.previews.forEach((item) => {
        previewPathMap.set(
            item.id ?? item.name,
            item.pathOverride || `${mediaDir}/${item.name}`,
        );
    });
    const previewPaths = previewAssets.map((asset) => asset.path);

    const iconAsset = input.icon
        ? {
              path: input.icon.pathOverride || `${mediaDir}/${input.icon.name}`,
              file: input.icon.file,
              skipUpload: input.icon.skipUpload,
          }
        : undefined;

    const coverAsset =
        !input.usePreviewAsCover && input.cover
            ? {
                  path: input.cover.pathOverride || `${mediaDir}/${input.cover.name}`,
                  file: input.cover.file,
                  skipUpload: input.cover.skipUpload,
              }
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
    };
}

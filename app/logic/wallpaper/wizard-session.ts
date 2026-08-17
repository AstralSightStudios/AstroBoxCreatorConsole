import type { ResourceType } from "~/logic/publish/resource-type";
import type { UploadItem } from "~/routes/resource/publish/components/shared";
import type {
    AuthorInput,
    DownloadInput,
    LinkInput,
} from "~/routes/resource/publish/components/types";
import type { WallpaperAssetFile, WallpaperConfigRaw } from "./types";

export interface WizardFormSnapshot {
    itemId: string;
    itemName: string;
    description: string;
    resourceType: ResourceType;
    tagsInput: string;
    paidType: string;
    authors: AuthorInput[];
    links: LinkInput[];
    previews: UploadItem[];
    icon: UploadItem | null;
    cover: UploadItem | null;
    downloads: DownloadInput[];
    trialDownloads: DownloadInput[];
    enableAstroBoxCreatorFeatures: boolean;
    extRaw: string;
}

export interface WizardWallpaperResult {
    configJson: string;
    assets: WallpaperAssetFile[];
    config: WallpaperConfigRaw;
    baseUrl: string;
}

export interface WizardSession {
    /** New-mode form snapshot (files kept in-memory, object URLs stay valid). */
    form?: WizardFormSnapshot;
    /** Wallpaper config produced by the wallpaper editor page. */
    wallpaperResult?: WizardWallpaperResult;
    /** Wallpaper payload that existed before opening the editor (browser-back fallback). */
    wallpaperPayload?: {
        configJson: string;
        assets: WallpaperAssetFile[];
    };
}

let current: WizardSession | null = null;

export function saveWizardSession(session: WizardSession | null): void {
    current = session;
}

export function takeWizardSession(): WizardSession | null {
    const session = current;
    current = null;
    return session;
}

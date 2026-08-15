import { PUBLISH_CONFIG } from "~/config/publish";
import type { CatalogEntry } from "./catalog";
import { MAIN_RESOURCE_BRANCH } from "./branch";
import { getRepoFile, type RepoInfo } from "./github-actions";
import type {
    ManifestDownloadInfo,
    ManifestExtObject,
} from "./manifest";
import { resolveWallpaperUrl } from "@claralight-design/wallpaper-engine";
import {
    assetFileForRepoPath,
    collectConfigAssetPaths,
    configPathToRepoPath,
} from "~/logic/wallpaper/load-resources";
import type { WallpaperAssetFile, WallpaperConfigRaw } from "~/logic/wallpaper/types";

export interface ManifestV2 {
    item: {
        id: string;
        restype: string;
        name: string;
        description: string;
        preview: string[];
        icon: string;
        cover: string;
        author?: Array<{ name: string; bindABAccount?: boolean }>;
    };
    links?: Array<{ title: string; url: string; icon?: string }>;
    downloads?: Record<string, Partial<ManifestDownloadInfo>>;
    ext?: ManifestExtObject;
}

function decodeBase64(content?: string) {
    if (!content) return "";
    return new TextDecoder().decode(
        Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
    );
}

export function buildRawFileUrl(owner: string, repo: string, ref: string, path: string) {
    const encodedPath = path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodedPath}`;
}

export async function fetchManifestForCatalogEntry(options: {
    entry: CatalogEntry;
    token: string;
    ref?: string;
}): Promise<{ manifest: ManifestV2; raw: string; repo: RepoInfo; sha?: string }> {
    const { entry, token, ref } = options;
    const branch = MAIN_RESOURCE_BRANCH;
    const repo: RepoInfo = {
        owner: entry.repo_owner,
        name: entry.repo_name,
        branch,
    };
    const fetchRef = ref || entry.repo_commit_hash || branch;

    const response = await getRepoFile({
        repo,
        path: PUBLISH_CONFIG.manifestFileName,
        tokenOverride: token,
        ref: fetchRef,
    });

    const raw = decodeBase64(response.content);
    const manifest = raw ? (JSON.parse(raw) as ManifestV2) : undefined;

    if (!manifest?.item) {
        throw new Error("未找到 manifest_v2.json 或格式无效。");
    }

    return { manifest, raw, repo, sha: response.sha as string | undefined };
}

export function getWallpaperConfigUrl(manifest: ManifestV2): string | undefined {
    const generator = (manifest.ext as
        | { wallpaperGenerator?: { configUrl?: string } }
        | undefined)?.wallpaperGenerator;
    return generator?.configUrl;
}

export interface WallpaperConfigFile {
    config: WallpaperConfigRaw;
    assets: WallpaperAssetFile[];
    baseUrl: string;
}

/**
 * Fetch the wallpaper config (`wallpaper/wallpaper.json`) of a resource repo
 * together with the resolved absolute urls of every referenced asset.
 */
export async function fetchWallpaperConfigForCatalogEntry(options: {
    entry: CatalogEntry;
    token: string;
    ref?: string;
}): Promise<WallpaperConfigFile> {
    const { entry, token, ref } = options;
    const repo: RepoInfo = {
        owner: entry.repo_owner,
        name: entry.repo_name,
        branch: MAIN_RESOURCE_BRANCH,
    };
    const fetchRef = ref || entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;

    const response = await getRepoFile({
        repo,
        path: "wallpaper/wallpaper.json",
        tokenOverride: token,
        ref: fetchRef,
    });
    const raw = decodeBase64(response.content);
    const config = JSON.parse(raw) as WallpaperConfigRaw;

    const baseUrl = buildRawFileUrl(repo.owner, repo.name, fetchRef, "wallpaper/");
    const assets: WallpaperAssetFile[] = [];
    for (const path of collectConfigAssetPaths(config)) {
        assets.push(
            assetFileForRepoPath(
                configPathToRepoPath(path),
                resolveWallpaperUrl(path, baseUrl),
            ),
        );
    }

    return { config, assets, baseUrl };
}

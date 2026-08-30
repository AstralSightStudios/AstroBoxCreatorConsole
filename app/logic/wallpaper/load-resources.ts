import type { ResolvedWallpaperTemplate, WallpaperResources } from "@claralight-design/wallpaper-engine";
import { loadWallpaperFont, loadWallpaperImage } from "@claralight-design/wallpaper-engine/render";
import type { WallpaperAssetFile, WallpaperConfigRaw } from "./types";
import { getExpandedTemplate } from "./json-tree";
export interface WallpaperResourceOptions {
    /** Map a config asset path (e.g. `./assets/foo.png`) to an absolute url (object or raw). */
    resolvePath?: (path: string) => string | undefined;
}

function pickUrl(
    path: string | undefined,
    resolvedUrl: string | undefined,
    resolvePath?: (path: string) => string | undefined,
): string | undefined {
    if (!path) return undefined;
    const mapped = resolvePath?.(path);
    return mapped || resolvedUrl;
}

async function loadImage(
    url: string | undefined,
    cache: Map<string, HTMLImageElement>,
): Promise<HTMLImageElement | undefined> {
    if (!url) return undefined;
    const cached = cache.get(url);
    if (cached) return cached;
    try {
        const image = await loadWallpaperImage(url);
        cache.set(url, image);
        return image;
    } catch (error) {
        console.warn("[wallpaper] 素材加载失败", url, error);
        return undefined;
    }
}

/** 根据原始素材生成镜像文件，让不支持镜像变换的引擎也能正常渲染。 */
export async function createWallpaperAssetVariant(
    source: WallpaperAssetFile,
    variantPath: string,
    flipX: boolean,
    flipY: boolean,
): Promise<WallpaperAssetFile> {
    const image = await loadWallpaperImage(source.url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("素材尺寸无效，无法生成镜像。");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建素材处理画布。");
    context.translate(flipX ? width : 0, flipY ? height : 0);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("镜像素材生成失败。");
    const fileName = variantPath.split("/").pop() || "wallpaper-asset.png";
    const file = new File([blob], fileName, { type: "image/png" });
    return {
        path: variantPath,
        url: URL.createObjectURL(file),
        file,
        skipUpload: false,
    };
}

/** Build the engine `WallpaperResources` (assets + masks + fonts) for one resolved template. */
export async function loadTemplateResources(
    template: ResolvedWallpaperTemplate,
    options: WallpaperResourceOptions = {},
): Promise<WallpaperResources> {
    const cache = new Map<string, HTMLImageElement>();
    const assets: WallpaperResources["assets"] = {};
    const masks: WallpaperResources["masks"] = {};
    const fonts: WallpaperResources["fonts"] = {};

    for (const layer of template.layers) {
        if (layer.type === "asset") {
            const url = pickUrl(layer.src, layer.assetUrl, options.resolvePath);
            const image = await loadImage(url, cache);
            if (image) assets[layer.id] = image;
        }
        if (layer.maskUrl || layer.mask) {
            const url = pickUrl(layer.mask, layer.maskUrl, options.resolvePath);
            const image = await loadImage(url, cache);
            if (image) masks[layer.id] = image;
        }
        const text = layer.text;
        if (text) {
            for (const font of text.font.options) {
                if (!font.src) continue;
                const url = pickUrl(font.src, font.fontUrl, options.resolvePath);
                if (!url) continue;
                try {
                    const loaded = await loadWallpaperFont({ ...font, fontUrl: url });
                    if (loaded) {
                        // Typr 解析结果供 outline 主路径使用；缺字回退仍走 FontFace。
                        fonts[font.id] = loaded;
                        fonts[url] = fonts[url] ?? loaded;
                    }
                } catch (error) {
                    console.warn("[wallpaper] 字体加载失败", font.id, error);
                }
            }
        }
    }

    return { assets, masks, fonts };
}

/** Every config asset path referenced by one template, ready to map to upload files. */
export function collectTemplateAssetPaths(
    config: WallpaperConfigRaw,
    templateIndex: number,
): Array<{ path: string; usedBy: string; kind: "src" | "mask" | "font" }> {
    const template = getExpandedTemplate(config, templateIndex);
    const out: Array<{ path: string; usedBy: string; kind: "src" | "mask" | "font" }> = [];
    for (const layer of template.layers ?? []) {
        if (layer.type === "asset" && layer.src) {
            out.push({ path: layer.src, usedBy: layer.id, kind: "src" });
        }
        if (layer.mask) {
            out.push({ path: layer.mask, usedBy: layer.id, kind: "mask" });
        }
        if (layer.font && typeof layer.font !== "string") {
            for (const option of layer.font.options ?? []) {
                if (option.src) {
                    out.push({ path: option.src, usedBy: layer.id, kind: "font" });
                }
            }
        }
    }
    return out;
}

/** Every config asset path referenced by all templates (shared-aware). */
export function collectConfigAssetPaths(config: WallpaperConfigRaw): string[] {
    const seen = new Set<string>();
    for (let index = 0; index < config.templates.length; index++) {
        for (const item of collectTemplateAssetPaths(config, index)) {
            seen.add(item.path);
        }
    }
    return Array.from(seen);
}

const WALLPAPER_ROOT = "wallpaper";

/** `./assets/foo.png` -> `wallpaper/assets/foo.png` */
export function configPathToRepoPath(configPath: string): string {
    const trimmed = configPath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    return `${WALLPAPER_ROOT}/${trimmed}`;
}

/** `wallpaper/assets/foo.png` -> `./assets/foo.png` */
export function repoPathToConfigPath(repoPath: string): string {
    const trimmed = repoPath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    const withoutRoot = trimmed.startsWith(`${WALLPAPER_ROOT}/`)
        ? trimmed.slice(WALLPAPER_ROOT.length + 1)
        : trimmed;
    return `./${withoutRoot}`;
}

/** Strip the repo-relative prefix so we can reuse raw.githubusercontent paths. */
export function assetFileForRepoPath(
    repoPath: string,
    url: string,
    file?: File,
): WallpaperAssetFile {
    return {
        path: repoPath,
        url,
        file,
        skipUpload: !file,
    };
}

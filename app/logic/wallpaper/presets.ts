import type {
    WallpaperConfigRaw,
    WallpaperControlValue,
    WallpaperLayerConfig,
    WallpaperTemplateConfig,
} from "./types";

export interface WallpaperDevicePreset {
    id: string;
    title: string;
    width: number;
    height: number;
    /** Rounded-corner radius of the device preview frame. */
    previewRadius: number;
    /** Rounded-corner radius used when clipping rendered wallpaper. */
    frameRadius?: number;
}

export const WALLPAPER_DEVICE_PRESETS: WallpaperDevicePreset[] = [
    {
        id: "band-pro",
        title: "手环 Pro",
        width: 336,
        height: 480,
        previewRadius: 56,
        frameRadius: 0,
    },
    {
        id: "redmi-watch",
        title: "Redmi Watch",
        width: 432,
        height: 514,
        previewRadius: 72,
        frameRadius: 0,
    },
    {
        id: "square-466",
        title: "方形 466",
        width: 466,
        height: 466,
        previewRadius: 96,
        frameRadius: 40,
    },
    {
        id: "square-480",
        title: "方形 480",
        width: 480,
        height: 480,
        previewRadius: 96,
        frameRadius: 40,
    },
    {
        id: "circle-320",
        title: "圆形 320",
        width: 320,
        height: 320,
        previewRadius: 160,
        frameRadius: 160,
    },
    {
        id: "square-240",
        title: "方形 240",
        width: 240,
        height: 240,
        previewRadius: 48,
        frameRadius: 24,
    },
];

function defaultScaleControl(): WallpaperControlValue {
    return { default: 1, min: 1, max: 4, step: 0.01 };
}

function defaultRotationControl(): WallpaperControlValue {
    return { default: 0, min: -180, max: 180, step: 1 };
}

function defaultLayers(): WallpaperLayerConfig[] {
    return [
        {
            id: "photo",
            name: "壁纸",
            type: "wallpaper",
            clip: "frame",
            blur: 0,
            blendMode: "normal",
        },
    ];
}

function slugifyPreset(title: string): string {
    return title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
}

/** Build a fresh, valid v1 wallpaper config from a device preset. */
export function createWallpaperConfig(preset: WallpaperDevicePreset): WallpaperConfigRaw {
    const baseKey = `${preset.id}-base`;
    const layerKey = `${preset.id}-default`;
    const templateId = `${preset.id}-default`;
    const frame = {
        x: 0,
        y: 0,
        width: preset.width,
        height: preset.height,
        radius: preset.frameRadius ?? 0,
    };

    const base: Record<string, unknown> = {
        watchface: { name: preset.title, previewKey: slugifyPreset(preset.title) },
        canvas: { background: "transparent" },
        wallpaperTransform: {
            scale: defaultScaleControl(),
            rotation: defaultRotationControl(),
        },
    };

    const layer: Record<string, unknown> = {
        extends: baseKey,
        canvas: { width: preset.width, height: preset.height },
        frame,
        preview: { radius: preset.previewRadius },
        layers: defaultLayers(),
    };

    return {
        version: 1,
        shared: {
            [baseKey]: base,
            [layerKey]: layer,
        },
        templates: [
            {
                id: templateId,
                extends: layerKey,
                deviceKey: preset.id,
                aliases: [],
            },
        ],
    };
}

/** Duplicate a template config (deep copy) with a fresh id. */
export function duplicateTemplate(template: WallpaperTemplateConfig): WallpaperTemplateConfig {
    return JSON.parse(JSON.stringify(template)) as WallpaperTemplateConfig;
}

export function generateTemplateId(base: string): string {
    const safe = base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return `${safe || "wallpaper"}-${Date.now().toString(36)}`;
}

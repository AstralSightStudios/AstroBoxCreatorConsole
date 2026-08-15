export type WallpaperLayerKind = "wallpaper" | "asset" | "tint" | "text";

export interface WallpaperControlConfig {
    default: number;
    min?: number;
    max?: number;
    step?: number;
    adjustable?: boolean;
}

export type WallpaperControlValue = number | WallpaperControlConfig;

export interface WallpaperColorControlConfig {
    default: string;
    adjustable?: boolean;
    options?: string[];
    allowCustom?: boolean;
}

export interface WallpaperBlendControlConfig {
    default: string;
    adjustable?: boolean;
    options?: string[];
}

export interface WallpaperRectConfig {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export interface WallpaperTransformConfig {
    x?: number;
    y?: number;
    scale?: number;
    rotation?: number;
}

export interface WallpaperFontOptionConfig {
    id: string;
    name?: string;
    family?: string;
    src?: string;
}

export interface WallpaperFontControlConfig {
    default: string;
    adjustable?: boolean;
    options?: WallpaperFontOptionConfig[];
}

export interface WallpaperTextBoxConfig {
    x?: WallpaperControlValue;
    y?: WallpaperControlValue;
    width?: WallpaperControlValue;
    height?: WallpaperControlValue;
}

export interface WallpaperTextConfig {
    content?: string | { default: string; adjustable?: boolean };
    maxLength?: number;
    textBox?: WallpaperTextBoxConfig;
    font?: string | WallpaperFontControlConfig;
    fontSize?: WallpaperControlValue;
    fontWeight?: WallpaperControlValue;
    color?: string | WallpaperColorControlConfig;
    letterSpacing?: WallpaperControlValue;
    lineHeight?: WallpaperControlValue;
    textAlign?: string | { default: string; adjustable?: boolean; options?: string[] };
    verticalAlign?: string | { default: string; adjustable?: boolean; options?: string[] };
}

export interface WallpaperRecolorGroupConfig {
    id: string;
    name?: string;
    source: string;
    default?: string;
    options?: string[];
    tolerance?: number;
    adjustable?: boolean;
}

export interface WallpaperLayerConfig {
    id: string;
    name?: string;
    type: WallpaperLayerKind;
    src?: string;
    mask?: string;
    clip?: "frame" | "canvas";
    /** 多设备同步（编辑器专用字段）：透明度/模糊/背景模糊/混合模式 应用到所有设备。 */
    syncAcrossDevices?: boolean;
    rect?: WallpaperRectConfig;
    transform?: WallpaperTransformConfig;
    opacity?: WallpaperControlValue;
    blur?: WallpaperControlValue;
    backdropBlur?: WallpaperControlValue;
    blendMode?: string | WallpaperBlendControlConfig;
    amount?: WallpaperControlValue;
    lightColor?: string;
    darkColor?: string;
    color?: string | WallpaperColorControlConfig;
    text?: WallpaperTextConfig;
    recolor?: {
        enabled?: boolean;
        groups?: WallpaperRecolorGroupConfig[];
    };
}

export interface WallpaperWatchfaceConfig {
    name?: string;
    previewKey?: string;
}

export interface WallpaperTemplateConfig {
    id: string;
    extends?: string | string[];
    watchface?: WallpaperWatchfaceConfig;
    deviceKey?: string;
    aliases?: string[];
    canvas?: { width?: number; height?: number; background?: string };
    frame?: { x?: number; y?: number; width?: number; height?: number; radius?: number };
    preview?: { radius?: number };
    wallpaperTransform?: {
        scale?: WallpaperControlValue;
        rotation?: WallpaperControlValue;
    };
    layers?: WallpaperLayerConfig[];
}

export interface WallpaperConfigRaw {
    version: 1;
    shared?: Record<string, Record<string, unknown>>;
    templates: WallpaperTemplateConfig[];
}

export interface WallpaperAssetFile {
    /** Repo-relative path under the resource repo, e.g. `wallpaper/assets/foo.png`. */
    path: string;
    /** Object URL (new upload) or absolute http(s) url (already in repo). */
    url: string;
    /** Present when the user just picked a local file that is not yet committed. */
    file?: File;
    /** True when the file already exists in the resource repo. */
    skipUpload?: boolean;
}

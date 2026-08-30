export type WallpaperLayerKind = "wallpaper" | "asset" | "tint" | "text" | "glass";

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

/** 图层通用混合模式（CSS 16 模式，与引擎支持范围一致）。 */
export const LAYER_BLEND_MODES = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
] as const;

export type WallpaperLayerBlendMode = (typeof LAYER_BLEND_MODES)[number];

export interface WallpaperBlendControlConfig {
    default: string;
    adjustable?: boolean;
    options?: string[];
}

export function createWallpaperBlendControl(
    defaultValue: WallpaperLayerBlendMode = "normal",
): WallpaperBlendControlConfig {
    return {
        default: defaultValue,
        adjustable: true,
        options: [...LAYER_BLEND_MODES],
    };
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
    /** 玻璃层专用：非等比缩放。 */
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    /** 图片素材专用：以原始素材为基准进行镜像。 */
    flipX?: boolean;
    flipY?: boolean;
    /** 编辑器专用：镜像变体对应的原始素材路径。 */
    mirrorSource?: string;
}

export interface WallpaperFontAxisConfig {
    /** 4 字符轴标签，如 "wght"、"wdth"、"slnt"、"ital"、"opsz"、"GRAD"。 */
    tag: string;
    name?: string;
    min: number;
    max: number;
    /** 创作者选择的默认值（初始 = 字体设计默认值）。 */
    default: number;
}

export interface WallpaperFontOptionConfig {
    id: string;
    name?: string;
    family?: string;
    src?: string;
    axes?: WallpaperFontAxisConfig[];
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

export interface WallpaperRecolorGroupConfig {
    id: string;
    name?: string;
    source: string;
    default?: string;
    options?: string[];
    tolerance?: number;
    adjustable?: boolean;
}

export type WallpaperGlassGeometryConfig =
    | {
          type: "rounded-rect";
          width: number;
          height: number;
          radius: number;
      }
    | {
          type: "circle";
          /** 圆形实际直径（壁纸文档像素）。 */
          diameter: number;
      };

/** 玻璃高光 / 描边支持混合模式（CSS 模式 + Figma Linear 模式）。 */
export const GLASS_BLEND_MODES = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "linear-dodge",
    "linear-burn",
] as const;

export type WallpaperGlassBlendMode = (typeof GLASS_BLEND_MODES)[number];

/** 玻璃材质（均为壁纸 document 像素 / 归一化值，与引擎 LiquidGlassMaterialConfig 对齐）。 */
export interface WallpaperGlassMaterialConfig {
    /** backdrop blur（UI [0,100]）：映射为 blur radius 与 mix 强度。 */
    blur: number;
    /** 折射艺术乘子（0=关闭，1=基础光学，2=两倍增强）。 */
    refraction: number;
    /** 玻璃物理高度 / bevel 高度（document px）。 */
    thickness: number;
    /** 色散强度：最强边缘处 R/B 通道分离量（document px）。 */
    dispersion: number;
    saturation: number;
    /** 对比度（(c-0.5)*contrast+0.5）。 */
    contrast: number;
    highlight: number;
    shadow: number;
    /** 高光（Fresnel + specular）混合模式（默认 linear-dodge）。 */
    highlightBlendMode: WallpaperGlassBlendMode;
    /** 描边 / 内阴影混合模式（默认 linear-burn）。 */
    shadowBlendMode: WallpaperGlassBlendMode;
    /** 打光角度（度，[0,360]）：对共享基线光照绕 Z 轴旋转，默认 0。 */
    lightAngle: number;
    tint: string;
    tintOpacity: number;
    /** 高级：bevel 宽度覆盖（0=自动 plateau）。 */
    bezelWidth: number;
    /** 内部：折射率。 */
    ior: number;
    /** 内部：光学厚度比例。 */
    opticalScale: number;
    /** 内部：表面轮廓。 */
    surfaceProfile: "apple" | "bubble";
    /** 内部：折射采样方向。 */
    refractionSign: 1 | -1;
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
    /** 文字图层（平铺字段，与引擎解析一致）。 */
    content?: string | { default: string; adjustable?: boolean };
    maxLength?: number;
    textBox?: WallpaperTextBoxConfig;
    font?: string | WallpaperFontControlConfig;
    fontSize?: WallpaperControlValue;
    fontWeight?: WallpaperControlValue;
    letterSpacing?: WallpaperControlValue;
    lineHeight?: WallpaperControlValue;
    textAlign?: string | { default: string; adjustable?: boolean; options?: string[] };
    verticalAlign?: string | { default: string; adjustable?: boolean; options?: string[] };
    recolor?: {
        enabled?: boolean;
        groups?: WallpaperRecolorGroupConfig[];
    };
    /** 玻璃层（liquid glass）：字段平铺在图层上（与引擎 parseGlass 读取的原始 JSON 形状一致）。 */
    visible?: boolean;
    geometry?: WallpaperGlassGeometryConfig;
    material?: WallpaperGlassMaterialConfig;
}

/** 玻璃材质默认值（与引擎 config 的 GLASS_MATERIAL_DEFAULTS 一致）。 */
export const GLASS_MATERIAL_DEFAULTS: WallpaperGlassMaterialConfig = {
    blur: 52,
    refraction: 0.7,
    thickness: 30,
    dispersion: 0.2,
    saturation: 1,
    contrast: 1,
    highlight: 0.25,
    shadow: 0.45,
    highlightBlendMode: "linear-dodge",
    shadowBlendMode: "linear-burn",
    lightAngle: 0,
    tint: "#1a1a1a",
    tintOpacity: 0.7,
    bezelWidth: 0,
    ior: 1.45,
    opticalScale: 0.6,
    surfaceProfile: "apple",
    refractionSign: -1,
};

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

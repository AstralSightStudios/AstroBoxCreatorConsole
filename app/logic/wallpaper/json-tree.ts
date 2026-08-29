import { expandWallpaperTemplateForEditing } from "@claralight-design/wallpaper-engine";
import type {
    WallpaperConfigRaw,
    WallpaperLayerConfig,
    WallpaperTemplateConfig,
} from "./types";
import { LAYER_BLEND_MODES } from "./types";

export function cloneConfig<T>(config: T): T {
    return JSON.parse(JSON.stringify(config)) as T;
}

/** 将 0.2.x 圆形玻璃半径迁移为 0.3.1 使用的实际直径。 */
export function migrateWallpaperConfigForEngine031(
    config: WallpaperConfigRaw,
): WallpaperConfigRaw {
    const next = cloneConfig(config);
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        const geometry = record.geometry;
        if (
            record.type === "glass" &&
            geometry &&
            typeof geometry === "object" &&
            (geometry as Record<string, unknown>).type === "circle"
        ) {
            const circle = geometry as Record<string, unknown>;
            if (
                circle.diameter === undefined &&
                typeof circle.radius === "number" &&
                Number.isFinite(circle.radius)
            ) {
                record.geometry = {
                    type: "circle",
                    diameter: Math.max(1, circle.radius * 2),
                };
            }
        }
        Object.values(record).forEach(visit);
    };
    visit(next);
    return next;
}

/** Expand the `shared` inheritance for one template (read-only). */
export function getExpandedTemplate(
    config: WallpaperConfigRaw,
    index: number,
): WallpaperTemplateConfig {
    if (index < 0 || index >= (config.templates?.length ?? 0)) {
        return {} as WallpaperTemplateConfig;
    }
    const expanded = expandWallpaperTemplateForEditing(config, index);
    const result = expanded ?? config.templates[index];
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        return {} as WallpaperTemplateConfig;
    }
    return result as WallpaperTemplateConfig;
}

/** Inline all inherited `shared` fields into the template so later edits are predictable. */
export function flattenTemplate(config: WallpaperConfigRaw, index: number): WallpaperConfigRaw {
    if (index < 0 || index >= config.templates.length) return config;
    const current = config.templates[index];
    if (current.extends === undefined && !config.shared) return config;
    const expanded = expandWallpaperTemplateForEditing(config, index);
    if (!expanded) return config;
    const next = cloneConfig(config);
    next.templates[index] = expanded as unknown as WallpaperTemplateConfig;
    return next;
}

function withFlattened(config: WallpaperConfigRaw, index: number): WallpaperConfigRaw {
    return flattenTemplate(config, index);
}

/** Inline shared inheritance for every template (used when loading existing resources). */
export function flattenAllTemplates(config: WallpaperConfigRaw): WallpaperConfigRaw {
    let next = cloneConfig(config);
    for (let index = 0; index < next.templates.length; index++) {
        next = flattenTemplate(next, index);
    }
    return next;
}

export function updateTemplate(
    config: WallpaperConfigRaw,
    index: number,
    patch: Partial<WallpaperTemplateConfig>,
): WallpaperConfigRaw {
    if (index < 0 || index >= config.templates.length) return config;
    const next = withFlattened(config, index);
    next.templates[index] = {
        ...next.templates[index],
        ...patch,
    } as WallpaperTemplateConfig;
    return next;
}

export function removeTemplate(config: WallpaperConfigRaw, index: number): WallpaperConfigRaw {
    if (index < 0 || index >= config.templates.length) return config;
    const next = cloneConfig(config);
    next.templates.splice(index, 1);
    return next;
}

export function addTemplate(
    config: WallpaperConfigRaw,
    template: WallpaperTemplateConfig,
    at?: number,
): WallpaperConfigRaw {
    const next = cloneConfig(config);
    const insertAt = at === undefined ? next.templates.length : Math.max(0, Math.min(at, next.templates.length));
    next.templates.splice(insertAt, 0, template);
    return next;
}

export function duplicateTemplateAt(config: WallpaperConfigRaw, index: number): WallpaperConfigRaw {
    if (index < 0 || index >= config.templates.length) return config;
    const source = config.templates[index];
    const copy = JSON.parse(JSON.stringify(source)) as WallpaperTemplateConfig;
    copy.id = `${source.id}-copy-${Date.now().toString(36)}`;
    const next = cloneConfig(config);
    next.templates.splice(index + 1, 0, copy);
    return next;
}

export function getLayer(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layerId: string,
): WallpaperLayerConfig | undefined {
    const template = getExpandedTemplate(config, templateIndex);
    return template.layers?.find((layer) => layer.id === layerId);
}

function cloneLayer(layer: WallpaperLayerConfig): WallpaperLayerConfig {
    return JSON.parse(JSON.stringify(layer)) as WallpaperLayerConfig;
}

/**
 * 把某图层同步到所有模板：已存在的原地应用 patch；不存在的（且 createMissing 为真）
 * 从 sourceLayer 复制一份创建后再应用 patch。用于多设备同步。
 */
export function syncLayerAcrossTemplates(
    config: WallpaperConfigRaw,
    layerId: string,
    sourceLayer: WallpaperLayerConfig | undefined,
    patch: Partial<WallpaperLayerConfig>,
    createMissing: boolean,
): WallpaperConfigRaw {
    let next = config;
    for (let index = 0; index < next.templates.length; index++) {
        if (getLayer(next, index, layerId)) {
            next = updateLayer(next, index, layerId, patch);
        } else if (createMissing && sourceLayer) {
            next = addLayer(next, index, cloneLayer(sourceLayer));
            next = updateLayer(next, index, layerId, patch);
        }
    }
    return next;
}

export function updateLayer(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layerId: string,
    patch: Partial<WallpaperLayerConfig>,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    const layers = template.layers ?? [];
    const idx = layers.findIndex((layer) => layer.id === layerId);
    if (idx < 0) return config;
    layers[idx] = { ...layers[idx], ...patch };
    template.layers = layers;
    return next;
}

export function addLayer(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layer: WallpaperLayerConfig,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    const blendMode = layer.blendMode;
    const nextLayer =
        blendMode &&
        typeof blendMode === "object" &&
        blendMode.adjustable === true &&
        (!Array.isArray(blendMode.options) || blendMode.options.length === 0)
            ? {
                  ...layer,
                  blendMode: { ...blendMode, options: [...LAYER_BLEND_MODES] },
              }
            : layer;
    template.layers = [...(template.layers ?? []), nextLayer];
    return next;
}

export function removeLayer(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layerId: string,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    template.layers = (template.layers ?? []).filter((layer) => layer.id !== layerId);
    return next;
}

export function moveLayer(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layerId: string,
    direction: -1 | 1,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    const layers = [...(template.layers ?? [])];
    const idx = layers.findIndex((layer) => layer.id === layerId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= layers.length) return config;
    const [moved] = layers.splice(idx, 1);
    layers.splice(target, 0, moved);
    template.layers = layers;
    return next;
}

/** Move a layer so it lands at `toIndex` (insertion index of the resulting array). */
export function moveLayerToIndex(
    config: WallpaperConfigRaw,
    templateIndex: number,
    layerId: string,
    toIndex: number,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    const layers = [...(template.layers ?? [])];
    const from = layers.findIndex((layer) => layer.id === layerId);
    if (from < 0) return config;
    const [moved] = layers.splice(from, 1);
    const insertAt = Math.max(0, Math.min(toIndex, layers.length));
    layers.splice(insertAt, 0, moved);
    template.layers = layers;
    return next;
}

export function updateWallpaperTransform(
    config: WallpaperConfigRaw,
    templateIndex: number,
    patch: Record<string, unknown>,
): WallpaperConfigRaw {
    const next = withFlattened(config, templateIndex);
    const template = next.templates[templateIndex];
    template.wallpaperTransform = {
        ...(template.wallpaperTransform ?? {}),
        ...patch,
    };
    return next;
}

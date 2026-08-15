import type { WallpaperControlConfig, WallpaperControlValue } from "./types";

export function isControlObject(value: unknown): value is WallpaperControlConfig {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFinite(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function controlDefault(
    value: WallpaperControlValue | undefined,
    fallback: number,
): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
    if (isControlObject(value)) return toFinite(value.default) ?? fallback;
    return fallback;
}

export function controlMin(
    value: WallpaperControlValue | undefined,
    fallback: number,
): number {
    return toFinite(isControlObject(value) ? value.min : undefined) ?? fallback;
}

export function controlMax(
    value: WallpaperControlValue | undefined,
    fallback: number,
): number {
    return toFinite(isControlObject(value) ? value.max : undefined) ?? fallback;
}

export function controlStep(
    value: WallpaperControlValue | undefined,
    fallback: number,
): number {
    return toFinite(isControlObject(value) ? value.step : undefined) ?? fallback;
}

export function controlAdjustable(value: WallpaperControlValue | undefined): boolean {
    if (!isControlObject(value)) return false;
    return value.adjustable === true;
}

/** Produce a new control value with one field patched, keeping `number` shorthand. */
export function patchControl(
    value: WallpaperControlValue | undefined,
    key: keyof WallpaperControlConfig,
    next: number | boolean,
): WallpaperControlValue {
    const current = isControlObject(value)
        ? value
        : { default: toFinite(typeof value === "number" ? value : undefined) ?? 0 };
    const patched: WallpaperControlConfig = { ...current, [key]: next };
    if (key === "default" && !isControlObject(value)) {
        return toFinite(next) ?? 0;
    }
    return patched;
}

export function patchControlValue(
    value: WallpaperControlValue | undefined,
    patch: Partial<WallpaperControlConfig>,
): WallpaperControlValue {
    const current = isControlObject(value)
        ? value
        : { default: toFinite(typeof value === "number" ? value : undefined) ?? 0 };
    const merged: WallpaperControlConfig = { ...current };
    for (const key of ["default", "min", "max", "step"] as const) {
        const next = toFinite(patch[key]);
        if (next !== undefined) merged[key] = next;
    }
    if (patch.adjustable !== undefined) merged.adjustable = patch.adjustable;

    const min = toFinite(merged.min);
    const max = toFinite(merged.max);
    if (min !== undefined && max !== undefined && min > max) {
        if (patch.min !== undefined) {
            merged.max = min;
        } else if (patch.max !== undefined) {
            merged.min = max;
        }
    }

    if (patch.default !== undefined && !isControlObject(value)) {
        return toFinite(patch.default) ?? 0;
    }
    return merged;
}

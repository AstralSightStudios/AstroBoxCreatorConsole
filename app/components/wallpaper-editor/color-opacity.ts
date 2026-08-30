export interface EditorColorOpacityValue {
    color: string;
    opacity: number;
}

const HEX_COLOR_PATTERN = /^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const RGB_COLOR_PATTERN = /^rgba?\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+?)(?:\s*,\s*([^,]+))?\s*\)$/i;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function expandHex(value: string) {
    return value
        .split("")
        .map((character) => `${character}${character}`)
        .join("");
}

function parseRgbChannel(value: string) {
    const trimmed = value.trim();
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(clamp(trimmed.endsWith("%") ? parsed * 2.55 : parsed, 0, 255));
}

function parseOpacity(value: string | undefined) {
    if (value === undefined) return 1;
    const trimmed = value.trim();
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return clamp(trimmed.endsWith("%") ? parsed / 100 : parsed, 0, 1);
}

function toHexChannel(value: number) {
    return value.toString(16).padStart(2, "0").toUpperCase();
}

function parseSupportedColor(value: string): EditorColorOpacityValue | null {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "transparent") {
        return { color: "#FFFFFF", opacity: 0 };
    }

    const hexMatch = trimmed.match(HEX_COLOR_PATTERN);
    if (hexMatch) {
        const compact = hexMatch[1];
        const expanded = compact.length <= 4 ? expandHex(compact) : compact;
        const color = `#${expanded.slice(0, 6).toUpperCase()}`;
        const alpha = expanded.length === 8
            ? Number.parseInt(expanded.slice(6, 8), 16) / 255
            : 1;
        return { color, opacity: alpha };
    }

    const rgbMatch = trimmed.match(RGB_COLOR_PATTERN);
    if (!rgbMatch) return null;
    const red = parseRgbChannel(rgbMatch[1]);
    const green = parseRgbChannel(rgbMatch[2]);
    const blue = parseRgbChannel(rgbMatch[3]);
    const opacity = parseOpacity(rgbMatch[4]);
    if (red === null || green === null || blue === null || opacity === null) return null;

    return {
        color: `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`,
        opacity,
    };
}

function resolveBrowserColor(value: string) {
    if (typeof document === "undefined") return null;
    if (typeof CSS !== "undefined" && !CSS.supports("color", value)) return null;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    context.fillStyle = value;
    return parseSupportedColor(context.fillStyle);
}

export function normalizeEditorHexColor(value: string, fallback = "#FFFFFF") {
    const parsed = parseSupportedColor(value);
    return parsed?.color ?? fallback;
}

export function parseEditorColorOpacity(
    value: string,
    fallback = "#FFFFFF",
): EditorColorOpacityValue {
    return parseSupportedColor(value)
        ?? resolveBrowserColor(value)
        ?? { color: normalizeEditorHexColor(fallback), opacity: 1 };
}

export function formatEditorColorOpacity(color: string, opacity: number) {
    const normalizedColor = normalizeEditorHexColor(color);
    const normalizedOpacity = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
    if (normalizedOpacity >= 1) return normalizedColor;
    return `${normalizedColor}${toHexChannel(Math.round(normalizedOpacity * 255))}`;
}

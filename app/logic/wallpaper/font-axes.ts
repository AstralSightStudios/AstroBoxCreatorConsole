import type { WallpaperFontAxisConfig } from "./types";

/**
 * 解析 ttf/otf 字体的 OpenType fvar 表，提取可变字体轴。
 * woff/woff2（需解压）、ttc（多字体集合）无法直接解析，返回空数组。
 */
export function parseFontAxes(buffer: ArrayBuffer): WallpaperFontAxisConfig[] {
    const data = new DataView(buffer);
    if (data.byteLength < 12) return [];
    const tag = readTag(data, 0);
    const isSfnt = tag === "\u0000\u0001\u0000\u0000" || tag === "true" || tag === "OTTO";
    if (!isSfnt) return [];

    const numTables = data.getUint16(4);
    const fvar = findTable(data, numTables, "fvar");
    if (!fvar) return [];

    const axesCount = data.getUint16(fvar.offset + 8);
    const axisSize = data.getUint16(fvar.offset + 10);
    if (axesCount <= 0 || axesCount > 64) return [];
    if (axisSize < 20) return [];

    const tableEnd = fvar.offset + fvar.length;
    // fvar 头部固定 16 字节（version 4 + offsetToData 2 + countSizePairs 2 + axisCount 2 + axisSize 2 + instanceSize 2 + flags 2），轴记录紧随其后。
    const axesStart = fvar.offset + 16;
    const axes: WallpaperFontAxisConfig[] = [];
    for (let index = 0; index < axesCount; index++) {
        const base = axesStart + index * axisSize;
        if (base + 20 > tableEnd) break;
        const tagValue = readTag(data, base);
        if (!tagValue || /[\u0000-\u001f]/.test(tagValue)) continue;
        const min = readF16Dot16(data, base + 4);
        const defaultValue = readF16Dot16(data, base + 8);
        const max = readF16Dot16(data, base + 12);
        if (!Number.isFinite(min) || !Number.isFinite(defaultValue) || !Number.isFinite(max)) continue;
        axes.push({
            tag: tagValue,
            name: AXIS_NAMES[tagValue],
            min,
            max,
            default: clamp(defaultValue, min, max),
        });
    }
    return axes;
}

const AXIS_NAMES: Record<string, string> = {
    wght: "字重",
    wdth: "宽度",
    slnt: "倾斜",
    ital: "斜体",
    opsz: "光学尺寸",
    GRAD: "渐变",
};

function findTable(
    data: DataView,
    numTables: number,
    target: string,
): { offset: number; length: number } | null {
    for (let index = 0; index < numTables; index++) {
        const base = 12 + index * 16;
        if (base + 16 > data.byteLength) break;
        if (readTag(data, base) !== target) continue;
        const offset = data.getUint32(base + 8);
        const length = data.getUint32(base + 12);
        if (offset + length > data.byteLength) return null;
        return { offset, length };
    }
    return null;
}

function readTag(data: DataView, offset: number): string {
    if (offset + 4 > data.byteLength) return "";
    return String.fromCharCode(
        data.getUint8(offset),
        data.getUint8(offset + 1),
        data.getUint8(offset + 2),
        data.getUint8(offset + 3),
    );
}

/** 16.16 定点数。 */
function readF16Dot16(data: DataView, offset: number): number {
    return data.getInt32(offset) / 65536;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

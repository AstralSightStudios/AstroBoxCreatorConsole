import { describe, expect, test } from "bun:test";
import { parseFontAxes } from "../../app/logic/wallpaper/font-axes";

function buildSfntWithFvar(axes: Array<{ tag: string; min: number; def: number; max: number }>): ArrayBuffer {
    const axisBytes = axes.length * 20;
    const fvarLength = 16 + axisBytes; // 16 字节表头 + 轴记录
    const fvarOffset = 12 + 16; // sfnt header(12) + 1 table record(16)
    const total = fvarOffset + fvarLength;
    const buffer = new Uint8Array(total);
    const view = new DataView(buffer.buffer);
    buffer.set([0, 1, 0, 0], 0); // 0x00010000
    view.setUint16(4, 1); // numTables
    buffer.set([0x66, 0x76, 0x61, 0x72], 12); // "fvar"
    view.setUint32(12 + 8, fvarOffset);
    view.setUint32(12 + 12, fvarLength);
    view.setUint32(fvarOffset, 0x00010000); // version
    view.setUint16(fvarOffset + 4, 16); // offsetToData
    view.setUint16(fvarOffset + 6, 2); // countSizePairs
    view.setUint16(fvarOffset + 8, axes.length); // axisCount
    view.setUint16(fvarOffset + 10, 20); // axisSize
    view.setUint16(fvarOffset + 12, 4); // instanceSize
    view.setUint16(fvarOffset + 14, 0); // flags
    axes.forEach((axis, index) => {
        const base = fvarOffset + 16 + index * 20;
        buffer.set(Array.from(axis.tag, (ch) => ch.charCodeAt(0)), base);
        view.setInt32(base + 4, Math.round(axis.min * 65536));
        view.setInt32(base + 8, Math.round(axis.def * 65536));
        view.setInt32(base + 12, Math.round(axis.max * 65536));
        view.setUint16(base + 16, 0);
        view.setUint16(base + 18, 256 + index);
    });
    return buffer.buffer;
}

describe("wallpaper font axes (fvar parser)", () => {
    test("parses wght + wdth axes from a ttf sfnt", () => {
        const buffer = buildSfntWithFvar([
            { tag: "wght", min: 100, def: 400, max: 900 },
            { tag: "wdth", min: 50, def: 100, max: 200 },
        ]);
        const axes = parseFontAxes(buffer);
        expect(axes).toEqual([
            { tag: "wght", name: "字重", min: 100, max: 900, default: 400 },
            { tag: "wdth", name: "宽度", min: 50, max: 200, default: 100 },
        ]);
    });

    test("clamps default into [min, max]", () => {
        const buffer = buildSfntWithFvar([{ tag: "wght", min: 100, def: 50, max: 900 }]);
        const axes = parseFontAxes(buffer);
        expect(axes[0].default).toBe(100);
    });

    test("handles fractional slnt axis", () => {
        const buffer = buildSfntWithFvar([{ tag: "slnt", min: -10, def: 0, max: 10 }]);
        const axes = parseFontAxes(buffer);
        expect(axes[0].tag).toBe("slnt");
        expect(axes[0].min).toBeCloseTo(-10, 2);
        expect(axes[0].default).toBeCloseTo(0, 2);
    });

    test("returns empty for woff / garbage", () => {
        const woff = new Uint8Array(64);
        woff.set([0x77, 0x4f, 0x46, 0x46], 0); // "wOFF"
        expect(parseFontAxes(woff.buffer)).toEqual([]);
        expect(parseFontAxes(new Uint8Array([1, 2, 3]).buffer)).toEqual([]);
        expect(parseFontAxes(new ArrayBuffer(0))).toEqual([]);
    });

    test("ignores non-sfnt or missing fvar tables", () => {
        const buffer = new Uint8Array(12 + 16 + 4);
        buffer.set([0, 1, 0, 0], 0);
        buffer.set([0x67, 0x6c, 0x79, 0x66], 12); // "glyf" instead of fvar
        expect(parseFontAxes(buffer.buffer)).toEqual([]);
    });
});

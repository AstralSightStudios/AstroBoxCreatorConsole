import { describe, expect, test } from "bun:test";
import {
    formatEditorColorOpacity,
    parseEditorColorOpacity,
} from "../../app/components/wallpaper-editor/color-opacity";

describe("editor color opacity", () => {
    test("parses transparent and hexadecimal alpha colors", () => {
        expect(parseEditorColorOpacity("transparent")).toEqual({
            color: "#FFFFFF",
            opacity: 0,
        });
        expect(parseEditorColorOpacity("#3698")).toEqual({
            color: "#336699",
            opacity: 136 / 255,
        });
        expect(parseEditorColorOpacity("#11223380")).toEqual({
            color: "#112233",
            opacity: 128 / 255,
        });
    });

    test("parses rgb colors and percentage opacity", () => {
        expect(parseEditorColorOpacity("rgba(255, 128, 0, 25%)")).toEqual({
            color: "#FF8000",
            opacity: 0.25,
        });
    });

    test("serializes opacity into an eight-digit hexadecimal color", () => {
        expect(formatEditorColorOpacity("#336699", 1)).toBe("#336699");
        expect(formatEditorColorOpacity("#336699", 0.5)).toBe("#33669980");
        expect(formatEditorColorOpacity("#336699", 0)).toBe("#33669900");
    });
});

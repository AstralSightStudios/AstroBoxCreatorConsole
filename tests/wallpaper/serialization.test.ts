import { describe, expect, test } from "bun:test";
import { normalizeWallpaperConfig } from "@claralight-design/wallpaper-engine";
import { createWallpaperConfig, WALLPAPER_DEVICE_PRESETS } from "../../app/logic/wallpaper/presets";
import {
    addLayer,
    flattenAllTemplates,
    getExpandedTemplate,
    moveLayer,
    moveLayerToIndex,
    removeLayer,
    updateLayer,
    updateWallpaperTransform,
} from "../../app/logic/wallpaper/json-tree";import {
    collectConfigAssetPaths,
    configPathToRepoPath,
    repoPathToConfigPath,
} from "../../app/logic/wallpaper/load-resources";
import {
    controlAdjustable,
    controlDefault,
    controlMax,
    controlMin,
    controlStep,
    patchControl,
    patchControlValue,
} from "../../app/logic/wallpaper/control";
import type { WallpaperConfigRaw, WallpaperLayerConfig } from "../../app/logic/wallpaper/types";

const preset = WALLPAPER_DEVICE_PRESETS[0];

function validConfig(): WallpaperConfigRaw {
    return createWallpaperConfig(preset);
}

describe("wallpaper preset", () => {
    test("creates a v1 config that the engine accepts", () => {
        const config = validConfig();
        expect(config.version).toBe(1);
        expect(config.templates).toHaveLength(1);
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
    });

    test("expanded template exposes inherited layers and controls", () => {
        const config = validConfig();
        const template = getExpandedTemplate(config, 0);
        expect(template.id).toBe(`${preset.id}-default`);
        expect(template.canvas?.width).toBe(preset.width);
        expect(template.canvas?.height).toBe(preset.height);
        expect(template.layers?.some((layer) => layer.type === "wallpaper")).toBe(true);
        expect(template.wallpaperTransform?.scale).toBeDefined();
        expect(template.wallpaperTransform?.rotation).toBeDefined();
    });
});

describe("wallpaper json-tree", () => {
    test("add/remove/reorder layers keeps config valid", () => {
        let config = validConfig();
        const tint: WallpaperLayerConfig = {
            id: "tint-1",
            name: "明暗层",
            type: "tint",
            amount: { default: 0, min: -1, max: 1, step: 0.01, adjustable: true },
            lightColor: "#ffffff",
            darkColor: "#000000",
        };
        config = addLayer(config, 0, tint);
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
        expect(getExpandedTemplate(config, 0).layers?.length).toBe(2);

        config = updateLayer(config, 0, "tint-1", { amount: 0.5 });
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
        expect(getExpandedTemplate(config, 0).layers?.find((l) => l.id === "tint-1")?.amount).toBe(0.5);

        config = moveLayer(config, 0, "tint-1", -1);
        const layers = getExpandedTemplate(config, 0).layers ?? [];
        expect(layers[0].id).toBe("tint-1");

        config = removeLayer(config, 0, "tint-1");
        expect(getExpandedTemplate(config, 0).layers?.length).toBe(1);
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
    });

    test("moveLayerToIndex relocates to absolute position", () => {
        const withIds = (ids: string[]) => {
            const cfg = flattenAllTemplates(validConfig());
            cfg.templates[0].layers = ids.map((id) => ({
                id,
                name: id,
                type: "wallpaper" as const,
                clip: "frame" as const,
            }));
            return cfg;
        };
        const ids = (cfg: WallpaperConfigRaw) =>
            (getExpandedTemplate(cfg, 0).layers ?? []).map((layer) => layer.id);

        expect(ids(moveLayerToIndex(withIds(["a", "b", "c"]), 0, "c", 0))).toEqual(["c", "a", "b"]);
        expect(ids(moveLayerToIndex(withIds(["a", "b", "c"]), 0, "c", 1))).toEqual(["a", "c", "b"]);
        expect(ids(moveLayerToIndex(withIds(["a", "b", "c"]), 0, "a", 2))).toEqual(["b", "c", "a"]);
        // 非法目标索引安全钳制
        expect(ids(moveLayerToIndex(withIds(["a", "b", "c"]), 0, "b", 99))).toEqual(["a", "c", "b"]);
        // 拖拽映射：展示序（反转）索引 d 对应配置序索引 L-1-d
        const cfg = withIds(["a", "b", "c"]); // 展示序 [c, b, a]
        const targetDisplayIndex = 2; // 拖到展示底部（a）
        const moved = moveLayerToIndex(cfg, 0, "c", cfg.templates[0].layers!.length - 1 - targetDisplayIndex);
        expect(ids(moved)).toEqual(["c", "a", "b"]); // 展示序变 [b, a, c]
    });

    test("flatten inlines shared inheritance", () => {
        const config = flattenAllTemplates(validConfig());
        const template = config.templates[0];
        expect(template.extends).toBeUndefined();
        expect(template.canvas?.width).toBe(preset.width);
        expect(template.layers?.length).toBeGreaterThan(0);
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
    });

    test("updateWallpaperTransform patches controls", () => {
        let config = flattenAllTemplates(validConfig());
        config = updateWallpaperTransform(config, 0, {
            scale: { default: 2, min: 1, max: 4, step: 0.01 },
        });
        const template = getExpandedTemplate(config, 0);
        expect(template.wallpaperTransform?.scale).toEqual({
            default: 2,
            min: 1,
            max: 4,
            step: 0.01,
        });
    });
});

describe("wallpaper asset paths", () => {
    test("converts between config-relative and repo paths", () => {
        expect(configPathToRepoPath("./assets/jiangge/mask.png")).toBe(
            "wallpaper/assets/jiangge/mask.png",
        );
        expect(configPathToRepoPath("assets/foo.png")).toBe("wallpaper/assets/foo.png");
        expect(repoPathToConfigPath("wallpaper/assets/jiangge/mask.png")).toBe(
            "./assets/jiangge/mask.png",
        );
        expect(repoPathToConfigPath("./wallpaper/foo.png")).toBe("./foo.png");
    });

    test("collects asset paths from expanded templates", () => {
        const config = validConfig();
        config.templates[0].layers = [
            { id: "a", name: "a", type: "asset", src: "./assets/a.png" },
            { id: "b", name: "b", type: "wallpaper", mask: "./assets/m.png" },
        ];
        const paths = collectConfigAssetPaths(config);
        expect(paths).toContain("./assets/a.png");
        expect(paths).toContain("./assets/m.png");
    });
});

describe("wallpaper control helpers", () => {
    test("reads and patches control objects", () => {
        const control = { default: 1, min: 1, max: 4, step: 0.01, adjustable: true };
        expect(controlDefault(control, 0)).toBe(1);
        expect(controlMin(control, 0)).toBe(1);
        expect(controlMax(control, 0)).toBe(4);
        expect(controlStep(control, 0)).toBe(0.01);
        expect(controlAdjustable(control)).toBe(true);
        expect(patchControlValue(control, { default: 2 })).toMatchObject({ default: 2 });
        expect(patchControlValue(2, { default: 3 })).toBe(3);
        expect(patchControl(2, "default", 5)).toBe(5);
        expect(patchControl({ default: 1, min: 0 }, "adjustable", true)).toMatchObject({
            adjustable: true,
        });
    });

    test("never produces NaN / Infinity and keeps min<=max", () => {
        const value = patchControlValue({ default: 1, min: 10, max: 20 }, { default: Number.NaN });
        expect(Number.isFinite(controlDefault(value, 0))).toBe(true);
        expect(controlDefault(value, 0)).toBe(1);

        const swapped = patchControlValue({ default: 5, min: 10, max: 20 }, { min: 50 });
        expect(controlMin(swapped, 0)).toBe(50);
        expect(controlMax(swapped, 0)).toBe(50);

        const plain = patchControlValue(Number.NaN, { default: 7 });
        expect(plain).toBe(7);
        expect(controlDefault(patchControlValue(Number.NaN, {}), 0)).toBe(0);
    });
});

describe("wallpaper defensive edge cases", () => {
    test("getExpandedTemplate is safe for garbage input", () => {
        const config = validConfig();
        expect(getExpandedTemplate(config, -1).id).toBeUndefined();
        expect(getExpandedTemplate(config, 99).id).toBeUndefined();
        const weird = { ...validConfig(), templates: ["not-an-object" as unknown] };
        expect(getExpandedTemplate(weird as unknown as WallpaperConfigRaw, 0).layers).toBeUndefined();
        const empty = { version: 1 as const, templates: [] };
        expect(getExpandedTemplate(empty, 0).id).toBeUndefined();
    });

    test("flattenAllTemplates survives cyclic shared", () => {
        const config = validConfig();
        config.shared = { a: { extends: "b" }, b: { extends: "a" } };
        config.templates[0].extends = "a";
        expect(() => flattenAllTemplates(config)).not.toThrow();
    });
});

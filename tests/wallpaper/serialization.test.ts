import { describe, expect, test } from "bun:test";
import { normalizeWallpaperConfig } from "@claralight-design/wallpaper-engine";
import { createWallpaperConfig, WALLPAPER_DEVICE_PRESETS } from "../../app/logic/wallpaper/presets";
import {
    addLayer,
    duplicateLayer,
    duplicateTemplateAt,
    flattenAllTemplates,
    getExpandedTemplate,
    migrateWallpaperConfigForEngine031,
    moveLayer,
    moveLayerToIndex,
    removeLayer,
    syncLayerAcrossTemplates,
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
    patchNumericControlValue,
} from "../../app/logic/wallpaper/control";
import {
    createWallpaperBlendControl,
    LAYER_BLEND_MODES,
} from "../../app/logic/wallpaper/types";
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
        expect(template.layers?.[0].blendMode).toEqual(createWallpaperBlendControl());
        expect(template.layers?.[0].opacity).toBe(1);
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

    test("addLayer completes options for adjustable blend mode", () => {
        const config = addLayer(validConfig(), 0, {
            id: "blend-layer",
            type: "tint",
            blendMode: { default: "normal", adjustable: true },
        });
        const layer = getExpandedTemplate(config, 0).layers?.find(
            (item) => item.id === "blend-layer",
        );
        expect(layer?.blendMode).toEqual({
            default: "normal",
            adjustable: true,
            options: [...LAYER_BLEND_MODES],
        });
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
    });

    test("duplicateLayer copies the selected layer after the source", () => {
        const config = flattenAllTemplates(validConfig());
        config.templates[0].layers = [
            { id: "wallpaper", name: "壁纸", type: "wallpaper", clip: "frame" },
            { id: "tint", name: "明暗", type: "tint", amount: 0.5 },
        ];

        const next = duplicateLayer(config, 0, "tint", "tint-copy");
        const layers = getExpandedTemplate(next, 0).layers ?? [];
        expect(layers.map((layer) => layer.id)).toEqual(["wallpaper", "tint", "tint-copy"]);
        expect(layers[2].name).toBe("明暗副本");
        expect(layers[2].amount).toBe(0.5);
        expect(() => normalizeWallpaperConfig(next, "")).not.toThrow();
    });

    test("engine 0.3.1 accepts new circle geometry and glass defaults", () => {
        const config = validConfig();
        config.templates[0].layers = [
            {
                id: "glass-1",
                type: "glass",
                geometry: { type: "circle", diameter: 120 },
                blendMode: createWallpaperBlendControl(),
            },
        ];
        const resolved = normalizeWallpaperConfig(config, "");
        expect(resolved[0].layers[0].glass?.geometry).toEqual({
            type: "circle",
            diameter: 120,
        });
    });

    test("migrates 0.2.x circle radius to 0.3.1 diameter", () => {
        const config = flattenAllTemplates(validConfig());
        config.templates[0].layers = [
            {
                id: "legacy-glass",
                type: "glass",
                geometry: { type: "circle", radius: 60 },
            } as unknown as WallpaperLayerConfig,
        ];
        const migrated = migrateWallpaperConfigForEngine031(config);
        expect(migrated.templates[0].layers?.[0].geometry).toEqual({
            type: "circle",
            diameter: 120,
        });
        expect(() => normalizeWallpaperConfig(migrated, "")).not.toThrow();
    });

    test("flat text layer schema renders real text (content/box/font/style)", () => {
        const config = validConfig();
        config.templates[0].layers = [
            {
                id: "txt-1",
                name: "文字",
                type: "text",
                content: { default: "Hello", adjustable: true },
                maxLength: 20,
                textBox: { x: 10, y: 20, width: 120, height: 40 },
                font: {
                    default: "sans-serif",
                    adjustable: true,
                    options: [
                        {
                            id: "sans-serif",
                            name: "默认字体",
                            family: "sans-serif",
                            axes: [],
                        },
                        {
                            id: "var",
                            name: "可变字体",
                            family: "Variable",
                            src: "./assets/var.ttf",
                            axes: [
                                { tag: "wght", name: "字重", min: 100, max: 900, default: 400 },
                                { tag: "wdth", name: "宽度", min: 50, max: 200, default: 100 },
                            ],
                        },
                    ],
                },
                fontSize: { default: 32, min: 8, max: 120, step: 1, adjustable: true },
                fontWeight: { default: 400, min: 100, max: 900, step: 100, adjustable: true },
                color: { default: "#ffffff", adjustable: true, allowCustom: true },
                letterSpacing: { default: 0, min: -4, max: 20, step: 1, adjustable: true },
                lineHeight: { default: 1.2, min: 0.5, max: 3, step: 0.05, adjustable: true },
                textAlign: { default: "center", adjustable: true, options: ["left", "center", "right"] },
                verticalAlign: { default: "middle", adjustable: true, options: ["top", "middle", "bottom"] },
            },
        ];
        const resolved = normalizeWallpaperConfig(config, "");
        const layer = resolved[0].layers.find((l) => l.id === "txt-1");
        expect(layer?.type).toBe("text");
        expect(layer?.text?.content.default).toBe("Hello");
        expect(layer?.text?.content.adjustable).toBe(true);
        expect(layer?.text?.maxLength).toBe(20);
        expect(layer?.text?.box.x.default).toBe(10);
        expect(layer?.text?.box.y.default).toBe(20);
        expect(layer?.text?.box.width.default).toBe(120);
        expect(layer?.text?.box.height.default).toBe(40);
        expect(layer?.text?.font.default).toBe("sans-serif");
        expect(layer?.text?.font.options.find((o) => o.id === "var")?.axes).toEqual([
            { tag: "wght", name: "字重", min: 100, max: 900, default: 400 },
            { tag: "wdth", name: "宽度", min: 50, max: 200, default: 100 },
        ]);
        expect(layer?.text?.fontSize.default).toBe(32);
        expect(layer?.text?.align.default).toBe("center");
        expect(layer?.text?.verticalAlign.default).toBe("middle");
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

    test("enabling adjustment completes a valid numeric control", () => {
        const control = patchNumericControlValue(
            undefined,
            { adjustable: true },
            { default: 1, min: 0, max: 1, step: 0.1 },
        );
        expect(control).toEqual({
            default: 1,
            min: 0,
            max: 1,
            step: 0.1,
            adjustable: true,
        });

        const config = validConfig();
        config.templates[0].layers = [
            { id: "photo", type: "wallpaper", opacity: control },
        ];
        expect(() => normalizeWallpaperConfig(config, "")).not.toThrow();
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

    test("syncLayerAcrossTemplates creates missing layers on other devices", () => {
        let cfg = validConfig();
        cfg = duplicateTemplateAt(cfg, 0);
        cfg.templates[1].id = "t2";

        const glass: WallpaperLayerConfig = {
            id: "glass",
            name: "玻璃",
            type: "asset",
            src: "./assets/glass.png",
            syncAcrossDevices: true,
            blendMode: "normal",
        };
        cfg = addLayer(cfg, 0, glass);

        const after = syncLayerAcrossTemplates(cfg, "glass", glass, { syncAcrossDevices: true }, true);
        const t0 = getExpandedTemplate(after, 0).layers ?? [];
        const t1 = getExpandedTemplate(after, 1).layers ?? [];
        expect(t0.some((l) => l.id === "glass")).toBe(true);
        const t1Glass = t1.find((l) => l.id === "glass");
        expect(t1Glass).toBeDefined();
        expect(t1Glass?.syncAcrossDevices).toBe(true);
        expect(() => normalizeWallpaperConfig(after, "")).not.toThrow();

        // createMissing=false 时不创建缺失图层
        let cfg2 = validConfig();
        cfg2 = duplicateTemplateAt(cfg2, 0);
        cfg2.templates[1].id = "t2";
        cfg2 = addLayer(cfg2, 0, glass);
        const afterNoCreate = syncLayerAcrossTemplates(
            cfg2,
            "glass",
            glass,
            { syncAcrossDevices: false },
            false,
        );
        const t1b = getExpandedTemplate(afterNoCreate, 1).layers ?? [];
        expect(t1b.some((l) => l.id === "glass")).toBe(false);
    });
});

import { describe, expect, test } from "bun:test";
import { WALLPAPER_DEVICE_PRESETS, createWallpaperConfig } from "../../app/logic/wallpaper/presets";
import {
    parseWallpaperEditorInitial,
    resolveWallpaperEditorInitial,
    saveWizardSession,
    takeWizardSession,
    updateWizardWallpaperPayload,
} from "../../app/logic/wallpaper/wizard-session";
import type { WallpaperAssetFile } from "../../app/logic/wallpaper/types";

describe("壁纸草稿接入", () => {
    test("从草稿载荷重建编辑器初始状态", () => {
        const config = createWallpaperConfig(WALLPAPER_DEVICE_PRESETS[0]);
        const assets: WallpaperAssetFile[] = [
            {
                path: "wallpaper/assets/mask.png",
                url: "blob:mask",
                skipUpload: true,
            },
        ];

        expect(
            parseWallpaperEditorInitial(
                JSON.stringify(config),
                assets,
                "https://example.com/wallpaper",
            ),
        ).toEqual({
            config,
            assets,
            baseUrl: "https://example.com/wallpaper",
        });
    });

    test("无效草稿不会打开损坏的编辑器状态", () => {
        expect(parseWallpaperEditorInitial("", [])).toBeNull();
        expect(parseWallpaperEditorInitial("{", [])).toBeNull();
        expect(parseWallpaperEditorInitial('{"version":1}', [])).toBeNull();
    });

    test("已有资源在载荷为空时继续使用远程配置", () => {
        const config = createWallpaperConfig(WALLPAPER_DEVICE_PRESETS[0]);
        const fallback = { config, assets: [], baseUrl: "https://example.com/wallpaper" };

        expect(
            resolveWallpaperEditorInitial(
                { configJson: "", assets: [] },
                fallback,
            ),
        ).toBe(fallback);
    });

    test("编辑器变化会实时写回发布向导会话", () => {
        saveWizardSession({ wallpaperPayload: { configJson: "旧配置", assets: [] } });
        const next = { configJson: "新配置", assets: [] };

        updateWizardWallpaperPayload(next);

        expect(takeWizardSession()?.wallpaperPayload).toEqual(next);
        saveWizardSession(null);
    });
});

import { describe, expect, test } from "bun:test";
import {
    createWallpaperEditorHistory,
    wallpaperEditorHistoryReducer,
} from "../../app/logic/wallpaper/editor-history";
import { createWallpaperConfig, WALLPAPER_DEVICE_PRESETS } from "../../app/logic/wallpaper/presets";

describe("壁纸编辑历史", () => {
    test("连续拖动合并为一次撤销", () => {
        const initial = createWallpaperConfig(WALLPAPER_DEVICE_PRESETS[0]);
        let state = createWallpaperEditorHistory(initial);
        state = wallpaperEditorHistoryReducer(state, {
            type: "set",
            timestamp: 1000,
            update: {
                ...initial,
                templates: initial.templates.map((template, index) =>
                    index === 0 ? { ...template, id: `${template.id}-first` } : template,
                ),
            },
        });
        state = wallpaperEditorHistoryReducer(state, {
            type: "set",
            timestamp: 1100,
            update: {
                ...initial,
                templates: initial.templates.map((template, index) =>
                    index === 0 ? { ...template, id: `${template.id}-second` } : template,
                ),
            },
        });

        expect(state.past).toHaveLength(1);
        state = wallpaperEditorHistoryReducer(state, { type: "undo" });
        expect(state.present).toBe(initial);
    });

    test("删除检查点可以独立撤销和重做", () => {
        const initial = createWallpaperConfig(WALLPAPER_DEVICE_PRESETS[0]);
        const changed = {
            ...initial,
            templates: initial.templates.map((template, index) =>
                index === 0 ? { ...template, id: `${template.id}-changed` } : template,
            ),
        };
        const deleted = {
            ...initial,
            templates: initial.templates.map((template, index) =>
                index === 0 ? { ...template, id: `${template.id}-deleted` } : template,
            ),
        };
        let state = createWallpaperEditorHistory(initial);
        state = wallpaperEditorHistoryReducer(state, {
            type: "set",
            timestamp: 1000,
            update: changed,
        });
        state = wallpaperEditorHistoryReducer(state, {
            type: "set",
            timestamp: 1100,
            update: deleted,
            checkpoint: true,
        });

        state = wallpaperEditorHistoryReducer(state, { type: "undo" });
        expect(state.present).toBe(changed);
        state = wallpaperEditorHistoryReducer(state, { type: "redo" });
        expect(state.present).toBe(deleted);
    });
});

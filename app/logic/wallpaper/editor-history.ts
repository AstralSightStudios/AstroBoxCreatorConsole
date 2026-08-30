import type { WallpaperConfigRaw } from "./types";

export type WallpaperConfigState = WallpaperConfigRaw | null;
export type WallpaperConfigUpdate =
    | WallpaperConfigState
    | ((current: WallpaperConfigState) => WallpaperConfigState);

export interface WallpaperEditorHistoryState {
    past: WallpaperConfigState[];
    present: WallpaperConfigState;
    future: WallpaperConfigState[];
    lastChangeAt: number;
}

export type WallpaperEditorHistoryAction =
    | { type: "set"; update: WallpaperConfigUpdate; timestamp: number; checkpoint?: boolean }
    | { type: "undo" }
    | { type: "redo" };

const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 250;

export function createWallpaperEditorHistory(
    initial: WallpaperConfigState,
): WallpaperEditorHistoryState {
    return { past: [], present: initial, future: [], lastChangeAt: 0 };
}

export function wallpaperEditorHistoryReducer(
    state: WallpaperEditorHistoryState,
    action: WallpaperEditorHistoryAction,
): WallpaperEditorHistoryState {
    if (action.type === "undo") {
        const previous = state.past.at(-1);
        if (previous === undefined) return state;
        return {
            past: state.past.slice(0, -1),
            present: previous,
            future: [state.present, ...state.future],
            lastChangeAt: 0,
        };
    }

    if (action.type === "redo") {
        const next = state.future[0];
        if (next === undefined) return state;
        return {
            past: [...state.past, state.present].slice(-HISTORY_LIMIT),
            present: next,
            future: state.future.slice(1),
            lastChangeAt: 0,
        };
    }

    const next = typeof action.update === "function"
        ? action.update(state.present)
        : action.update;
    if (Object.is(next, state.present)) return state;

    const mergeWithPrevious =
        action.checkpoint !== true
        && state.lastChangeAt > 0
        && action.timestamp - state.lastChangeAt <= MERGE_WINDOW_MS;

    return {
        past: mergeWithPrevious
            ? state.past
            : [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        lastChangeAt: action.timestamp,
    };
}

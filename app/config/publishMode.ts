import { useSyncExternalStore } from "react";
import { loadRepoEnvId } from "./repoEnv";

export type PublishMode = "legacy" | "staging";

export const PUBLISH_MODES: Record<
    PublishMode,
    { id: PublishMode; label: string; description: string }
> = {
    legacy: {
        id: "legacy",
        label: "旧流程",
        description: "直接修改 index_v2.csv，由人工合入。",
    },
    staging: {
        id: "staging",
        label: "新流程",
        description: "提交 tmp 单资源请求，由仓库 Action 校验并合入目录。",
    },
};

const SUBMIT_MODE_KEY = "ABCC_SUBMIT_MODE_V1";
const REVIEW_MODE_KEY = "ABCC_REVIEW_MODE_V1";

function defaultMode(): PublishMode {
    return loadRepoEnvId() === "testenv" ? "staging" : "legacy";
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedSubmitMode: PublishMode | undefined;
let cachedReviewMode: PublishMode | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readModeFromStorage(key: string): PublishMode | undefined {
    if (!isBrowser()) return undefined;
    const raw = localStorage.getItem(key);
    if (raw === "legacy" || raw === "staging") return raw;
    return undefined;
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === SUBMIT_MODE_KEY) {
            cachedSubmitMode = readModeFromStorage(SUBMIT_MODE_KEY);
        }
        if (!event.key || event.key === REVIEW_MODE_KEY) {
            cachedReviewMode = readModeFromStorage(REVIEW_MODE_KEY);
        }
        notifySubscribers();
    });
    storageListenerAttached = true;
}

export function loadSubmitMode(): PublishMode {
    if (!cachedSubmitMode) {
        cachedSubmitMode = readModeFromStorage(SUBMIT_MODE_KEY) ?? defaultMode();
    }
    return cachedSubmitMode;
}

export function saveSubmitMode(mode: PublishMode) {
    cachedSubmitMode = mode;
    if (isBrowser()) localStorage.setItem(SUBMIT_MODE_KEY, mode);
    notifySubscribers();
}

export function useSubmitMode(): PublishMode {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadSubmitMode,
        defaultMode,
    );
}

export function loadReviewMode(): PublishMode {
    if (!cachedReviewMode) {
        cachedReviewMode = readModeFromStorage(REVIEW_MODE_KEY) ?? defaultMode();
    }
    return cachedReviewMode;
}

export function saveReviewMode(mode: PublishMode) {
    cachedReviewMode = mode;
    if (isBrowser()) localStorage.setItem(REVIEW_MODE_KEY, mode);
    notifySubscribers();
}

export function useReviewMode(): PublishMode {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadReviewMode,
        defaultMode,
    );
}

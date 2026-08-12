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
        description: "提交与审核继续直接修改 index_v2.csv。",
    },
    staging: {
        id: "staging",
        label: "新流程",
        description: "提交 tmp 单资源请求，由仓库 Action 校验并合入目录。",
    },
};

const STORAGE_KEY = "ABCC_PUBLISH_MODE_V1";

function defaultMode(): PublishMode {
    return loadRepoEnvId() === "testenv" ? "staging" : "legacy";
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedMode: PublishMode | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readModeFromStorage(): PublishMode | undefined {
    if (!isBrowser()) return undefined;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "legacy" || raw === "staging") return raw;
    return undefined;
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedMode = readModeFromStorage();
            notifySubscribers();
        }
    });
    storageListenerAttached = true;
}

export function loadPublishMode(): PublishMode {
    if (!cachedMode) cachedMode = readModeFromStorage() ?? defaultMode();
    return cachedMode;
}

export function savePublishMode(mode: PublishMode) {
    cachedMode = mode;
    if (isBrowser()) localStorage.setItem(STORAGE_KEY, mode);
    notifySubscribers();
}

export function usePublishMode(): PublishMode {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadPublishMode,
        defaultMode,
    );
}

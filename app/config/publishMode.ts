import { useSyncExternalStore } from "react";

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

const REVIEW_MODE_KEY = "ABCC_REVIEW_MODE_V1";
const LEGACY_MODE_KEY = "ABCC_PUBLISH_MODE_V1";
// 新流程已成为默认：无论仓库环境如何，未显式选择过的账号都走 staging。
// 已写入 localStorage 的账号仍沿用自己的选择，不受该默认值影响。
const DEFAULT_REVIEW_MODE: PublishMode = "staging";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
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
        if (!event.key || event.key === REVIEW_MODE_KEY) {
            cachedReviewMode = readModeFromStorage(REVIEW_MODE_KEY);
        }
        notifySubscribers();
    });
    storageListenerAttached = true;
}

export function loadReviewMode(): PublishMode {
    if (!cachedReviewMode) {
        cachedReviewMode =
            readModeFromStorage(REVIEW_MODE_KEY) ??
            readModeFromStorage(LEGACY_MODE_KEY) ??
            DEFAULT_REVIEW_MODE;
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
        () => DEFAULT_REVIEW_MODE,
    );
}

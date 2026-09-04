import { useSyncExternalStore } from "react";

// 导航账号区域收缩配置，默认关闭。
const STORAGE_KEY = "ABCC_NAV_ACCOUNT_COLLAPSE_V1";
const DEFAULT_NAV_ACCOUNT_COLLAPSE = false;

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedValue: boolean | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readFromStorage(): boolean {
    if (!isBrowser()) return DEFAULT_NAV_ACCOUNT_COLLAPSE;
    return localStorage.getItem(STORAGE_KEY) === "1";
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedValue = readFromStorage();
            notifySubscribers();
        }
    });
    storageListenerAttached = true;
}

export function loadNavAccountCollapse(): boolean {
    if (typeof cachedValue !== "boolean") {
        cachedValue = readFromStorage();
    }
    return cachedValue;
}

export function saveNavAccountCollapse(enabled: boolean) {
    cachedValue = enabled;
    if (isBrowser()) {
        localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    }
    notifySubscribers();
}

export function useNavAccountCollapse(): boolean {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadNavAccountCollapse,
        () => DEFAULT_NAV_ACCOUNT_COLLAPSE,
    );
}

import { useSyncExternalStore } from "react";

const STORAGE_KEY_ENABLED = "ABCC_BETA_UPDATE_ENABLED_V1";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

export function isBetaUpdateEnabled(): boolean {
    if (!isBrowser()) return false;
    try {
        return localStorage.getItem(STORAGE_KEY_ENABLED) === "1";
    } catch {
        return false;
    }
}

export function setBetaUpdateEnabled(enabled: boolean) {
    if (isBrowser()) {
        try {
            localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "1" : "0");
        } catch {
            // 存储不可用时静默忽略
        }
    }
    notifySubscribers();
}

function subscribe(listener: Subscriber) {
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
}

/** 设置页「启用 Beta 更新检测」开关的响应式绑定（默认关闭）。 */
export function useBetaUpdateEnabled(): [boolean, (enabled: boolean) => void] {
    const enabled = useSyncExternalStore(
        subscribe,
        isBetaUpdateEnabled,
        () => false,
    );
    return [enabled, setBetaUpdateEnabled];
}
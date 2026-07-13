import { useSyncExternalStore } from "react";

// How the AstroBox account login page is presented in the desktop (Tauri) app.
//
// - "deeplink": open the system browser, then return to the app via the
//   astroboxcc:// deep link. More secure, and the default on desktop.
// - "webview": open the casdoor login page inside the app's own window
//   ("built-in webpage" login), with the OAuth callback returning to the
//   in-page /callback route. This restores the pre-deep-link behaviour, and
//   is the default on iOS (where the system-browser round trip is clumsy).
//
// In a regular browser build the method has no effect: login is always a
// same-tab redirect back to /callback.
export type AstroboxLoginMethod = "deeplink" | "webview";

export interface LoginMethodDefinition {
    id: AstroboxLoginMethod;
    label: string;
    description: string;
}

export const LOGIN_METHODS: Record<AstroboxLoginMethod, LoginMethodDefinition> = {
    deeplink: {
        id: "deeplink",
        label: "系统浏览器登录（DeepLink）",
        description:
            "在系统默认浏览器中完成登录",
    },
    webview: {
        id: "webview",
        label: "内置网页登录",
        description:
            "在应用内置窗口直接打开登录页面",
    },
};

const STORAGE_KEY = "ABCC_ASTROBOX_LOGIN_METHOD_V1";

// Fallback used before the platform can be probed (e.g. server snapshot).
const FALLBACK_METHOD: AstroboxLoginMethod = "deeplink";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedMethod: AstroboxLoginMethod | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

// iOS runs in a WKWebView, so `navigator.userAgent` reports iPhone/iPad.
// iPadOS in desktop mode masquerades as "MacIntel" but exposes touch points,
// which distinguishes it from a real Mac desktop build.
function isIOS() {
    if (typeof navigator === "undefined") return false;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
    return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

// Built-in webpage login is the default on iOS; deep link elsewhere.
function getDefaultMethod(): AstroboxLoginMethod {
    return isIOS() ? "webview" : FALLBACK_METHOD;
}

function readMethodFromStorage(): AstroboxLoginMethod {
    if (!isBrowser()) return FALLBACK_METHOD;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "deeplink" || raw === "webview") return raw;
    return getDefaultMethod();
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedMethod = readMethodFromStorage();
            notifySubscribers();
        }
    });
    storageListenerAttached = true;
}

export function loadLoginMethod(): AstroboxLoginMethod {
    if (!cachedMethod) cachedMethod = readMethodFromStorage();
    return cachedMethod;
}

export function saveLoginMethod(method: AstroboxLoginMethod) {
    cachedMethod = method;
    if (isBrowser()) localStorage.setItem(STORAGE_KEY, method);
    notifySubscribers();
}

export function useLoginMethod(): AstroboxLoginMethod {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadLoginMethod,
        () => FALLBACK_METHOD,
    );
}

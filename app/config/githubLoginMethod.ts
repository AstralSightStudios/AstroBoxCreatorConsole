import { useSyncExternalStore } from "react";

// How the GitHub account login is presented.
//
// - "oauth": Authorization Code flow + PKCE. System browser authorizes and
//   returns via the astroboxcc:// deep link (desktop) or a popup callback
//   (web). No code to type. The default.
// - "device": GitHub device flow. Shows a one-time code to enter on
//   github.com/login/device. Used as a fallback when the deep-link callback
//   is unavailable (e.g. dev builds on some platforms).
export type GithubLoginMethod = "oauth" | "device";

export interface GithubLoginMethodDefinition {
    id: GithubLoginMethod;
    label: string;
    description: string;
}

export const GITHUB_LOGIN_METHODS: Record<GithubLoginMethod, GithubLoginMethodDefinition> = {
    oauth: {
        id: "oauth",
        label: "授权码登录（PKCE）",
        description:
            "浏览器授权后自动回调,无需手动输入代码",
    },
    device: {
        id: "device",
        label: "设备码登录",
        description:
            "在浏览器中输入设备码完成授权,兼容性回退",
    },
};

const STORAGE_KEY = "ABCC_GITHUB_LOGIN_METHOD_V1";

// Fallback used before the platform can be probed (e.g. server snapshot).
const FALLBACK_METHOD: GithubLoginMethod = "oauth";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedMethod: GithubLoginMethod | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

// 默认使用授权码(PKCE)登录。
function getDefaultMethod(): GithubLoginMethod {
    return "oauth";
}

function readMethodFromStorage(): GithubLoginMethod {
    if (!isBrowser()) return FALLBACK_METHOD;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "oauth" || raw === "device") return raw;
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

export function loadGithubLoginMethod(): GithubLoginMethod {
    if (!cachedMethod) cachedMethod = readMethodFromStorage();
    return cachedMethod;
}

export function saveGithubLoginMethod(method: GithubLoginMethod) {
    cachedMethod = method;
    if (isBrowser()) localStorage.setItem(STORAGE_KEY, method);
    notifySubscribers();
}

export function useGithubLoginMethod(): GithubLoginMethod {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadGithubLoginMethod,
        () => FALLBACK_METHOD,
    );
}

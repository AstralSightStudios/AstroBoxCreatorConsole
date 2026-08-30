// AstroBox 原生(应用内)登录业务层。
//
// 照抄 AstroBox-NG loginNative.tsx 的登录逻辑,适配 CreatorConsole 的
// 纯前端架构(无 Rust 后端):密码登录直接调用 /auth/native/* 接口,
// 第三方 OAuth 在系统浏览器授权后经 deep link 回应用补完 complete。

import {
    getSelfUserInfo,
    nativeOAuthComplete,
    nativeOAuthStart,
    nativePasswordLogin,
    type NativeProviderInfo,
} from "~/api/astrobox/auth";
import {
    NATIVE_LOGIN_IN_FLIGHT_TTL,
    NATIVE_PENDING_OAUTH_KEY,
    NATIVE_SAVED_CREDENTIALS_KEY,
    NATIVE_SAVE_PASSWORD_KEY,
} from "~/config/nativeAuth";
import { getAstroboxRefreshToken } from "./store";
import { persistAstroboxAccount } from "./astrobox";

export interface PendingNativeOAuth {
    state: string;
    startedAt: number;
    hadAccountBefore: boolean;
    accountBefore?: string;
    // iOS 原生 Sign in with Apple 用;CC 桌面端不传,保留字段对齐 ABNG。
    isApple?: boolean;
}

// ---- 保存密码(自动填充)----

// 账号密码以 base64 包裹后存 localStorage,仅作本地自动填充用途,
// 不做高强度加密(与系统内其他本地配置同级)。
export function loadSavedCredentials(): { u: string; p: string } | null {
    try {
        const raw = localStorage.getItem(NATIVE_SAVED_CREDENTIALS_KEY);
        if (!raw) return null;
        const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof parsed?.u !== "string" || typeof parsed?.p !== "string") {
            return null;
        }
        return { u: parsed.u, p: parsed.p };
    } catch {
        return null;
    }
}

export function persistCredentials(credentials: { u: string; p: string } | null) {
    try {
        if (!credentials) {
            localStorage.removeItem(NATIVE_SAVED_CREDENTIALS_KEY);
            return;
        }
        const bytes = new TextEncoder().encode(JSON.stringify(credentials));
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        localStorage.setItem(NATIVE_SAVED_CREDENTIALS_KEY, btoa(binary));
    } catch {
        // 存储不可用时静默跳过,不影响登录主流程。
    }
}

export function loadSavePasswordSetting(): boolean {
    try {
        return localStorage.getItem(NATIVE_SAVE_PASSWORD_KEY) === "true";
    } catch {
        return false;
    }
}

export function savePasswordSetting(value: boolean) {
    try {
        if (value) {
            localStorage.setItem(NATIVE_SAVE_PASSWORD_KEY, "true");
        } else {
            localStorage.removeItem(NATIVE_SAVE_PASSWORD_KEY);
        }
    } catch {
        // 存储不可用时忽略。
    }
}

// ---- 密码登录 ----

/** 密码登录:调 /auth/native/password/login → 拉 profile → 写入本地账号存储。 */
export async function nativeLoginWithPassword(
    username: string,
    password: string,
    savePassword: boolean,
): Promise<void> {
    const pair = await nativePasswordLogin(username.trim(), password);
    const profile = await getSelfUserInfo(pair.token);
    persistAstroboxAccount(
        profile,
        pair.token,
        pair.refreshToken || getAstroboxRefreshToken(),
    );
    persistCredentials(savePassword ? { u: username.trim(), p: password } : null);
    return undefined;
}

// ---- 第三方 OAuth pending 状态(与 ABNG loginNative 一致)----

function loadPendingNativeOAuth(): PendingNativeOAuth | null {
    try {
        const raw = localStorage.getItem(NATIVE_PENDING_OAUTH_KEY);
        if (!raw) return null;
        const pending = JSON.parse(raw) as Partial<PendingNativeOAuth>;
        if (
            typeof pending.state !== "string" ||
            !pending.state ||
            typeof pending.startedAt !== "number" ||
            typeof pending.hadAccountBefore !== "boolean" ||
            (pending.accountBefore !== undefined &&
                typeof pending.accountBefore !== "string") ||
            Date.now() - pending.startedAt > NATIVE_LOGIN_IN_FLIGHT_TTL
        ) {
            localStorage.removeItem(NATIVE_PENDING_OAUTH_KEY);
            return null;
        }
        return pending as PendingNativeOAuth;
    } catch {
        return null;
    }
}

function savePendingNativeOAuth(pending: PendingNativeOAuth | null) {
    try {
        if (pending) {
            localStorage.setItem(NATIVE_PENDING_OAUTH_KEY, JSON.stringify(pending));
        } else {
            localStorage.removeItem(NATIVE_PENDING_OAUTH_KEY);
        }
    } catch {
        // localStorage 不可用时继续使用组件内存,不影响正常登录。
    }
}

// ---- 第三方 OAuth 登录事件 ----

export type NativeOAuthLoginEvent =
    | { type: "completed"; state: string }
    | { type: "failed"; state?: string | null; error: string };

type NativeOAuthLoginListener = (event: NativeOAuthLoginEvent) => void;
const nativeOAuthLoginListeners = new Set<NativeOAuthLoginListener>();

export function onNativeOAuthLogin(listener: NativeOAuthLoginListener) {
    nativeOAuthLoginListeners.add(listener);
    return () => {
        nativeOAuthLoginListeners.delete(listener);
    };
}

function emitNativeOAuthLogin(event: NativeOAuthLoginEvent) {
    nativeOAuthLoginListeners.forEach((fn) => {
        try {
            fn(event);
        } catch (err) {
            console.warn("native oauth login listener threw", err);
        }
    });
}

const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let nativeOAuthDeepLinkInstalled = false;

// deep link 前缀:服务端 oauth/start 下发 authorizationUrl 完成后,
// 授权结果经 returnUri handoff 页带回,以 state+code 形式回到应用。
// CC 的 deeplink scheme 是 astroboxcc://。
const NATIVE_OAUTH_CALLBACK_PREFIX = "astroboxcc://auth/oauth";

function parseNativeOAuthCallback(url: string): { state: string; code: string } | null {
    if (!url.startsWith(NATIVE_OAUTH_CALLBACK_PREFIX)) return null;
    const state = new URL(url).searchParams.get("state") ?? "";
    const code = new URL(url).searchParams.get("code") ?? "";
    if (!state || !code) return null;
    return { state, code };
}

async function completeNativeOAuth(state: string, code: string) {
    const pending = loadPendingNativeOAuth();
    if (!pending || pending.state !== state) return;
    savePendingNativeOAuth(null);
    try {
        const pair = await nativeOAuthComplete(state, code);
        const profile = await getSelfUserInfo(pair.token);
        persistAstroboxAccount(
            profile,
            pair.token,
            pair.refreshToken || getAstroboxRefreshToken(),
        );
        emitNativeOAuthLogin({ type: "completed", state });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitNativeOAuthLogin({ type: "failed", state, error: message });
    }
}

async function ensureNativeOAuthDeepLinkHandler() {
    if (nativeOAuthDeepLinkInstalled || !isTauri) return;
    nativeOAuthDeepLinkInstalled = true;
    try {
        const { onOpenUrl, getCurrent } = await import(
            "@tauri-apps/plugin-deep-link"
        );
        const dispatch = (urls: string[]) => {
            for (const url of urls) {
                const parsed = parseNativeOAuthCallback(url);
                if (parsed) {
                    void completeNativeOAuth(parsed.state, parsed.code);
                    return;
                }
            }
        };
        await onOpenUrl(dispatch);
        // 冷启动场景:应用被 deep link 唤起。
        const initial = await getCurrent();
        if (initial && initial.length) {
            dispatch(initial);
        }
    } catch (err) {
        console.warn("Failed to install native oauth deep-link handler", err);
        nativeOAuthDeepLinkInstalled = false;
    }
}

// 模块加载即安装,避免冷启动 deep link 丢失。
if (isTauri) {
    void ensureNativeOAuthDeepLinkHandler();
}

/** 启动第三方 OAuth 登录:创建 transaction,保存 pending,系统浏览器打开授权页。 */
export async function startNativeOAuthLogin(
    provider: NativeProviderInfo,
    hadAccountBefore: boolean,
    accountBefore?: string,
): Promise<{ state: string; startedAt: number }> {
    const start = await nativeOAuthStart(provider.id);
    const startedAt = Date.now();
    savePendingNativeOAuth({
        state: start.state,
        startedAt,
        hadAccountBefore,
        accountBefore,
    });
    if (isTauri) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(start.authorizationUrl);
    } else {
        window.open(start.authorizationUrl, "_blank", "noopener");
    }
    return { state: start.state, startedAt };
}

export function cancelNativeOAuthLogin() {
    savePendingNativeOAuth(null);
}

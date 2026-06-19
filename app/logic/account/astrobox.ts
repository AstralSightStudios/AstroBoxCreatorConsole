import axios from "axios";
import Sdk from "casdoor-js-sdk";
import { CASDOOR_CONFIG } from "~/config/casdoor";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { getSelfUserInfo } from "~/api/astrobox/auth";
import {
    getAstroboxToken,
    logoutAccount,
    setAstroboxAccount,
    type AstroboxAccount,
} from "./store";

export const SDK = new Sdk(CASDOOR_CONFIG);

const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let deepLinkHandlerInstalled = false;

type LoginListener = (state: { phase: string; error?: string }) => void;
const loginListeners = new Set<LoginListener>();

function emit(state: { phase: string; error?: string }) {
    loginListeners.forEach((fn) => {
        try {
            fn(state);
        } catch (err) {
            console.warn("Astrobox login listener threw", err);
        }
    });
}

export function onAstroboxLoginStateChange(listener: LoginListener) {
    loginListeners.add(listener);
    return () => {
        loginListeners.delete(listener);
    };
}

async function handleAuthUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
            throw new Error("回调 URL 缺少 code 或 state 参数。");
        }

        emit({ phase: "exchanging" });
        const tokenResponse = (await SDK.signin(
            ASTROBOX_SERVER_CONFIG.serverUrl,
            undefined,
            code,
            state,
        )) as { token?: string; error?: string };

        if (!tokenResponse?.token) {
            throw new Error(tokenResponse?.error || "拿不到 token。");
        }

        emit({ phase: "loading-profile" });
        const profile: any = await getSelfUserInfo(tokenResponse.token);
        persistAstroboxAccount(profile, tokenResponse.token);
        emit({ phase: "success" });

        // Bring app back to foreground when login completes via deep link.
        if (isTauri) {
            try {
                const { getCurrentWindow } = await import(
                    "@tauri-apps/api/window"
                );
                const win = getCurrentWindow();
                await win.show();
                await win.unminimize();
                await win.setFocus();
            } catch (err) {
                console.warn("Failed to focus app window after login", err);
            }
        }

        // Refresh app to pick up the new auth state, mirroring the previous
        // browser-based callback flow.
        window.location.replace("/");
    } catch (error) {
        const message = error instanceof Error ? error.message : "登录失败";
        console.error("Astrobox deep-link login failed", error);
        emit({ phase: "error", error: message });
    }
}

async function ensureDeepLinkHandler() {
    if (deepLinkHandlerInstalled || !isTauri) return;
    deepLinkHandlerInstalled = true;
    try {
        const { onOpenUrl, getCurrent } = await import(
            "@tauri-apps/plugin-deep-link"
        );
        await onOpenUrl((urls) => {
            const target = urls.find((u) =>
                u.startsWith("astroboxcc://auth/callback"),
            );
            if (target) {
                void handleAuthUrl(target);
            }
        });

        // Cold-start case: app was launched by a deep link.
        const initial = await getCurrent();
        if (initial && initial.length) {
            const target = initial.find((u) =>
                u.startsWith("astroboxcc://auth/callback"),
            );
            if (target) {
                void handleAuthUrl(target);
            }
        }
    } catch (err) {
        console.warn("Failed to install deep-link handler", err);
        deepLinkHandlerInstalled = false;
    }
}

// Install handler at module load so cold-start deep links are not missed.
if (isTauri) {
    void ensureDeepLinkHandler();
}

export async function startAstroboxLogin() {
    const url = SDK.getSigninUrl();

    if (isTauri) {
        await ensureDeepLinkHandler();
        emit({ phase: "waiting-browser" });
        try {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
        } catch (err) {
            console.error("Failed to open browser for login", err);
            emit({ phase: "error", error: "无法打开浏览器进行登录。" });
        }
        return;
    }

    // Browser fallback: same-tab redirect to keep behaviour identical to before.
    location.href = url;
}

export function persistAstroboxAccount(profile: any, token: string) {
    const account: AstroboxAccount = {
        avatar: profile?.avatar ?? "",
        name:
            profile?.displayName ||
            profile?.preferred_username ||
            profile?.name ||
            "",
        plan: profile?.vip || profile?.tag || "",
        email: profile?.email ?? "",
        token,
        roles: Array.isArray(profile?.roles)
            ? profile.roles.filter((role: unknown): role is string => typeof role === "string")
            : [],
        activeSocialBan: profile?.activeSocialBan ?? null,
    };

    setAstroboxAccount(account);
}

export function clearAstroboxAccount() {
    logoutAccount("astrobox");
}

export async function refreshAstroboxAccount() {
    const token = getAstroboxToken();
    if (!token) return false;

    try {
        const profile = await getSelfUserInfo(token);
        persistAstroboxAccount(profile, token);
        return true;
    } catch (error) {
        const status = axios.isAxiosError(error)
            ? error.response?.status
            : undefined;

        if (status === 401 || status === 403) {
            clearAstroboxAccount();
        }

        console.warn("Failed to refresh AstroBox account data", error);
        return false;
    }
}

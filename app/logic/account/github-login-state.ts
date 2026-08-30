import { useSyncExternalStore } from "react";
import {
    buildGithubAuthorizeUrl,
    exchangeGithubCode,
    finalizeGithubLogin,
    generateCodeChallenge,
    generateCodeVerifier,
    isTauriEnvironment,
    pollGithubDeviceSession,
    startGithubDeviceSession,
    type GithubDeviceSession,
} from "./github";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { loadGithubLoginMethod } from "~/config/githubLoginMethod";

export type GithubLoginStatus = "idle" | "requesting" | "waiting" | "success" | "error";
export type GithubLoginMode = "oauth" | "device";

export interface GithubLoginState {
    status: GithubLoginStatus;
    statusMessage: string;
    error?: string;
    /** 当前采用的登录流程。 */
    mode?: GithubLoginMode;
    /** device flow 会话(仅在 mode === "device" 时存在)。 */
    session?: GithubDeviceSession;
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let currentState: GithubLoginState = {
    status: "idle",
    statusMessage: "",
};

function notifySubscribers() {
    subscribers.forEach((listener) => {
        listener();
    });
}

function updateState(partial: Partial<GithubLoginState>) {
    currentState = { ...currentState, ...partial };
    notifySubscribers();
}

export function getGithubLoginState(): GithubLoginState {
    return currentState;
}

export function useGithubLoginState(): GithubLoginState {
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        getGithubLoginState,
        () => currentState,
    );
}

export type { GithubDeviceSession } from "./github";

interface PendingOauth {
    codeVerifier: string;
    state: string;
}

let pendingOauth: PendingOauth | null = null;
let deviceAbortController: AbortController | null = null;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

function clearPendingTimeout() {
    if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    }
}

function abortDevicePolling() {
    deviceAbortController?.abort();
    deviceAbortController = null;
}

function schedulePendingTimeout() {
    clearPendingTimeout();
    timeoutHandle = setTimeout(() => {
        if (pendingOauth) {
            fail("授权超时，请重新登录。");
        }
    }, 5 * 60 * 1000);
}

function fail(message: string) {
    clearPendingTimeout();
    abortDevicePolling();
    pendingOauth = null;
    updateState({
        status: "error",
        statusMessage: message,
        error: message,
        session: undefined,
    });
}

export function cancelGithubLogin() {
    clearPendingTimeout();
    abortDevicePolling();
    pendingOauth = null;
    updateState({
        status: "idle",
        statusMessage: "",
        error: undefined,
        session: undefined,
    });
}

function handleOauthCallback(code: string, state: string, error?: string) {
    if (!pendingOauth) return;

    if (error) {
        fail(error);
        return;
    }

    if (!code || state !== pendingOauth.state) {
        fail("登录状态校验失败，请重试。");
        return;
    }

    const { codeVerifier } = pendingOauth;
    pendingOauth = null;
    void completeLogin(code, codeVerifier);
}

async function completeLogin(code: string, codeVerifier: string) {
    try {
        updateState({ status: "waiting", statusMessage: "正在换取访问令牌..." });

        const token = await exchangeGithubCode(code, codeVerifier);

        clearPendingTimeout();

        updateState({ statusMessage: "正在获取账号信息..." });
        await finalizeGithubLogin(token);

        updateState({ status: "success", statusMessage: "登录成功" });
        window.location.reload();
    } catch (error) {
        fail(error instanceof Error ? error.message : "GitHub登录失败");
    }
}

let listenerInstalled = false;

function installCallbackListener() {
    if (listenerInstalled) return;
    listenerInstalled = true;

    if (isTauriEnvironment()) {
        // 桌面端:系统浏览器授权后经 astroboxcc:// 深链回调。
        onOpenUrl((urls) => {
            for (const url of urls) {
                const parsed = new URL(url);
                if (
                    parsed.protocol !== "astroboxcc:" ||
                    // astroboxcc://oauth/callback 会被解析为 host=oauth、path=/callback。
                    parsed.host !== "oauth" ||
                    parsed.pathname !== "/callback"
                ) {
                    continue;
                }
                handleOauthCallback(
                    parsed.searchParams.get("code") || "",
                    parsed.searchParams.get("state") || "",
                    parsed.searchParams.get("error") || undefined,
                );
            }
        }).catch(() => {
            // 无 deep-link 权限时静默,登录可切回 device flow。
        });
        return;
    }

    // Web 端:popup 授权后由 /oauth-callback 页 postMessage 回传(同源)。
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as {
            type?: string;
            code?: string;
            state?: string;
            error?: string;
        };
        if (!data || data.type !== "github-oauth-callback") return;
        handleOauthCallback(data.code || "", data.state || "", data.error || undefined);
    });
}

/** 主入口:按设置分派登录方式,默认 Auth Code + PKCE。 */
export async function startGithubLogin() {
    if (currentState.status !== "idle" && currentState.status !== "error") {
        return;
    }
    if (loadGithubLoginMethod() === "device") {
        await startDeviceFlow();
    } else {
        await startOauthFlow();
    }
}

/** Auth Code + PKCE 主流程。 */
async function startOauthFlow() {
    try {
        abortDevicePolling();
        updateState({
            status: "requesting",
            statusMessage: "正在生成登录信息...",
            error: undefined,
            session: undefined,
        });

        const codeVerifier = generateCodeVerifier();
        const state = generateCodeVerifier();

        installCallbackListener();

        // 先同步开窗(处于用户手势内,避免弹窗被拦截),再异步计算 challenge。
        const isTauri = isTauriEnvironment();
        const popup = isTauri ? null : window.open("about:blank", "_blank");

        const codeChallenge = await generateCodeChallenge(codeVerifier);
        const authorizeUrl = buildGithubAuthorizeUrl(state, codeChallenge);
        pendingOauth = { codeVerifier, state };

        updateState({
            status: "waiting",
            statusMessage: "请在打开的浏览器页面中完成授权...",
            mode: "oauth",
        });
        schedulePendingTimeout();

        if (isTauri) {
            await openUrl(authorizeUrl);
        } else if (popup) {
            popup.location.href = authorizeUrl;
        } else {
            window.open(authorizeUrl, "_blank");
        }
    } catch (error) {
        fail(error instanceof Error ? error.message : "GitHub登录失败");
    }
}

/** 回退:从 oauth 等待态切到设备码流程。 */
export async function switchToDeviceFlow() {
    if (currentState.status !== "waiting" || currentState.mode !== "oauth") {
        return;
    }
    await startDeviceFlow();
}

/** 设备码登录流程(按设置直接启用,或从 oauth 回退)。 */
async function startDeviceFlow() {
    try {
        clearPendingTimeout();
        pendingOauth = null;
        abortDevicePolling();
        updateState({
            status: "requesting",
            statusMessage: "正在获取设备码...",
            session: undefined,
        });

        const session = await startGithubDeviceSession();

        updateState({
            status: "waiting",
            statusMessage: "等待授权...",
            mode: "device",
            session,
        });

        const linkToOpen = session.verificationUriComplete || session.verificationUri;
        if (linkToOpen) {
            try {
                await openUrl(linkToOpen);
            } catch {
                window.open(linkToOpen, "_blank", "noopener,noreferrer");
            }
        }

        deviceAbortController?.abort();
        deviceAbortController = new AbortController();

        const token = await pollGithubDeviceSession(session, {
            signal: deviceAbortController.signal,
            onStatusChange: (status) => {
                updateState({ statusMessage: status });
            },
        });

        updateState({ statusMessage: "正在获取账号信息..." });
        await finalizeGithubLogin(token);

        updateState({ status: "success", statusMessage: "登录成功" });
        window.location.reload();
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "GitHub登录失败";
        if (message === "Login cancelled") {
            cancelGithubLogin();
            return;
        }
        fail(message);
    }
}

import { useSyncExternalStore } from "react";
import { GITHUB_OAUTH_CONFIG } from "~/config/github";
import {
    buildGithubAccountFromToken,
    finalizeGithubLogin,
    pollGithubDeviceSession,
    startGithubDeviceSession,
    type GithubDeviceSession,
} from "./github";
import {
    addGithubReader,
    loadAccountState,
    type GithubReaderAccount,
} from "./store";
import { openUrl } from "@tauri-apps/plugin-opener";

export type { GithubDeviceSession };
export type GithubLoginStatus = "idle" | "requesting" | "waiting" | "success" | "error";
export type GithubLoginTarget = "primary" | "reader";

export interface GithubLoginState {
    status: GithubLoginStatus;
    target: GithubLoginTarget;
    session?: GithubDeviceSession;
    statusMessage: string;
    error?: string;
    /** 读取账号登录成功后的账号信息，供添加对话框读取。 */
    addedReader?: GithubReaderAccount;
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let currentState: GithubLoginState = {
    status: "idle",
    target: "primary",
    statusMessage: "",
};

let abortController: AbortController | null = null;

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

export function cancelGithubLogin() {
    abortController?.abort();
    abortController = null;
    updateState({
        status: "idle",
        target: "primary",
        session: undefined,
        statusMessage: "",
        error: undefined,
        addedReader: undefined,
    });
}

export async function startGithubLogin(
    target: GithubLoginTarget = "primary",
) {
    if (
        currentState.status === "requesting" ||
        currentState.status === "waiting"
    ) {
        return;
    }

    try {
        updateState({
            status: "requesting",
            target,
            statusMessage: "Getting Activation Code...",
            error: undefined,
            session: undefined,
            addedReader: undefined,
        });

        const scopes =
            target === "reader"
                ? GITHUB_OAUTH_CONFIG.readerScopes
                : GITHUB_OAUTH_CONFIG.scopes;
        const session = await startGithubDeviceSession(scopes);

        updateState({
            status: "waiting",
            target,
            session,
            statusMessage: "等待授权...",
        });

        const linkToOpen = session.verificationUriComplete || session.verificationUri;
        if (linkToOpen) {
            try {
                await openUrl(linkToOpen);
            } catch (e) {
                console.warn("Failed to open URL via Tauri opener, trying window.open", e);
                window.open(linkToOpen, "_blank", "noopener,noreferrer");
            }
        }

        abortController?.abort();
        abortController = new AbortController();

        const token = await pollGithubDeviceSession(session, {
            signal: abortController.signal,
            onStatusChange: (status) => {
                updateState({ statusMessage: status });
            },
        });

        if (target === "reader") {
            updateState({ statusMessage: "Loading GitHub Account Info..." });
            const account = await buildGithubAccountFromToken(token, {
                includeEmail: false,
            });
            const primary = loadAccountState().github;
            if (!primary?.token) {
                throw new Error("请先登录 GitHub 主账号，再添加读取账号。");
            }
            if (
                account.username.trim().toLowerCase() ===
                primary.username.trim().toLowerCase()
            ) {
                throw new Error(
                    "这是当前 GitHub 主账号。请先在浏览器中切换到另一个账号，或使用 Access Token 添加。",
                );
            }

            const reader: GithubReaderAccount = {
                ...account,
                authType: "oauth",
                addedAt: Date.now(),
            };
            addGithubReader(reader);

            updateState({
                status: "success",
                target,
                statusMessage: "读取账号已添加",
                addedReader: reader,
            });
            return;
        }

        updateState({ statusMessage: "Loading GitHub Account Info..." });
        await finalizeGithubLogin(token);

        updateState({
            status: "success",
            target,
            statusMessage: "Login Successful",
        });

        window.location.reload();
    } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub登录失败";
        // cancelGithubLogin 已经重置状态，未跟踪的取消不应再写回错误。
        if (message === "Login cancelled") {
            return;
        }
        updateState({
            status: "error",
            target,
            statusMessage: message,
            error: message,
        });
    }
}

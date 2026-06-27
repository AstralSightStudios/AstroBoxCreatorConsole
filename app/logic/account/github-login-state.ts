import { useSyncExternalStore } from "react";
import {
    finalizeGithubLogin,
    pollGithubDeviceSession,
    startGithubDeviceSession,
    type GithubDeviceSession,
} from "./github";
import { openUrl } from "@tauri-apps/plugin-opener";

export type { GithubDeviceSession };
export type GithubLoginStatus = "idle" | "requesting" | "waiting" | "success" | "error";

export interface GithubLoginState {
    status: GithubLoginStatus;
    session?: GithubDeviceSession;
    statusMessage: string;
    error?: string;
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let currentState: GithubLoginState = {
    status: "idle",
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
        session: undefined,
        statusMessage: "",
        error: undefined,
    });
}

export async function startGithubLogin() {
    if (currentState.status !== "idle" && currentState.status !== "error") {
        return;
    }

    try {
        updateState({
            status: "requesting",
            statusMessage: "Getting Activation Code...",
            error: undefined,
            session: undefined,
        });

        const session = await startGithubDeviceSession();

        updateState({
            status: "waiting",
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

        updateState({ statusMessage: "Loading GitHub Account Info..." });
        await finalizeGithubLogin(token);

        updateState({
            status: "success",
            statusMessage: "Login Successful",
        });

        window.location.reload();
    } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub登录失败";
        updateState({
            status: "error",
            statusMessage: message,
            error: message,
        });
    }
}

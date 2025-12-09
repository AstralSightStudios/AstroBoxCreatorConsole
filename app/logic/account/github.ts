import axios from "axios";
import { invoke } from "@tauri-apps/api/core";
import { GITHUB_OAUTH_CONFIG } from "~/config/github";
import { setGithubAccount, type GithubAccount } from "./store";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const PROFILE_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";

function isTauriEnvironment() {
    return (
        typeof window !== "undefined" &&
        Boolean(
            (window as any).__TAURI_INTERNALS__ ||
                (window as any).__TAURI_METADATA__ ||
                (window as any).__TAURI_IPC__,
        )
    );
}

async function githubRequest<T>(options: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
}): Promise<T> {
    const { url, method = "GET", headers, body } = options;

    if (isTauriEnvironment()) {
        try {
            return await invoke<T>("github_request", {
                request: {
                    url,
                    method,
                    headers,
                    body: body ?? null,
                },
            });
        } catch (error) {
            console.warn(
                "GitHub request via Tauri failed, falling back to axios",
                error,
            );
        }
    }

    const response = await axios.request<T>({
        url,
        method,
        data: body,
        headers,
    });

    return response.data;
}

export interface GithubDeviceSession {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    interval: number;
    scopes: string[];
}

interface GithubTokenResponse {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

export interface GithubTokenPayload {
    accessToken: string;
    tokenType: string;
    scopes: string[];
}

export interface GithubPollOptions {
    signal?: AbortSignal;
    onStatusChange?: (status: string) => void;
}

function ensureClientId() {
    if (!GITHUB_OAUTH_CONFIG.clientId) {
        throw new Error(
            "GitHub OAuth clientId is missing. Set VITE_GITHUB_CLIENT_ID to continue.",
        );
    }
}

function parseScopes(value?: string): string[] {
    if (!value) return [];
    return value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

export async function startGithubDeviceSession(): Promise<GithubDeviceSession> {
    ensureClientId();

    const params = new URLSearchParams({
        client_id: GITHUB_OAUTH_CONFIG.clientId,
        scope: GITHUB_OAUTH_CONFIG.scopes.join(" "),
    });

    const data = await githubRequest<any>({
        url: DEVICE_CODE_URL,
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: params.toString(),
    });

    return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        verificationUriComplete: data.verification_uri_complete,
        expiresIn: data.expires_in,
        interval: data.interval,
        scopes: GITHUB_OAUTH_CONFIG.scopes,
    };
}

async function wait(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Login cancelled");

    await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error("Login cancelled"));
        };

        timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function pollGithubDeviceSession(
    session: GithubDeviceSession,
    options?: GithubPollOptions,
): Promise<GithubTokenPayload> {
    ensureClientId();

    let intervalSeconds = Math.max(5, session.interval);

    while (true) {
        options?.onStatusChange?.("等待授权...");

        const params = new URLSearchParams({
            client_id: GITHUB_OAUTH_CONFIG.clientId,
            device_code: session.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });

        const data = await githubRequest<GithubTokenResponse>({
            url: TOKEN_URL,
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: params.toString(),
        });

        if (data.error === "authorization_pending") {
            await wait(intervalSeconds * 1000, options?.signal);
            continue;
        }

        if (data.error === "slow_down") {
            intervalSeconds += 1;
            await wait(intervalSeconds * 1000, options?.signal);
            continue;
        }

        if (data.error) {
            throw new Error(data.error_description || data.error);
        }

        if (!data.access_token || !data.token_type) {
            throw new Error("GitHub 登录失败：令牌为空。");
        }

        const parsedScopes = parseScopes(data.scope);

        return {
            accessToken: data.access_token,
            tokenType: data.token_type,
            scopes: parsedScopes.length ? parsedScopes : session.scopes,
        };
    }
}

async function fetchGithubProfile(
    token: string,
): Promise<{ profile: any; email?: string }> {
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
    };

    const data = await githubRequest<any>({
        url: PROFILE_URL,
        headers,
    });

    let email = data?.email || "";
    if (!email) {
        try {
            const emails = await githubRequest<any[]>({
                url: EMAILS_URL,
                headers,
            });
            const primary =
                emails?.find((item: any) => item?.primary && item?.verified) ||
                emails?.[0];
            email = primary?.email || "";
        } catch {
            // Optional endpoint; ignore failures.
        }
    }

    return { profile: data, email };
}

export async function finalizeGithubLogin(
    payload: GithubTokenPayload,
): Promise<GithubAccount> {
    const { profile, email } = await fetchGithubProfile(payload.accessToken);

    const account: GithubAccount = {
        avatar: profile?.avatar_url ?? "",
        username: profile?.login ?? "",
        name: profile?.name ?? profile?.login ?? "",
        email,
        token: payload.accessToken,
        scopes: payload.scopes,
        profileUrl: profile?.html_url,
    };

    setGithubAccount(account);
    return account;
}

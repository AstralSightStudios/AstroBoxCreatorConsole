import axios from "axios";
import { invoke } from "@tauri-apps/api/core";
import { GITHUB_OAUTH_CONFIG } from "~/config/github";
import { setGithubAccount, type GithubAccount } from "./store";

const isWeb = typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__;

const DEVICE_CODE_URL = isWeb
  ? "/github-login/login/device/code"
  : "https://github.com/login/device/code";
const TOKEN_URL = isWeb
  ? "/github-login/login/oauth/access_token"
  : "https://github.com/login/oauth/access_token";
const PROFILE_URL = isWeb
  ? "/github-api/user"
  : "https://api.github.com/user";
const EMAILS_URL = isWeb
  ? "/github-api/user/emails"
  : "https://api.github.com/user/emails";

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

const DEFAULT_GITHUB_REQUEST_TIMEOUT_MS = 30_000;

class GithubProxyHttpError extends Error {
    readonly status: number;
    readonly body: string;

    constructor(status: number, body: string) {
        super(`GitHub 请求失败（HTTP ${status}）`);
        this.name = "GithubProxyHttpError";
        this.status = status;
        this.body = body;
    }
}

/** Tauri 代理的错误串格式：`GitHub request failed (400): {json}`。 */
function parseGithubProxyHttpError(
    message: string,
): { status: number; body: string } | null {
    let text = message;
    // 某些 Tauri 版本会把 Err(String) 再 JSON 序列化一次。
    if (text.startsWith('"') && text.endsWith('"')) {
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed === "string") text = parsed;
        } catch {
            // 保留原始错误串。
        }
    }

    const match = /GitHub request failed \((\d+)\):\s*([\s\S]*)$/.exec(text);
    if (!match) return null;
    return { status: Number(match[1]), body: match[2] };
}

async function githubRequest<T>(options: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    /**
     * Tauri 代理返回非 2xx 时，把 GitHub 的 JSON 错误体交给调用方处理。
     * Device Flow 的 authorization_pending / slow_down 需要这个行为。
     */
    allowHttpErrorBody?: boolean;
}): Promise<T> {
    const {
        url,
        method = "GET",
        headers,
        body,
        timeoutMs = DEFAULT_GITHUB_REQUEST_TIMEOUT_MS,
        allowHttpErrorBody = false,
    } = options;

    if (isTauriEnvironment()) {
        try {
            return await Promise.race([
                invoke<T>("github_request", {
                    request: {
                        url,
                        method,
                        headers,
                        body: body ?? null,
                    },
                }),
                new Promise<never>((_, reject) => {
                    setTimeout(
                        () => reject(new Error("GitHub 请求超时，请检查网络。")),
                        timeoutMs,
                    );
                }),
            ]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 超时是 Tauri 代理本身无响应，继续走 axios 只会再等一轮。
            if (message === "GitHub 请求超时，请检查网络。") {
                throw error;
            }

            // 代理已经拿到 GitHub 的 HTTP 响应；这不是网络失败，不能回退 axios。
            const httpError = parseGithubProxyHttpError(message);
            if (httpError) {
                if (allowHttpErrorBody) {
                    try {
                        return JSON.parse(httpError.body) as T;
                    } catch {
                        // 非 JSON 错误体继续按 HTTP 错误抛出。
                    }
                }
                throw new GithubProxyHttpError(httpError.status, httpError.body);
            }

            console.warn(
                "GitHub request via Tauri failed, falling back to axios",
                error,
            );
        }
    }

    try {
        const response = await axios.request<T>({
            url,
            method,
            data: body,
            headers,
            timeout: timeoutMs,
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            // Web 构建的 /github-login 代理可能以 4xx 返回 OAuth 错误体。
            if (allowHttpErrorBody && error.response) {
                return error.response.data as T;
            }
            if (error.code === "ECONNABORTED") {
                throw new Error("GitHub 请求超时，请检查网络。");
            }
        }
        throw error;
    }
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

export async function startGithubDeviceSession(
    scopes: string[] = GITHUB_OAUTH_CONFIG.scopes,
): Promise<GithubDeviceSession> {
    ensureClientId();

    const params = new URLSearchParams({
        client_id: GITHUB_OAUTH_CONFIG.clientId,
        scope: scopes.join(" "),
    });

    const data = await githubRequest<any>({
        url: DEVICE_CODE_URL,
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: params.toString(),
        allowHttpErrorBody: true,
    });

    if (data?.error) {
        throw new Error(data.error_description || data.error);
    }
    if (!data?.device_code || !data?.user_code) {
        throw new Error("GitHub 未返回设备授权码，请稍后重试。");
    }

    return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        verificationUriComplete: data.verification_uri_complete,
        expiresIn: data.expires_in,
        interval: data.interval,
        scopes,
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
            allowHttpErrorBody: true,
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
    options: { includeEmail?: boolean } = {},
): Promise<{ profile: any; email?: string }> {
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
    };

    const data = await githubRequest<any>({
        url: PROFILE_URL,
        headers,
        allowHttpErrorBody: true,
    });

    if (!data?.login) {
        throw new Error(
            typeof data?.message === "string"
                ? `GitHub 用户信息读取失败：${data.message}`
                : "GitHub 用户信息读取失败。",
        );
    }

    let email = data?.email || "";
    if (!email && options.includeEmail !== false) {
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

export async function buildGithubAccountFromToken(
    payload: GithubTokenPayload,
    options: { includeEmail?: boolean } = {},
): Promise<GithubAccount> {
    const { profile, email } = await fetchGithubProfile(
        payload.accessToken,
        options,
    );

    return {
        avatar: profile?.avatar_url ?? "",
        username: profile?.login ?? "",
        name: profile?.name ?? profile?.login ?? "",
        email,
        token: payload.accessToken,
        scopes: payload.scopes,
        profileUrl: profile?.html_url,
    };
}

export async function finalizeGithubLogin(
    payload: GithubTokenPayload,
): Promise<GithubAccount> {
    const account = await buildGithubAccountFromToken(payload, {
        includeEmail: true,
    });

    setGithubAccount(account);
    return account;
}

/**
 * 校验读取账号的 Access Token（fine-grained PAT 或 classic PAT）。
 * 只调用 /user 读取身份，不写入任何账号状态。
 */
export async function validateGithubReaderToken(
    token: string,
): Promise<GithubAccount> {
    const trimmed = token.trim();
    if (!trimmed) {
        throw new Error("请填写 GitHub Access Token。");
    }

    const profile = await githubRequest<any>({
        url: PROFILE_URL,
        headers: {
            Authorization: `Bearer ${trimmed}`,
            Accept: "application/vnd.github+json",
        },
        allowHttpErrorBody: true,
    });

    if (!profile?.login) {
        throw new Error(
            typeof profile?.message === "string"
                ? `GitHub Token 无效或已过期：${profile.message}`
                : "GitHub Token 无效：未返回账号信息。",
        );
    }

    return {
        avatar: profile?.avatar_url ?? "",
        username: profile.login,
        name: profile?.name ?? profile.login,
        token: trimmed,
        scopes: [],
        profileUrl: profile?.html_url,
    };
}

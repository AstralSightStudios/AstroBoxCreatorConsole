import axios from "axios";
import { invoke } from "@tauri-apps/api/core";
import { GITHUB_OAUTH_CONFIG } from "~/config/github";
import { setGithubAccount, type GithubAccount } from "./store";

const isWeb = typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__;

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
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

export function isTauriEnvironment() {
    return (
        typeof window !== "undefined" &&
        Boolean(
            (window as any).__TAURI_INTERNALS__ ||
                (window as any).__TAURI_METADATA__ ||
                (window as any).__TAURI_IPC__,
        )
    );
}

/** OAuth 回调 scheme,对应 tauri.conf.json deep-link schemes。 */
export const GITHUB_TAURI_REDIRECT_URI = "astroboxcc://oauth/callback";

/**
 * GitHub OAuth 回调地址必须与 OAuth App 后台注册的 redirect URI 逐字一致。
 * - Tauri 桌面端:自定义 scheme,由 deep-link 插件接住。
 * - Web 端:站内路由,由 /oauth-callback 页接收。
 */
export function getGithubRedirectUri(): string {
    return isTauriEnvironment()
        ? GITHUB_TAURI_REDIRECT_URI
        : `${window.location.origin}/oauth-callback`;
}

// reqwest(Rust 代理)在本机代理环境下对 github.com 的连接可能无限挂起(invoke 不返回、
// 也不抛错),导致 exchangeGithubCode 卡死在「正在换取访问令牌…」。这里给 invoke 加超时,
// 超时后回退到 axios(走 webview 网络栈,与 githubFetch 同一路径,已被证明可用)。
const INVOKE_TIMEOUT_MS = 15_000;

async function githubRequest<T>(options: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
}): Promise<T> {
    const { url, method = "GET", headers, body } = options;

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
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `GitHub 请求超时（${Math.round(INVOKE_TIMEOUT_MS / 1000)} 秒无响应），已切换直连。`,
                                ),
                            ),
                        INVOKE_TIMEOUT_MS,
                    ),
                ),
            ]);
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
        timeout: INVOKE_TIMEOUT_MS,
    });

    return response.data;
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

function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 生成 PKCE code_verifier(32 字节随机 → base64url,符合 43–128 字符要求)。 */
export function generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes.buffer);
}

/** S256 code_challenge = base64url(sha256(code_verifier))。 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
    );
    return base64UrlEncode(digest);
}

/** 构造 GitHub 授权页 URL(public client + PKCE,无 client_secret)。 */
export function buildGithubAuthorizeUrl(
    state: string,
    codeChallenge: string,
): string {
    const params = new URLSearchParams({
        client_id: GITHUB_OAUTH_CONFIG.clientId,
        redirect_uri: getGithubRedirectUri(),
        scope: GITHUB_OAUTH_CONFIG.scopes.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        allow_signup: "false",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** 用一次性授权 code + code_verifier 换取 access token。 */
export async function exchangeGithubCode(
    code: string,
    codeVerifier: string,
): Promise<GithubTokenPayload> {
    ensureClientId();

    const params = new URLSearchParams({
        client_id: GITHUB_OAUTH_CONFIG.clientId,
        redirect_uri: getGithubRedirectUri(),
        code,
        code_verifier: codeVerifier,
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

    // 诊断:登录失败时记录交换响应的 error 字段(不记录 token 本身)。
    if (data.error || !data.access_token) {
        console.warn(
            "[exchange] token response",
            JSON.stringify({
                error: data.error,
                error_description: data.error_description,
                has_access_token: Boolean(data.access_token),
            }),
        );
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
        scopes: parsedScopes.length ? parsedScopes : GITHUB_OAUTH_CONFIG.scopes,
    };
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

export interface GithubPollOptions {
    signal?: AbortSignal;
    onStatusChange?: (status: string) => void;
}

/** 设备码流程:作为 Auth Code + PKCE(deep-link 回调)失效时的回退。 */
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

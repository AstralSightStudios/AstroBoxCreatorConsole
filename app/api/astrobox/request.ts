import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import {
    getAstroboxToken,
    getAstroboxRefreshToken,
    setAstroboxTokens,
    logoutAccount,
} from "~/logic/account/store";

// 统一的接口错误：尽量把服务端返回的真实信息透出来，而不是 axios 默认的
// "Request failed with status code 4xx"。保留 status/response 兼容历史上读
// err.response.data.message 的调用点。
export class ApiError extends Error {
    status?: number;
    response?: unknown;
    data?: unknown;

    constructor(
        message: string,
        options?: { status?: number; response?: unknown; data?: unknown },
    ) {
        super(message);
        this.name = "ApiError";
        this.status = options?.status;
        this.response = options?.response;
        this.data = options?.data;
    }
}

export interface AstroboxTokenPair {
    error?: string;
    token: string;
    refreshToken: string;
}

interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
    _retry?: boolean;
    _autoRefresh?: boolean;
}

function extractServerMessage(data: unknown, fallback: string): string {
    if (typeof data === "string" && data.trim()) return data.trim();

    if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        for (const key of ["message", "error", "reason", "msg", "detail"]) {
            const value = obj[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }
    }

    return fallback;
}

function isUserBannedError(data: unknown): boolean {
    return (
        data !== null &&
        typeof data === "object" &&
        (data as Record<string, unknown>).error === "user-banned"
    );
}

type RefreshResult = "success" | "invalid" | "transient";

let refreshPromise: Promise<RefreshResult> | null = null;
let refreshQueue: Array<{
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    config: RetryableAxiosRequestConfig;
}> = [];

async function refreshAstroboxToken(refreshToken: string): Promise<AstroboxTokenPair> {
    const { data } = await axios.post<AstroboxTokenPair>(
        `${ASTROBOX_SERVER_CONFIG.serverUrl}/auth/refresh_token`,
        { refreshToken },
        { timeout: 10_000 },
    );
    return data;
}

function classifyRefreshFailure(error: unknown): "invalid" | "transient" {
    if (!axios.isAxiosError(error)) {
        // 非 axios 错误（如异常 JSON）无法确认 refresh token 是否失效，先按 transient 处理。
        return "transient";
    }

    // 没有响应对象说明是网络层错误（超时、断网等），不把用户登出。
    if (!error.response) {
        return "transient";
    }

    // 服务端临时故障（5xx）或限流/超时也不应直接登出用户。
    const status = error.response.status;
    if (status >= 500 && status < 600) {
        return "transient";
    }
    if (status === 408 || status === 429) {
        return "transient";
    }

    return "invalid";
}

async function performTokenRefresh(): Promise<RefreshResult> {
    const refreshToken = getAstroboxRefreshToken();
    if (!refreshToken) {
        return "invalid";
    }

    try {
        const result = await refreshAstroboxToken(refreshToken);
        if (result.error || !result.token) {
            return "invalid";
        }
        setAstroboxTokens(result.token, result.refreshToken || refreshToken);
        return "success";
    } catch (error) {
        console.warn("[astrobox] refresh token failed", error);
        return classifyRefreshFailure(error);
    }
}

async function refreshAccessToken(): Promise<RefreshResult> {
    if (!refreshPromise) {
        refreshPromise = performTokenRefresh().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

function processRefreshQueue(result: RefreshResult) {
    const queue = refreshQueue;
    refreshQueue = [];

    if (result === "invalid") {
        logoutAccount("astrobox");
        queue.forEach(({ reject }) => {
            reject(
                new ApiError("登录已过期，请重新登录", {
                    status: 401,
                }),
            );
        });
        return;
    }

    if (result === "transient") {
        queue.forEach(({ reject }) => {
            reject(
                new ApiError("网络异常，刷新登录状态失败，请稍后重试", {
                    status: 503,
                }),
            );
        });
        return;
    }

    const newToken = getAstroboxToken();
    queue.forEach(({ resolve, reject, config }) => {
        if (newToken) {
            config.headers["X-ASTROBOX-TOKEN"] = newToken;
        }
        astroboxApi.request(config).then(resolve).catch(reject);
    });
}

const astroboxApi = axios.create({
    baseURL: ASTROBOX_SERVER_CONFIG.serverUrl,
});

astroboxApi.interceptors.request.use((config) => {
    // sendApiRequest 会把显式 token 或当前存储 token 直接放到 headers 里；
    // 这里只兜底处理那些不走 sendApiRequest 而直接用 astroboxApi 的请求。
    const storedToken = getAstroboxToken();
    if (!config.headers["X-ASTROBOX-TOKEN"] && storedToken) {
        config.headers["X-ASTROBOX-TOKEN"] = storedToken;
    }
    return config;
});

astroboxApi.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalConfig = error.config as RetryableAxiosRequestConfig | undefined;
        if (!originalConfig) {
            return Promise.reject(error);
        }

        const status = error.response?.status;
        // 服务端对过期/无效 token 返回 403（并带文字提示），封禁返回 403 JSON。
        // 401/403 且非封禁时，尝试用 refresh token 续期。
        if (status !== 401 && status !== 403) {
            return Promise.reject(error);
        }

        const responseData = error.response?.data;
        if (isUserBannedError(responseData)) {
            return Promise.reject(error);
        }

        // 只有 sendApiRequest 未显式传入 token 的请求才自动续期；
        // 显式传入其他 token 的请求（如登录流程）由调用方自己处理。
        if (!originalConfig._autoRefresh) {
            return Promise.reject(error);
        }

        if (originalConfig._retry) {
            return Promise.reject(error);
        }
        originalConfig._retry = true;

        return new Promise((resolve, reject) => {
            refreshQueue.push({ resolve, reject, config: originalConfig });

            if (!refreshPromise) {
                refreshAccessToken().then((result) => {
                    processRefreshQueue(result);
                });
            }
        });
    },
);

export async function sendApiRequest<T>(
    url: string,
    method: string,
    token?: string,
    data?: any,
): Promise<T> {
    const authToken = token || getAstroboxToken();
    const headers: Record<string, string> = {};
    if (authToken) {
        headers["X-ASTROBOX-TOKEN"] = authToken;
    }

    try {
        const response = await astroboxApi.request<T>({
            url,
            method,
            data,
            headers,
            _autoRefresh: !token,
        } as RetryableAxiosRequestConfig);

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const fallback = status
                ? `请求失败（HTTP ${status}）`
                : error.message || "请求失败";
            const message = extractServerMessage(error.response?.data, fallback);

            throw new ApiError(message, {
                status,
                response: error.response,
                data: error.response?.data,
            });
        }

        throw error;
    }
}

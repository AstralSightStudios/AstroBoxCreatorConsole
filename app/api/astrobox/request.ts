import axios from "axios";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { getAstroboxToken } from "~/logic/account/store";

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
        const response = await axios.request<T>({
            url: `${ASTROBOX_SERVER_CONFIG.serverUrl}${url}`,
            method,
            data,
            headers,
        });

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

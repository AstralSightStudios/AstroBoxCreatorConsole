import { invoke, isTauri } from "@tauri-apps/api/core";
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from "axios";

interface NativeReviewResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

type NativeReviewInvoke = (
  command: string,
  args: {
    request: { url: string; method: string; token?: string; body?: string };
  },
) => Promise<NativeReviewResponse>;

/** 审核辅助在 Tauri 中走 Rust；浏览器继续使用常规 HTTP。 */
export function shouldUseNativeReviewTransport(url: string, native = isTauri()): boolean {
  return native && url.startsWith("/admin/review/");
}

/**
 * 保留 Axios 的状态码、正文转换和错误语义，让原有的登录续期、请求日志继续生效。
 * 这里不重试：有响应的 401/403 交给统一拦截器，网络错误不能重发可能已经创建任务的 POST。
 */
export function createNativeReviewAdapter(
  nativeInvoke: NativeReviewInvoke = (command, args) => invoke<NativeReviewResponse>(command, args),
): AxiosAdapter {
  return async (config) => {
    let result: NativeReviewResponse;
    try {
      const token = config.headers.get("X-ASTROBOX-TOKEN");
      result = await nativeInvoke("astrobox_review_request", {
        request: {
          url: new URL(config.url ?? "", config.baseURL).toString(),
          method: (config.method ?? "get").toUpperCase(),
          ...(typeof token === "string" ? { token } : {}),
          ...(config.data !== undefined && config.data !== null
            ? { body: typeof config.data === "string" ? config.data : JSON.stringify(config.data) }
            : {}),
        },
      });
    } catch (error) {
      throw new AxiosError(
        error instanceof Error ? error.message : String(error),
        AxiosError.ERR_NETWORK,
        config,
      );
    }
    const response: AxiosResponse = {
      data: result.body,
      status: result.status,
      statusText: result.statusText,
      headers: AxiosHeaders.from(result.headers),
      config,
    };
    if (!config.validateStatus || config.validateStatus(result.status)) return response;
    throw new AxiosError(
      `请求失败（HTTP ${result.status}）`,
      result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    );
  };
}

export const nativeReviewAdapter = createNativeReviewAdapter();

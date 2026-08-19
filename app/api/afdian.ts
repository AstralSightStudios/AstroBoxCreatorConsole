import { invoke } from "@tauri-apps/api/core";
import MD5 from "crypto-js/md5";

export interface AfdianSkuDetail {
  sku_id: string;
  count?: number;
  name?: string;
  [key: string]: unknown;
}

export interface AfdianOrder {
  out_trade_no: string;
  custom_order_id?: string;
  user_id: string;
  plan_id: string;
  month?: number;
  total_amount?: string;
  show_amount?: string;
  status: number;
  product_type?: number;
  create_time?: number | string;
  pay_time?: number | string;
  sku_detail?: AfdianSkuDetail[];
  [key: string]: unknown;
}

interface AfdianApiResponse {
  ec: number;
  em?: string;
  data?: {
    list?: AfdianOrder[];
    total_count?: number;
    total_page?: number;
  };
}

export class AfdianApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "AfdianApiError";
    this.code = code;
  }
}

export interface AfdianFetchProgress {
  stage: "fetching";
  page: number;
  totalPages: number;
  fetchedOrders: number;
  totalOrders?: number;
}
const isTauriEnvironment = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window ||
    "__TAURI_METADATA__" in window ||
    "__TAURI_IPC__" in window);

export function buildAfdianSign(
  token: string,
  params: string,
  ts: number,
  userId: string,
) {
  return MD5(
    `${token}params${params}ts${ts}user_id${userId}`,
  ).toString();
}

async function queryOrderPage(
  userId: string,
  token: string,
  page: number,
  perPage: number,
): Promise<AfdianApiResponse> {
  const params = JSON.stringify({ page, per_page: perPage });
  const ts = Math.floor(Date.now() / 1000);
  const requestBody = JSON.stringify({
    user_id: userId,
    params,
    ts,
    sign: buildAfdianSign(token, params, ts, userId),
  });

  let payload: AfdianApiResponse;
  let httpStatus = 200;
  if (isTauriEnvironment()) {
    try {
      payload = await invoke<AfdianApiResponse>("afdian_request", {
        body: requestBody,
      });
    } catch (error) {
      throw new AfdianApiError(
        typeof error === "string" ? error : "爱发电网络请求失败，请检查网络连接",
      );
    }
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch("https://ifdian.net/api/open/query-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      });
    } catch (error) {
      const message = (error as Error)?.name === "AbortError"
        ? "爱发电请求超时，请稍后重试"
        : "爱发电网络连接失败；如果你使用的是网页预览，请改用桌面客户端"
      ;
      throw new AfdianApiError(message);
    } finally {
      clearTimeout(timer);
    }

    httpStatus = response.status;
    try {
      payload = (await response.json()) as AfdianApiResponse;
    } catch {
      throw new AfdianApiError(`爱发电接口返回了无效响应（HTTP ${response.status}）`);
    }
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    throw new AfdianApiError(
      payload.em || `爱发电请求失败（HTTP ${httpStatus}）`,
      payload.ec,
    );
  }
  if (payload.ec !== 200) {
    throw new AfdianApiError(payload.em || `爱发电请求失败（错误码 ${payload.ec}）`, payload.ec);
  }

  return payload;
}

export async function fetchAfdianOrders(
  userId: string,
  token: string,
  options: {
    perPage?: number;
    maxPages?: number;
    startDate?: string;
    onProgress?: (progress: AfdianFetchProgress) => void;
  } = {},
) {
  const normalizedUserId = userId.trim();
  const normalizedToken = token.trim();
  if (!normalizedUserId || !normalizedToken) {
    throw new AfdianApiError("请输入爱发电 user_id 和 API token");
  }

  const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage || 100)));
  const maxPages = options.maxPages === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor(options.maxPages));
  const startTimestamp = options.startDate
    ? new Date(`${options.startDate}T00:00:00`).getTime()
    : undefined;
  const hasStartDate = startTimestamp !== undefined && Number.isFinite(startTimestamp);
  const orders: AfdianOrder[] = [];
  let totalPage = 1;
  let totalOrders: number | undefined;

  for (let page = 1; page <= totalPage && page <= maxPages; page += 1) {
    const payload = await queryOrderPage(
      normalizedUserId,
      normalizedToken,
      page,
      perPage,
    );
    const list = payload.data?.list || [];
    totalPage = Math.max(1, Math.floor(payload.data?.total_page || 1));
    totalOrders = typeof payload.data?.total_count === "number"
      ? payload.data.total_count
      : totalOrders;

    const pageOrders = hasStartDate
      ? list.filter((order) => {
          const value = order.create_time ?? order.pay_time;
          if (value === undefined || value === null || value === "") return true;
          const numeric = Number(value);
          const timestamp = Number.isFinite(numeric)
            ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
            : new Date(String(value)).getTime();
          return !Number.isFinite(timestamp) || timestamp >= startTimestamp!;
        })
      : list;
    orders.push(...pageOrders);
    options.onProgress?.({
      stage: "fetching",
      page,
      totalPages: totalPage,
      fetchedOrders: orders.length,
      totalOrders,
    });

    if (hasStartDate) {
      const knownTimestamps = list
        .map((order) => {
          const value = order.create_time ?? order.pay_time;
          if (value === undefined || value === null || value === "") return NaN;
          const numeric = Number(value);
          return Number.isFinite(numeric)
            ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
            : new Date(String(value)).getTime();
        })
        .filter(Number.isFinite);
      if (knownTimestamps.length > 0 && Math.min(...knownTimestamps) < startTimestamp!) {
        break;
      }
    }
  }

  if (totalPage > maxPages) {
    throw new AfdianApiError(
      `订单页数超过单次同步上限（${maxPages} 页），请调整起始日期或分批同步`,
    );
  }

  return orders;
}

import { expect, test } from "bun:test";
import axios, { AxiosError } from "axios";
import {
  createNativeReviewAdapter,
  shouldUseNativeReviewTransport,
} from "../../app/api/astrobox/native-review-request";

const baseURL = "https://astrobox-api.astralsight.space";
const ok = { status: 200, statusText: "OK", headers: {}, body: '{"runId":"run-1"}' };

test("审核辅助只在原生环境使用 Rust，浏览器及其他接口保持原通道", () => {
  expect(shouldUseNativeReviewTransport("/admin/review/ai/runs", true)).toBe(true);
  expect(shouldUseNativeReviewTransport("/admin/review/presets", true)).toBe(true);
  expect(shouldUseNativeReviewTransport("/admin/review/ai/runs", false)).toBe(false);
  expect(shouldUseNativeReviewTransport("/resource/view", true)).toBe(false);
});

test("原生通道携带认证头和完整 JSON，保留 Axios 的 JSON 响应转换", async () => {
  const calls: unknown[] = [];
  const adapter = createNativeReviewAdapter(async (command, args) => {
    calls.push({ command, ...args });
    return ok;
  });
  const client = axios.create({ baseURL, adapter });
  // 大于 nginx 原先的 1 MiB：IPC 不应截断 base64。
  const body = { images: [{ data: "a".repeat(1_200_000) }] };
  const result = await client.post("/admin/review/ai/runs", body, {
    headers: { "X-ASTROBOX-TOKEN": "test-token" },
  });
  expect(result.data).toEqual({ runId: "run-1" });
  expect(calls).toEqual([{
    command: "astrobox_review_request",
    request: {
      url: `${baseURL}/admin/review/ai/runs`, method: "POST", token: "test-token",
      body: JSON.stringify(body),
    },
  }]);
});

test("403 保留为 AxiosError，续期后重试仍走原生并携带新 token", async () => {
  const tokens: Array<string | undefined> = [];
  const adapter = createNativeReviewAdapter(async (_command, { request }) => {
    tokens.push(request.token);
    return request.token === "old"
      ? { status: 403, statusText: "Forbidden", headers: {}, body: '{"error":"expired"}' }
      : ok;
  });
  const client = axios.create({ baseURL, adapter });
  client.interceptors.response.use(undefined, async (error: unknown) => {
    expect(axios.isAxiosError(error)).toBe(true);
    const rejected = error as AxiosError;
    expect(rejected.response?.status).toBe(403);
    expect(rejected.response?.data).toEqual({ error: "expired" });
    expect(rejected.config?.adapter).toBe(adapter);
    rejected.config!.headers.set("X-ASTROBOX-TOKEN", "new");
    return client.request(rejected.config!);
  });
  const result = await client.post("/admin/review/ai/runs", { images: [] }, {
    headers: { "X-ASTROBOX-TOKEN": "old" },
  });
  expect(result.data.runId).toBe("run-1");
  expect(tokens).toEqual(["old", "new"]);
});

test("413 和 429 保留真实状态、错误正文及 retry-after", async () => {
  for (const status of [413, 429]) {
    const adapter = createNativeReviewAdapter(async () => ({
      status, statusText: "Rejected", headers: { "retry-after": "60" },
      body: JSON.stringify({ error: status === 413 ? "ai_request_too_large" : "ai_busy" }),
    }));
    const client = axios.create({ baseURL, adapter });
    try {
      await client.post("/admin/review/ai/runs", {});
      throw new Error("request should be rejected");
    } catch (error) {
      expect(axios.isAxiosError(error)).toBe(true);
      const rejected = error as AxiosError;
      expect(rejected.response?.status).toBe(status);
      expect(rejected.response?.headers["retry-after"]).toBe("60");
      expect(rejected.response?.data).toEqual({ error: status === 413 ? "ai_request_too_large" : "ai_busy" });
    }
  }
});

test("网络故障不自动重发可能已经创建任务的 POST", async () => {
  let calls = 0;
  const adapter = createNativeReviewAdapter(async () => {
    calls++;
    throw "无法连接 AstroBox 审核服务，请检查网络后重试";
  });
  const client = axios.create({ baseURL, adapter });
  await expect(client.post("/admin/review/ai/runs", {})).rejects.toMatchObject({
    code: AxiosError.ERR_NETWORK,
    message: "无法连接 AstroBox 审核服务，请检查网络后重试",
  });
  expect(calls).toBe(1);
});

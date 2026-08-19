import { afterEach, describe, expect, test } from "bun:test";
import {
  buildAfdianSign,
  fetchAfdianOrders,
} from "../../app/api/afdian";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Afdian API client", () => {
  test("uses the documented signature and fetches every page", async () => {
    const requests: Array<{ params: string; ts: number; sign: string }> = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const page = JSON.parse(body.params).page;
      return new Response(
        JSON.stringify({
          ec: 200,
          data: {
            total_page: 2,
            list: [
              {
                out_trade_no: `order-${page}`,
                user_id: "buyer",
                plan_id: "plan",
                status: 2,
                sku_detail: [{ sku_id: "sku" }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const orders = await fetchAfdianOrders("seller", "token");

    expect(orders.map((order) => order.out_trade_no)).toEqual([
      "order-1",
      "order-2",
    ]);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.sign).toBe(
        buildAfdianSign("token", request.params, request.ts, "seller"),
      );
    }
  });

  test("stops at the configured start date without applying a page-count cap", async () => {
    const requestedPages: number[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const page = JSON.parse(body.params).page;
      requestedPages.push(page);
      return new Response(
        JSON.stringify({
          ec: 200,
          data: {
            total_page: 101,
            list: page < 101
              ? [{
                  out_trade_no: `recent-${page}`,
                  user_id: "buyer",
                  plan_id: "plan",
                  status: 2,
                  create_time: 1_800_000_000,
                  sku_detail: [{ sku_id: "sku" }],
                }]
              : [{
                  out_trade_no: `old-${page}`,
                  user_id: "buyer",
                  plan_id: "plan",
                  status: 2,
                  create_time: 1_700_000_000,
                  sku_detail: [{ sku_id: "sku" }],
                }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const progress: number[] = [];
    const orders = await fetchAfdianOrders("seller", "token", {
      startDate: "2027-01-01",
      onProgress: ({ page }) => progress.push(page),
    });

    expect(requestedPages).toHaveLength(101);
    expect(progress).toHaveLength(101);
    expect(orders).toHaveLength(100);
    expect(orders.at(-1)?.out_trade_no).toBe("recent-100");
  });

  test("throws the platform error instead of treating an error response as empty", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ec: 400005, em: "sign validation failed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await expect(fetchAfdianOrders("seller", "token")).rejects.toThrow(
      "sign validation failed",
    );
  });
});

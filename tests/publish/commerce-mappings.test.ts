import { beforeEach, describe, expect, test } from "bun:test";
import { parseAfdUrl } from "../../app/logic/publish/afdian-url";
import {
  getPlatformConfigDrafts,
  upsertPlatformConfigDraft,
} from "../../app/logic/publish/platform-config-drafts";

const storage = new Map<string, string>();

(globalThis as any).window = globalThis;
(globalThis as any).localStorage = {
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

beforeEach(() => {
  storage.clear();
});

describe("Afdian purchase URL parsing", () => {
  test("parses bundle type, plan ID, and every unique SKU", () => {
    const sku = encodeURIComponent(
      JSON.stringify([
        { sku_id: "sku-a", count: 1 },
        { sku_id: "sku-b", count: 1 },
        { sku_id: "sku-a", count: 1 },
      ]),
    );
    const result = parseAfdUrl(
      `https://www.ifdian.net/order/create?product_type=2&plan_id=bundle-plan&sku=${sku}&bundle_count=1`,
    );

    expect(result).toEqual({
      productId: "bundle-plan",
      productType: 2,
      skuIds: ["sku-a", "sku-b"],
    });
  });

  test("keeps a plan when the URL has no SKU and rejects malformed input", () => {
    expect(
      parseAfdUrl(
        "https://www.ifdian.net/order/create?product_type=1&plan_id=product-plan",
      ),
    ).toEqual({
      productId: "product-plan",
      productType: 1,
      skuIds: [],
    });
    expect(parseAfdUrl("not a URL")).toEqual({ skuIds: [] });
  });
});

describe("platform configuration drafts", () => {
  test("keeps multiple plan and SKU mappings for one resource device", () => {
    const base = {
      resourceId: "resource-a",
      deviceId: "device-a",
      platform: "afd" as const,
      title: "Purchase",
      enabled: true,
    };

    upsertPlatformConfigDraft({
      ...base,
      externalProductId: "plan-a",
      externalSkuId: "sku-a",
    });
    upsertPlatformConfigDraft({
      ...base,
      externalProductId: "plan-b",
      externalSkuId: "sku-b",
    });
    upsertPlatformConfigDraft({
      ...base,
      externalProductId: "plan-a",
      externalSkuId: "sku-a",
      title: "Updated purchase",
    });

    expect(getPlatformConfigDrafts()).toHaveLength(2);
    expect(
      getPlatformConfigDrafts().find(
        (draft) =>
          draft.externalProductId === "plan-a" &&
          draft.externalSkuId === "sku-a",
      )?.title,
    ).toBe("Updated purchase");
  });
});

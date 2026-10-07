import { describe, expect, test } from "bun:test";
import { findUnprotectedEncryptedDevices } from "../../app/logic/publish/unpaid-encryption";

function sku(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: "979881091817",
    deviceId: "xmb10",
    isPaid: true,
    validationStatus: "active",
    ...overrides,
  };
}

function check(input: {
  encryptedDeviceIds?: string[];
  skus?: ReturnType<typeof sku>[];
  externalAuthorizations?: Array<{ resourceId: string; deviceId: string }>;
}) {
  return findUnprotectedEncryptedDevices({
    resourceId: "979881091817",
    encryptedDeviceIds: input.encryptedDeviceIds ?? ["xmb10"],
    skus: input.skus ?? [],
    externalAuthorizations: input.externalAuthorizations ?? [],
  });
}

describe("findUnprotectedEncryptedDevices", () => {
  test("flags encrypted devices without any paid config", () => {
    expect(check({ encryptedDeviceIds: ["xmb10", "xmb11"], skus: [sku()] })).toEqual(["xmb11"]);
  });

  test("ignores SKUs configured under another resource id", () => {
    // 换过资源 ID：密钥传到新 ID，SKU 还在旧 ID 上，用户照样能免费拿到密钥
    expect(check({ skus: [sku({ resourceId: "979885846855" })] })).toEqual(["xmb10"]);
  });

  test("does not count free or owner-rejected SKUs", () => {
    expect(check({ skus: [sku({ isPaid: false })] })).toEqual(["xmb10"]);
    expect(check({ skus: [sku({ validationStatus: "rejected_resource_owner" })] })).toEqual(["xmb10"]);
  });

  test("counts disabled and pending paid SKUs, like the server does", () => {
    expect(check({ skus: [sku({ enabled: false } as any)] })).toEqual([]);
    expect(check({ skus: [sku({ validationStatus: "pending_resource_review" })] })).toEqual([]);
    expect(check({ skus: [sku({ validationStatus: "pending_manifest_device" })] })).toEqual([]);
  });

  test("treats external authorization on the same resource id as protected", () => {
    expect(
      check({ externalAuthorizations: [{ resourceId: "979881091817", deviceId: "xmb10" }] }),
    ).toEqual([]);
    expect(
      check({ externalAuthorizations: [{ resourceId: "979885846855", deviceId: "xmb10" }] }),
    ).toEqual(["xmb10"]);
  });

  test("deduplicates and trims device ids", () => {
    expect(check({ encryptedDeviceIds: [" xmb10 ", "xmb10", ""] })).toEqual(["xmb10"]);
  });
});

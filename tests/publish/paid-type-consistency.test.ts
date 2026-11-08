import { describe, expect, test } from "bun:test";
import {
  findEnabledPaidSkus,
  findPaidTypeMismatch,
  isPaidDirectoryType,
} from "../../app/logic/publish/paid-type-consistency";

function sku(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "xmb10",
    platform: "afd",
    externalProductId: "product-1",
    externalSkuId: "sku-1",
    isPaid: true,
    enabled: true,
    validationStatus: "active",
    ...overrides,
  };
}

describe("isPaidDirectoryType", () => {
  test("paid 与 force_paid 都算已标注付费", () => {
    expect(isPaidDirectoryType("paid")).toBe(true);
    expect(isPaidDirectoryType(" force_paid ")).toBe(true);
  });

  test("空串与 free 视为免费", () => {
    expect(isPaidDirectoryType("")).toBe(false);
    expect(isPaidDirectoryType(undefined)).toBe(false);
    expect(isPaidDirectoryType("free")).toBe(false);
  });
});

describe("findEnabledPaidSkus", () => {
  test("只统计启用中的付费 SKU", () => {
    const skus = [
      sku(),
      sku({ deviceId: "xmb11", isPaid: false }),
      sku({ deviceId: "xmb12", enabled: false }),
    ];
    expect(findEnabledPaidSkus(skus).map((item) => item.deviceId)).toEqual(["xmb10"]);
  });

  test("服务端已拒绝归属的 SKU 不算", () => {
    expect(
      findEnabledPaidSkus([sku({ validationStatus: "rejected_resource_owner" })]),
    ).toEqual([]);
  });

  test("待审状态仍按生效处理", () => {
    expect(
      findEnabledPaidSkus([
        sku({ validationStatus: "pending_resource_review" }),
        sku({ deviceId: "xmb11", validationStatus: "pending_manifest_device" }),
      ]),
    ).toHaveLength(2);
  });
});

describe("findPaidTypeMismatch", () => {
  test("标注免费却存在启用中的付费 SKU 时报告冲突", () => {
    const mismatch = findPaidTypeMismatch({
      paidType: "",
      skus: [sku()],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.deviceIds).toEqual(["xmb10"]);
    expect(mismatch?.skuLabels).toEqual(["xmb10 → afd:product-1/sku-1"]);
  });

  test("已标注付费时不报告冲突", () => {
    expect(findPaidTypeMismatch({ paidType: "paid", skus: [sku()] })).toBeNull();
    expect(
      findPaidTypeMismatch({ paidType: "force_paid", skus: [sku()] }),
    ).toBeNull();
  });

  test("没有启用中的付费 SKU 时不报告冲突", () => {
    expect(findPaidTypeMismatch({ paidType: "", skus: [] })).toBeNull();
    expect(
      findPaidTypeMismatch({ paidType: "", skus: [sku({ enabled: false })] }),
    ).toBeNull();
    expect(
      findPaidTypeMismatch({ paidType: "", skus: [sku({ isPaid: false })] }),
    ).toBeNull();
  });

  test("同一设备的多条 SKU 只列一次设备，但保留每条配置", () => {
    const mismatch = findPaidTypeMismatch({
      paidType: "free",
      skus: [
        sku(),
        sku({ externalSkuId: "sku-2" }),
        sku({ deviceId: "xmb11", externalSkuId: "sku-3" }),
      ],
    });
    expect(mismatch?.deviceIds).toEqual(["xmb10", "xmb11"]);
    expect(mismatch?.skuLabels).toHaveLength(3);
  });
});

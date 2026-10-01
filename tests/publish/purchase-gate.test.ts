import { describe, expect, test } from "bun:test";
import {
  describeLockedDevice,
  evaluateDeviceGates,
  findUnpaidSkuDevices,
  isConfigEffectiveAfterMerge,
  type CommerceExternalAuthorization,
  type CommerceFileKey,
  type CommerceProduct,
  type CommerceSku,
} from "../../app/routes/resreview/utils/purchase-gate";

const SELLER = "u_author";

function sku(overrides: Partial<CommerceSku> = {}): CommerceSku {
  return {
    deviceId: "device_a",
    platform: "afd",
    externalProductId: "plan_1",
    externalSkuId: "sku_1",
    isPaid: true,
    enabled: true,
    buyUrl: "https://ifdian.net/order/create?plan_id=plan_1",
    validationStatus: "active",
    ...overrides,
  };
}

function product(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    platform: "afd",
    externalProductId: "plan_1",
    validationStatus: "active",
    ...overrides,
  };
}

function ext(overrides: Partial<CommerceExternalAuthorization> = {}): CommerceExternalAuthorization {
  return {
    deviceId: "device_a",
    sellerUserId: SELLER,
    enabled: true,
    ...overrides,
  };
}

function fileKey(overrides: Partial<CommerceFileKey> = {}): CommerceFileKey {
  return { deviceId: "device_a", firstOwnerId: SELLER, ...overrides };
}

function evaluate(overrides: {
  devices?: string[];
  skus?: CommerceSku[];
  products?: CommerceProduct[];
  externalAuthorizations?: CommerceExternalAuthorization[];
  fileKeys?: CommerceFileKey[];
  sellerUserId?: string;
} = {}) {
  return evaluateDeviceGates({
    devices: overrides.devices ?? ["device_a"],
    skus: overrides.skus ?? [],
    products: overrides.products ?? [],
    externalAuthorizations: overrides.externalAuthorizations ?? [],
    fileKeys: overrides.fileKeys ?? [],
    sellerUserId: overrides.sellerUserId,
  });
}

describe("isConfigEffectiveAfterMerge", () => {
  test("把审核期正常态视为生效", () => {
    expect(isConfigEffectiveAfterMerge("pending_resource_review")).toBe(true);
    expect(isConfigEffectiveAfterMerge("active")).toBe(true);
    expect(isConfigEffectiveAfterMerge(undefined)).toBe(true);
    expect(isConfigEffectiveAfterMerge("")).toBe(true);
  });

  test("服务端已拒绝的两类脏配置视为不生效", () => {
    expect(isConfigEffectiveAfterMerge("rejected_resource_owner")).toBe(false);
    expect(isConfigEffectiveAfterMerge("pending_manifest_device")).toBe(false);
  });
});

describe("evaluateDeviceGates", () => {
  test("仅加密不售卖：零 SKU 的设备判为 free", () => {
    const { reasons } = evaluate({
      devices: ["device_a", "device_b"],
      skus: [],
      fileKeys: [fileKey(), fileKey({ deviceId: "device_b" })],
    });
    expect(reasons.map((r) => r.verdict)).toEqual(["free", "free"]);
  });

  test("付费 SKU 入口完整时判为 unlocked", () => {
    const { reasons } = evaluate({
      skus: [sku()],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("unlocked");
    expect(reasons[0].missingPurchase).toEqual([]);
  });

  test("isPaid 为 true 但 enabled 关闭 → 锁死", () => {
    const { reasons } = evaluate({
      skus: [sku({ enabled: false })],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].missingPurchase).toContain("disabled");
  });

  test("isPaid 为 true 但未登记对应商品 → 锁死", () => {
    const { reasons } = evaluate({
      skus: [sku()],
      products: [],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].missingPurchase).toContain("product");
  });

  test("isPaid 为 true 但缺少购买链接 → 锁死", () => {
    const { reasons } = evaluate({
      skus: [sku({ buyUrl: "" })],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].missingPurchase).toContain("buyUrl");
  });

  test("购买入口不可用但自有网站授权可用 → unlocked", () => {
    const { reasons } = evaluate({
      skus: [sku({ enabled: false })],
      products: [product()],
      externalAuthorizations: [ext()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("unlocked");
  });

  test("自有网站授权存在即受保护：停用后仍构成付费门槛", () => {
    const { reasons } = evaluate({
      skus: [],
      externalAuthorizations: [ext({ enabled: false })],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].paidBy).toBe("external");
    expect(reasons[0].externalIssue).toBe("disabled");
  });

  test("授权卖家不是资源作者 → 服务端忽略，锁死", () => {
    const { reasons } = evaluate({
      skus: [],
      externalAuthorizations: [ext({ sellerUserId: "u_other" })],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].externalIssue).toBe("ownerMismatch");
  });

  test("授权与加密密钥归属不一致 → 锁死", () => {
    const { reasons } = evaluate({
      skus: [],
      externalAuthorizations: [ext()],
      fileKeys: [fileKey({ firstOwnerId: "u_other" })],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
    expect(reasons[0].externalIssue).toBe("fileKeyOwnerMismatch");
  });

  test("无加密密钥时归属校验跳过，授权仍可用", () => {
    const { reasons } = evaluate({
      skus: [],
      externalAuthorizations: [ext()],
      fileKeys: [],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("unlocked");
  });

  test("审核期 pending_resource_review 的 SKU 仍参与判定", () => {
    const { reasons } = evaluate({
      skus: [sku({ enabled: false, validationStatus: "pending_resource_review" })],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("locked");
  });

  test("rejected_resource_owner 的 SKU 不构成付费门槛", () => {
    const { reasons } = evaluate({
      skus: [sku({ validationStatus: "rejected_resource_owner" })],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("free");
  });

  test("汇总归属不符与指向不存在设备的脏配置", () => {
    const { stale } = evaluate({
      devices: ["device_a", "device_b"],
      skus: [
        sku({ validationStatus: "rejected_resource_owner" }),
        sku({
          deviceId: "device_b",
          validationStatus: "pending_manifest_device",
          externalProductId: "plan_gone",
        }),
      ],
      externalAuthorizations: [
        ext({ deviceId: "device_c", validationStatus: "rejected_resource_owner" }),
      ],
    });
    expect(stale.rejectedOwnerDevices.sort()).toEqual(["device_a", "device_c"]);
    expect(stale.pendingManifestDeviceSkus).toHaveLength(1);
    expect(stale.pendingManifestDeviceSkus[0]).toContain("plan_gone");
  });

  test("同一设备多条 SKU 时，任一入口完整即 unlocked", () => {
    const { reasons } = evaluate({
      skus: [
        sku({ enabled: false, externalSkuId: "sku_off" }),
        sku({ externalProductId: "plan_2", externalSkuId: "sku_on" }),
      ],
      products: [product(), product({ externalProductId: "plan_2" })],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    expect(reasons[0].verdict).toBe("unlocked");
  });
});

describe("describeLockedDevice", () => {
  test("未锁死的设备返回空串", () => {
    expect(describeLockedDevice({ deviceId: "d", verdict: "free", paidBy: "none", missingPurchase: [], hasFileKey: true })).toBe("");
  });

  test("锁死时给出具体环节", () => {
    const { reasons } = evaluate({
      skus: [sku({ enabled: false, buyUrl: "" })],
      products: [product()],
      fileKeys: [fileKey()],
      sellerUserId: SELLER,
    });
    const text = describeLockedDevice(reasons[0]);
    expect(text).toContain("启用");
    expect(text).toContain("购买链接");
  });
});

describe("findUnpaidSkuDevices", () => {
  test("配了 SKU 但未标记付费的设备被抓出", () => {
    expect(
      findUnpaidSkuDevices({
        devices: ["device_a", "device_b"],
        skus: [sku({ deviceId: "device_a", isPaid: false })],
      }),
    ).toEqual(["device_a"]);
  });

  test("存在任一 isPaid SKU 则不报", () => {
    expect(
      findUnpaidSkuDevices({
        devices: ["device_a"],
        skus: [sku({ isPaid: false }), sku({ externalSkuId: "sku_2", isPaid: true })],
      }),
    ).toEqual([]);
  });

  test("停用的 SKU 不计入", () => {
    expect(
      findUnpaidSkuDevices({
        devices: ["device_a"],
        skus: [sku({ isPaid: false, enabled: false })],
      }),
    ).toEqual([]);
  });

  test("无 SKU 的免费设备不报", () => {
    expect(findUnpaidSkuDevices({ devices: ["device_a"], skus: [] })).toEqual([]);
  });
});
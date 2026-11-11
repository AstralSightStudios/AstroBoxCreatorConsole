import { describe, expect, test } from "bun:test";
import type { SellerEntitlement } from "../../app/api/astrobox/order";
import {
  buyerDisplayName,
  filterEntitlementGroups,
  groupSellerEntitlements,
  isEntitlementRevoked,
  summarizeEntitlementGroups,
} from "../../app/logic/catalog/seller-entitlements";

function entitlement(overrides: Partial<SellerEntitlement> = {}): SellerEntitlement {
  return {
    buyerUserId: "buyer-1",
    buyerName: "小明",
    buyerAvatar: "",
    sellerUserId: "seller-1",
    resourceId: "res-1",
    deviceId: "xmb9p",
    sourceType: "order",
    sourcePlatform: "afd",
    sourceRef: "afd:o1:s1",
    revokedAt: "",
    revokeReason: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupSellerEntitlements", () => {
  test("同一买家同一设备的多条来源折叠成一行", () => {
    const groups = groupSellerEntitlements([
      entitlement({ sourceRef: "afd:o1:s1", createdAt: "2026-11-01T00:00:00.000Z" }),
      entitlement({ sourceType: "cdk", sourcePlatform: "cdk", sourceRef: "CODE1", createdAt: "2026-11-03T00:00:00.000Z" }),
      entitlement({ deviceId: "xmws3", sourceRef: "afd:o2:s2" }),
    ]);

    expect(groups).toHaveLength(2);
    const merged = groups.find((group) => group.deviceId === "xmb9p")!;
    expect(merged.sources.map((source) => source.sourceRef)).toEqual(["CODE1", "afd:o1:s1"]);
    expect(merged.firstGrantedAt).toBe("2026-11-01T00:00:00.000Z");
  });

  test("只要还有一条活跃记录就算生效（买家吊销后重新购买）", () => {
    const [group] = groupSellerEntitlements([
      entitlement({
        sourceRef: "afd:o1:s1",
        revokedAt: "2026-11-05T00:00:00.000Z",
        revokeReason: "已退款",
      }),
      entitlement({ sourceRef: "afd:o9:s1", createdAt: "2026-11-10T00:00:00.000Z" }),
    ]);

    expect(group!.revoked).toBe(false);
    expect(group!.revokedAt).toBe("");
    expect(group!.revokeReason).toBe("");
  });

  test("全部被吊销时取最近一次的吊销时间与原因", () => {
    const [group] = groupSellerEntitlements([
      entitlement({ sourceRef: "a", revokedAt: "2026-11-05T00:00:00.000Z", revokeReason: "早的" }),
      entitlement({ sourceRef: "b", revokedAt: "2026-11-08T00:00:00.000Z", revokeReason: "晚的" }),
    ]);

    expect(group!.revoked).toBe(true);
    expect(group!.revokedAt).toBe("2026-11-08T00:00:00.000Z");
    expect(group!.revokeReason).toBe("晚的");
  });

  test("生效中的排在已吊销之前，同状态下最近获得的在前", () => {
    const groups = groupSellerEntitlements([
      entitlement({ buyerUserId: "revoked", revokedAt: "2026-11-05T00:00:00.000Z", createdAt: "2026-11-09T00:00:00.000Z" }),
      entitlement({ buyerUserId: "old", createdAt: "2026-11-01T00:00:00.000Z" }),
      entitlement({ buyerUserId: "new", createdAt: "2026-11-04T00:00:00.000Z" }),
    ]);

    expect(groups.map((group) => group.buyerUserId)).toEqual(["new", "old", "revoked"]);
  });

  test("空列表与无法解析的时间不会抛错", () => {
    expect(groupSellerEntitlements([])).toEqual([]);
    const [group] = groupSellerEntitlements([entitlement({ createdAt: "bad" })]);
    expect(group!.revoked).toBe(false);
  });
});

describe("filterEntitlementGroups", () => {
  const groups = groupSellerEntitlements([
    entitlement({ buyerUserId: "u-1", buyerName: "小明", sourceRef: "afd:2026110100:s1" }),
    entitlement({ buyerUserId: "u-2", buyerName: "Alice", deviceId: "xmws3", sourceRef: "afd:2026110200:s2" }),
  ]);

  test("按昵称、用户 ID、单号、设备名匹配，不区分大小写", () => {
    expect(filterEntitlementGroups(groups, "alice").map((g) => g.buyerUserId)).toEqual(["u-2"]);
    expect(filterEntitlementGroups(groups, "U-1").map((g) => g.buyerUserId)).toEqual(["u-1"]);
    expect(filterEntitlementGroups(groups, "2026110200").map((g) => g.buyerUserId)).toEqual(["u-2"]);
    expect(
      filterEntitlementGroups(groups, "手环", (id) => (id === "xmb9p" ? "小米手环 9 Pro" : id)).map(
        (g) => g.buyerUserId,
      ),
    ).toEqual(["u-1"]);
  });

  test("空关键词返回全部，且不影响原数组", () => {
    const all = filterEntitlementGroups(groups, "  ");
    expect(all).toHaveLength(2);
    expect(all).not.toBe(groups);
  });
});

describe("其他辅助", () => {
  test("summarizeEntitlementGroups 统计生效与吊销数量", () => {
    const groups = groupSellerEntitlements([
      entitlement({ buyerUserId: "a" }),
      entitlement({ buyerUserId: "b", revokedAt: "2026-11-05T00:00:00.000Z" }),
      entitlement({ buyerUserId: "c", revokedAt: "2026-11-05T00:00:00.000Z" }),
    ]);

    expect(summarizeEntitlementGroups(groups)).toEqual({ total: 3, active: 1, revoked: 2 });
  });

  test("买家显示名缺失时退回用户 ID", () => {
    expect(buyerDisplayName({ buyerName: "  ", buyerUserId: "u-9" })).toBe("u-9");
    expect(buyerDisplayName({ buyerName: "小明", buyerUserId: "u-9" })).toBe("小明");
  });

  test("isEntitlementRevoked 以 revokedAt 是否非空判断", () => {
    expect(isEntitlementRevoked({ revokedAt: "" })).toBe(false);
    expect(isEntitlementRevoked({ revokedAt: "2026-11-05T00:00:00.000Z" })).toBe(true);
  });
});

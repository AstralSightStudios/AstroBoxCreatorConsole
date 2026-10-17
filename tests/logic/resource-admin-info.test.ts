import { describe, expect, test } from "bun:test";
import {
  collectResourceAdminUserIds,
  resourceSellerUserIds,
  type ResourceAdminInfo,
} from "../../app/logic/catalog/resource-admin-info";
import type {
  AdminPublicOrder,
  AdminResourceCommerceConfigs,
  AdminResourceEntitlement,
  ReportItem,
} from "../../app/api/astrobox/admin";

/** 只填测试关心的字段，其余留空，模拟一次 resource-configs 响应。 */
function buildConfigs(
  overrides: Partial<AdminResourceCommerceConfigs> = {},
): AdminResourceCommerceConfigs {
  return {
    platformConfigs: [],
    products: [],
    skus: [],
    cdkCodes: [],
    fileKeys: [],
    externalAuthorizations: [],
    ...overrides,
  };
}

const product = (sellerUserId: string) =>
  ({ sellerUserId }) as unknown as AdminResourceCommerceConfigs["products"][number];

const sku = (sellerUserId: string) =>
  ({ sellerUserId }) as unknown as AdminResourceCommerceConfigs["skus"][number];

const cdk = (sellerUserId: string) =>
  ({ sellerUserId }) as unknown as AdminResourceCommerceConfigs["cdkCodes"][number];

const externalAuth = (sellerUserId: string) =>
  ({
    sellerUserId,
  }) as unknown as NonNullable<
    AdminResourceCommerceConfigs["externalAuthorizations"]
  >[number];

const platformConfig = (sellerUserId: string) =>
  ({
    sellerUserId,
  }) as unknown as AdminResourceCommerceConfigs["platformConfigs"][number];

describe("资源售卖配置归属卖家", () => {
  test("从按资源过滤的集合里反推卖家并去重", () => {
    const configs = buildConfigs({
      products: [product("seller-a")],
      skus: [sku("seller-a"), sku("seller-a")],
      cdkCodes: [cdk("seller-a")],
      externalAuthorizations: [externalAuth("seller-a")],
    });

    expect(resourceSellerUserIds(configs)).toEqual(["seller-a"]);
  });

  test("平台配置与加密文件键不参与反推", () => {
    // platformConfigs 是卖家级全站数据、fileKeys 不带 sellerUserId，
    // 都不能用来判断资源归属。
    const configs = buildConfigs({
      platformConfigs: [platformConfig("seller-global")],
      fileKeys: [
        { firstOwnerId: "buyer-1" } as unknown as AdminResourceCommerceConfigs["fileKeys"][number],
      ],
    });

    expect(resourceSellerUserIds(configs)).toEqual([]);
  });

  test("多个卖家时保持出现顺序且不重复", () => {
    const configs = buildConfigs({
      products: [product("seller-b")],
      skus: [sku("seller-a"), sku("seller-b")],
      cdkCodes: [cdk("")],
    });

    expect(resourceSellerUserIds(configs)).toEqual(["seller-b", "seller-a"]);
  });
});

describe("详情页需要解析的账号 uid", () => {
  const info = (overrides: Partial<ResourceAdminInfo> = {}): ResourceAdminInfo =>
    ({
      configs: null,
      entitlements: [],
      orders: [],
      reports: [],
      ...overrides,
    });

  test("采集卖家 / 买家 / 兑换人 / 首位持有者并去重", () => {
    const configs = buildConfigs({
      platformConfigs: [platformConfig("seller-a")],
      products: [product("seller-a")],
      skus: [sku("seller-b")],
      cdkCodes: [
        {
          sellerUserId: "seller-a",
          redeemedByUserId: "buyer-cdk",
        } as unknown as AdminResourceCommerceConfigs["cdkCodes"][number],
      ],
      fileKeys: [
        { firstOwnerId: "owner-1" } as unknown as AdminResourceCommerceConfigs["fileKeys"][number],
      ],
    });

    const ids = collectResourceAdminUserIds(
      info({
        configs,
        entitlements: [
          {
            buyerUserId: "buyer-1",
            sellerUserId: "seller-a",
          } as unknown as AdminResourceEntitlement,
        ],
        orders: [
          {
            buyerUserId: "buyer-1",
            sellerUserId: "seller-b",
          } as unknown as AdminPublicOrder,
        ],
        reports: [
          {
            senderId: "reporter-1",
            handledBy: "admin-1",
          } as unknown as ReportItem,
        ],
      }),
    );

    expect(ids).toEqual([
      "seller-a",
      "seller-b",
      "buyer-cdk",
      "owner-1",
      "buyer-1",
      "reporter-1",
      "admin-1",
    ]);
  });

  test("空数据与空 uid 不产生条目", () => {
    expect(collectResourceAdminUserIds(null)).toEqual([]);
    expect(
      collectResourceAdminUserIds(
        info({
          reports: [
            {
              senderId: "",
              handledBy: null,
            } as unknown as ReportItem,
          ],
        }),
      ),
    ).toEqual([]);
  });
});

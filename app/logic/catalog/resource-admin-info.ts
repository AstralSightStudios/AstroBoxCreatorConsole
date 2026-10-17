import {
  AdminApi,
  type AdminPublicOrder,
  type AdminResourceCommerceConfigs,
  type AdminResourceEntitlement,
  type ReportItem,
} from "~/api/astrobox/admin";

export interface ResourceAdminInfo {
  /** 售卖配置：平台 / 商品 / SKU / CDK / 加密文件键。 */
  configs: AdminResourceCommerceConfigs | null;
  entitlements: AdminResourceEntitlement[];
  orders: AdminPublicOrder[];
  reports: ReportItem[];
}

export type ResourceAdminInfoSection = keyof ResourceAdminInfo;

export interface ResourceAdminInfoResult {
  data: ResourceAdminInfo;
  /** 按分区记录失败原因，单个接口挂掉不影响其它分区展示。 */
  errors: Partial<Record<ResourceAdminInfoSection, string>>;
}

const DEFAULT_LIMIT = 100;

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 详情页上会以账号形式展示（头像 / 昵称 / 跳转）的全部 uid，去重后返回。
 *
 * 供账号目录批量预取用：搜索要按昵称命中，就必须在过滤之前把这些 uid
 * 都解析出来，否则被关键字隐藏的行永远等不到它的昵称。
 */
export function collectResourceAdminUserIds(
  info: ResourceAdminInfo | null | undefined,
): string[] {
  if (!info) return [];
  const ids = new Set<string>();
  const add = (value?: string | null) => {
    const id = (value ?? "").trim();
    if (id) ids.add(id);
  };

  const configs = info.configs;
  if (configs) {
    for (const item of configs.platformConfigs) add(item.sellerUserId);
    for (const item of configs.products) add(item.sellerUserId);
    for (const item of configs.skus) add(item.sellerUserId);
    for (const item of configs.cdkCodes) {
      add(item.sellerUserId);
      add(item.redeemedByUserId);
    }
    for (const item of configs.fileKeys) add(item.firstOwnerId);
    for (const item of configs.externalAuthorizations ?? []) add(item.sellerUserId);
  }
  for (const item of info.entitlements) {
    add(item.buyerUserId);
    add(item.sellerUserId);
  }
  for (const item of info.orders) {
    add(item.buyerUserId);
    add(item.sellerUserId);
  }
  for (const item of info.reports) {
    add(item.senderId);
    add(item.handledBy);
  }

  return [...ids];
}

/**
 * 从「按资源 ID 过滤」的售卖配置里反推资源所属卖家。
 *
 * 平台配置（`SellerPlatformConfig`）是卖家级数据，Schema 上根本没有 resourceId，
 * 所以 `/admin/orders/resource-configs` 只带 resourceId 查询时，服务端会把
 * 全站卖家的平台配置一起返回来（见 AstroBoxServer `adminListResourceCommerceConfigs`
 * 里 platformConfigs 只按 sellerUserId 过滤）。而商品 / SKU / CDK / 自有网站授权
 * 都是真正按 resourceId 过滤并带 sellerUserId 的，用它反推卖家后再单独取一次
 * 平台配置，才不会把别家卖家的平台配置当成当前资源的售卖配置展示出来。
 */
export function resourceSellerUserIds(
  configs: AdminResourceCommerceConfigs,
): string[] {
  const ids = new Set<string>();
  const collect = (items: ReadonlyArray<{ sellerUserId: string }>) => {
    for (const item of items) {
      const id = item.sellerUserId.trim();
      if (id) ids.add(id);
    }
  };
  collect(configs.products);
  collect(configs.skus);
  collect(configs.cdkCodes);
  collect(configs.externalAuthorizations ?? []);
  return [...ids];
}

/**
 * 把售卖配置收窄到当前资源。
 *
 * 商品 / SKU / CDK / 加密文件键 / 自有网站授权已经由服务端按 resourceId 过滤，
 * 只有平台配置是卖家级的，需要按反推出的卖家再查一次（首次查询的平台配置
 * 是全站数据，不能直接用）。查不到归属或补查失败时宁可留空，也不展示别家数据。
 */
async function scopeCommerceConfigsToResource(
  configs: AdminResourceCommerceConfigs,
  resourceId: string,
  limit: number,
): Promise<AdminResourceCommerceConfigs> {
  const sellerUserIds = resourceSellerUserIds(configs);
  if (sellerUserIds.length === 0) {
    return { ...configs, platformConfigs: [] };
  }
  try {
    const scoped = await AdminApi.orders.resourceConfigs({
      resourceId,
      sellerUserId: sellerUserIds[0],
      limit,
    });
    return { ...configs, platformConfigs: scoped.platformConfigs };
  } catch {
    // 补查失败时退回「按反推卖家过滤首次结果」，至少不会串到别家卖家。
    const allowed = new Set(sellerUserIds);
    return {
      ...configs,
      platformConfigs: configs.platformConfigs.filter((item) =>
        allowed.has(item.sellerUserId),
      ),
    };
  }
}

/**
 * 按资源 ID 汇总 AstroBox 后台数据。
 *
 * 这些接口都属于 `/admin/*`，需要 AstroBox 的 admin / moderator 角色，
 * 调用方应先用 `useManageResourceAccess` 判定权限。
 */
export async function loadResourceAdminInfo(
  resourceId: string,
  limit = DEFAULT_LIMIT,
): Promise<ResourceAdminInfoResult> {
  const [configs, entitlements, orders, reports] = await Promise.allSettled([
    AdminApi.orders.resourceConfigs({ resourceId, limit }),
    AdminApi.orders.entitlements({ resourceId, limit }),
    AdminApi.orders.publicOrders({ resourceId, limit }),
    AdminApi.reports.list({ resourceId, limit }),
  ]);

  const errors: Partial<Record<ResourceAdminInfoSection, string>> = {};
  if (configs.status === "rejected") errors.configs = toMessage(configs.reason);
  if (entitlements.status === "rejected") {
    errors.entitlements = toMessage(entitlements.reason);
  }
  if (orders.status === "rejected") errors.orders = toMessage(orders.reason);
  if (reports.status === "rejected") errors.reports = toMessage(reports.reason);

  const baseConfigs = configs.status === "fulfilled" ? configs.value : null;

  return {
    data: {
      configs: baseConfigs
        ? await scopeCommerceConfigsToResource(baseConfigs, resourceId, limit)
        : null,
      entitlements:
        entitlements.status === "fulfilled" ? entitlements.value.items : [],
      orders: orders.status === "fulfilled" ? orders.value.items : [],
      reports: reports.status === "fulfilled" ? reports.value.items : [],
    },
    errors,
  };
}

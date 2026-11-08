/**
 * 付费 SKU 与目录 `paid_type` 的一致性。
 *
 * 资源一旦在 AstroBox 侧配置了启用中的付费 SKU，就属于通过 AB 授权分发：
 * 用户必须购买后才能拿到解密密钥/解锁设备，实质上没有任何免费使用路径。
 * 目录里的 `paid_type` 若仍标为空或 `free`，商品页会把资源展示成免费，
 * 与平台「付费资源必须严格标注付费」的要求直接冲突。
 *
 * 判定口径（与运营确认）：
 * - 只有 `isPaid && enabled` 的 SKU 才算「在走付费分发」；停用的售卖不触发。
 * - `rejected_resource_owner` 的 SKU 服务端已永久忽略，不算。
 * - 目录侧 `paid` 与 `force_paid` 都视为已标注付费，只有空串/`free` 才是
 *   不一致——平台文档只要求「严格标注付费」，不强制区分是否可试用。
 *
 * 发布流程与 PR 审核共用本模块，避免「发布页提示通过、审核页却判不通过」。
 */
import {
  listSellerResourceConfigs,
  type SellerResourceSku,
} from "~/api/astrobox/order";

/** 与服务端一致：卖家配置被判定为卖家不是资源作者时，服务端永久忽略该配置。 */
const REJECTED_OWNER_STATUS = "rejected_resource_owner";

/** 目录付费类型是否已经标注为付费（`paid` / `force_paid`）。 */
export function isPaidDirectoryType(paidType: string | undefined): boolean {
  const normalized = (paidType ?? "").trim().toLowerCase();
  return normalized === "paid" || normalized === "force_paid";
}

/**
 * 判定所需的 SKU 最小字段。
 *
 * 发布侧取 SellerResourceSku（卖家接口），审核侧取管理员接口返回的同构数据，
 * 两边共用同一份判定即可。
 */
export type PaidTypeSku = Pick<
  SellerResourceSku,
  "isPaid" | "enabled" | "validationStatus"
> &
  Partial<
    Pick<
      SellerResourceSku,
      "deviceId" | "platform" | "externalProductId" | "externalSkuId"
    >
  >;

/** 启用中的付费 SKU：isPaid + enabled，且不是服务端已拒绝归属的脏配置。 */
export function findEnabledPaidSkus(
  skus: readonly PaidTypeSku[],
): PaidTypeSku[] {
  return skus.filter(
    (sku) =>
      sku.isPaid &&
      sku.enabled &&
      (sku.validationStatus ?? "").trim() !== REJECTED_OWNER_STATUS,
  );
}

export interface PaidTypeMismatch {
  /** 目录当前付费类型（空串按免费处理）。 */
  paidType: string;
  /** 付费 SKU 覆盖的设备，去重后保持首次出现的顺序。 */
  deviceIds: string[];
  /** 「deviceId → platform:productId/skuId」，用于审核提示定位具体配置。 */
  skuLabels: string[];
}

function skuLabel(sku: PaidTypeSku): string {
  const deviceId = (sku.deviceId ?? "").trim();
  const productId = (sku.externalProductId ?? "").trim();
  const skuId = (sku.externalSkuId ?? "").trim();
  const config =
    [sku.platform ?? "", productId].filter(Boolean).join(":") +
    (skuId ? `/${skuId}` : "");
  return deviceId ? `${deviceId} → ${config}` : config;
}

/**
 * 找出「目录标注免费、却存在启用中付费 SKU」的资源。
 *
 * 已标注付费或没有启用中的付费 SKU 时返回 null。
 */
export function findPaidTypeMismatch(input: {
  paidType: string | undefined;
  skus: readonly PaidTypeSku[];
}): PaidTypeMismatch | null {
  if (isPaidDirectoryType(input.paidType)) return null;
  const paidSkus = findEnabledPaidSkus(input.skus);
  if (paidSkus.length === 0) return null;

  const deviceIds: string[] = [];
  for (const sku of paidSkus) {
    const deviceId = (sku.deviceId ?? "").trim();
    if (deviceId && !deviceIds.includes(deviceId)) deviceIds.push(deviceId);
  }
  const skuLabels = paidSkus.map(skuLabel).filter(Boolean);
  return {
    paidType: (input.paidType ?? "").trim(),
    deviceIds,
    skuLabels,
  };
}

export type PaidTypeConsistencyCheck =
  | { status: "ok" }
  | ({
      status: "mismatch";
      resourceId: string;
    } & PaidTypeMismatch)
  | { status: "unknown"; resourceId: string; error: string };

/**
 * 发布前的付费类型检查。
 *
 * 已标注付费时结论必然通过，不再请求服务端；未填资源 ID（新建资源尚未登记）
 * 也无需检查。只有「标注免费 + 资源 ID 已存在」时才需要确认服务端是否已经
 * 配置了启用中的付费 SKU。
 *
 * `migratingFromId` 用于随资源类型一起换 ID 的场景：旧 ID 上的付费配置会在
 * 合入后迁移到新 ID，必须一并计入，否则会漏判。
 */
export async function checkPaidTypeConsistency(
  resourceId: string,
  paidType: string | undefined,
  options: { migratingFromId?: string | null } = {},
): Promise<PaidTypeConsistencyCheck> {
  const id = resourceId.trim();
  if (!id || isPaidDirectoryType(paidType)) return { status: "ok" };
  const fromId = options.migratingFromId?.trim() ?? "";

  try {
    const [current, inherited] = await Promise.all([
      listSellerResourceConfigs({ resourceId: id }),
      fromId && fromId !== id
        ? listSellerResourceConfigs({ resourceId: fromId })
        : null,
    ]);
    const mismatch = findPaidTypeMismatch({
      paidType,
      skus: [...current.skus, ...(inherited?.skus ?? [])],
    });
    return mismatch
      ? { status: "mismatch", resourceId: id, ...mismatch }
      : { status: "ok" };
  } catch (error) {
    return {
      status: "unknown",
      resourceId: id,
      error: (error as Error)?.message || String(error),
    };
  }
}

/**
 * 「更新仓库」前的付费配置检查。
 *
 * 加密只能保证包体不能被直接安装；用户能不能拿到解密密钥，服务端看的是
 * 同一个资源 ID 下该设备有没有付费 SKU（或自有网站授权）。只上传了密钥、
 * 没配 SKU 时，服务端会把它当成免费资源，任何用户无需购买即可拿到密钥下载。
 * 换过资源 ID、SKU 还留在旧 ID 上也是同样的结果，所以必须按本次提交的 ID 查。
 */
import {
  listExternalAuthorizations,
  listSellerResourceConfigs,
  type SellerResourceSku,
} from "~/api/astrobox/order";
import { listExternalAuthorizationDrafts } from "./external-authorization-drafts";

export type UnpaidEncryptionCheck =
  | { status: "ok" }
  /** 这些加密设备在该资源 ID 下没有任何付费配置 */
  | { status: "unprotected"; resourceId: string; deviceIds: string[] }
  /** 查询付费配置失败，无法确认；deviceIds 为全部加密设备 */
  | { status: "unknown"; resourceId: string; deviceIds: string[]; error: string };

/**
 * 找出启用了加密、但在 resourceId 下没有付费保护的设备。
 *
 * 与服务端判定保持一致：SKU 只看 isPaid，不看 enabled（停用的付费映射仍然拦截）；
 * 卖家不是资源作者的映射（rejected_resource_owner）服务端会忽略，不算保护。
 * 自有网站授权配置只要存在（含停用、含待发布时登记的草稿）即视为受保护。
 */
export function findUnprotectedEncryptedDevices(input: {
  resourceId: string;
  encryptedDeviceIds: string[];
  skus: Pick<SellerResourceSku, "resourceId" | "deviceId" | "isPaid" | "validationStatus">[];
  externalAuthorizations: Array<{ resourceId: string; deviceId: string }>;
}): string[] {
  const resourceId = input.resourceId.trim();
  const protectedDevices = new Set<string>();
  for (const sku of input.skus) {
    if (
      sku.resourceId === resourceId &&
      sku.isPaid &&
      sku.validationStatus !== "rejected_resource_owner"
    ) {
      protectedDevices.add(sku.deviceId);
    }
  }
  for (const config of input.externalAuthorizations) {
    if (config.resourceId === resourceId) protectedDevices.add(config.deviceId);
  }

  const encrypted = new Set(
    input.encryptedDeviceIds.map((deviceId) => deviceId.trim()).filter(Boolean),
  );
  return Array.from(encrypted).filter((deviceId) => !protectedDevices.has(deviceId));
}

export async function checkUnpaidEncryption(
  resourceId: string,
  encryptedDeviceIds: string[],
): Promise<UnpaidEncryptionCheck> {
  const id = resourceId.trim();
  if (!id || encryptedDeviceIds.length === 0) return { status: "ok" };

  try {
    const [resourceConfigs, externalConfigs] = await Promise.all([
      listSellerResourceConfigs({ resourceId: id }),
      // 自有网站授权是可选功能，列表拿不到时只按 SKU 判断
      listExternalAuthorizations({ resourceId: id })
        .then((result) => result.configs)
        .catch(() => []),
    ]);
    const deviceIds = findUnprotectedEncryptedDevices({
      resourceId: id,
      encryptedDeviceIds,
      skus: resourceConfigs.skus,
      externalAuthorizations: [...externalConfigs, ...listExternalAuthorizationDrafts(id)],
    });
    return deviceIds.length > 0
      ? { status: "unprotected", resourceId: id, deviceIds }
      : { status: "ok" };
  } catch (error) {
    return {
      status: "unknown",
      resourceId: id,
      deviceIds: findUnprotectedEncryptedDevices({
        resourceId: id,
        encryptedDeviceIds,
        skus: [],
        externalAuthorizations: [],
      }),
      error: (error as Error)?.message || String(error),
    };
  }
}

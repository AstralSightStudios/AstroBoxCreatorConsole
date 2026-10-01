/**
 * 付费门槛与解锁路径判定。
 *
 * 背景：服务端对「某个设备是否需要付费」与「用户能否拿到解密密钥」是两套独立判定，
 * 审核侧必须与它们保持逐字一致，否则会出现「检查放行但用户被锁死」或反之。
 *
 * 判定链（均以 AstroBoxServer origin/elysia 为准）：
 *
 * 1. isPaid —— public-logic.ts buildPurchaseDevices
 *      `allConfigs.some(item => item.isPaid) || Boolean(external)`
 *    ·只看 SKU 的 isPaid 字段，不看 enabled。
 *    · 外部授权配置只要存在即视为受保护，含已停用的（fail-closed）。
 *    · 两条来源是「或」关系，任意一条成立即构成付费门槛。
 *
 * 2. 自助购买可用 —— public-logic.ts buildPurchaseDevices 的 matchedConfigs
 *    SKU 同时满足 enabled、且 (platform:externalProductId) 已登记 ResourceProduct
 *    才会作为购买入口展示；buyUrl 为空则无处可跳转。
 *
 * 3. 外部授权可用 —— external-authorization/service.ts checkConfigUsable
 *    配置需 enabled、卖家为资源作者、且与该设备加密密钥的归属一致。
 *
 * 4. validationStatus —— public-logic.ts resolveSkuConfigValidationStatus
 *    `pending_resource_review` 是审核期的正常态（资源尚未合入官方仓库），
 *    不能据此判定配置无效；`rejected_resource_owner` 表示配置卖家不是资源作者，
 *    服务端已永久忽略，属于需要清理的脏数据。
 */

/** 服务端把配置标记为当前生效所需的状态。审核期资源未上架，统一按「合入后生效」处理。 */
export const PENDING_REVIEW_STATUS = "pending_resource_review";
export const REJECTED_OWNER_STATUS = "rejected_resource_owner";
export const PENDING_MANIFEST_DEVICE_STATUS = "pending_manifest_device";

/**
 * 该配置在资源合入官方仓库后是否生效。
 * 审核期所有配置都是 pending_resource_review，若按字面判「未生效」会让整套检查失效，
 * 因此这里把它当作生效，只排除服务端已明确拒绝的两类脏数据。
 */
export function isConfigEffectiveAfterMerge(validationStatus: string | undefined): boolean {
  const normalized = (validationStatus ?? "").trim();
  if (!normalized || normalized === "active" || normalized === PENDING_REVIEW_STATUS) {
    return true;
  }
  return normalized !== REJECTED_OWNER_STATUS && normalized !== PENDING_MANIFEST_DEVICE_STATUS;
}

export interface CommerceSku {
  deviceId: string;
  platform: string;
  externalProductId: string;
  externalSkuId: string;
  isPaid: boolean;
  enabled: boolean;
  buyUrl: string;
  validationStatus?: string;
}

export interface CommerceProduct {
  platform: string;
  externalProductId: string;
  validationStatus?: string;
}

export interface CommerceExternalAuthorization {
  deviceId: string;
  sellerUserId: string;
  enabled: boolean;
  validationStatus?: string;
}

export interface CommerceFileKey {
  deviceId: string;
  firstOwnerId: string;
}

export type DeviceGateVerdict = "free" | "unlocked" | "locked";

export interface DeviceGateReason {
  deviceId: string;
  verdict: DeviceGateVerdict;
  /** 构成付费门槛的来源，用于生成可操作的提示文案。 */
  paidBy: "sku" | "external" | "both" | "none";
  /** 自助购买入口缺失的具体环节，全部为空表示入口完整。 */
  missingPurchase: Array<"disabled" | "product" | "buyUrl">;
  /** 外部授权通道不可用的具体原因。 */
  externalIssue?:
    | "absent"
    | "disabled"
    | "ownerMismatch"
    | "fileKeyOwnerMismatch";
  /** 该设备是否已登记加密文件密钥。 */
  hasFileKey: boolean;
}

export interface StaleConfigReport {
  rejectedOwnerDevices: string[];
  pendingManifestDeviceSkus: string[];
}

function skuLabel(sku: CommerceSku): string {
  const skuId = sku.externalSkuId.trim();
  const productId = sku.externalProductId.trim();
  return `${sku.platform}:${productId}${skuId ? `/${skuId}` : ""}`;
}

/**
 * 逐设备复刻服务端的付费门槛与解锁路径判定。
 *
 * @param devices manifest.downloads 的正式下载设备标识
 * @param sellerUserId 资源作者在 AstroBox 的账户 id，用于校验配置归属
 */
export function evaluateDeviceGates(input: {
  devices: string[];
  skus: CommerceSku[];
  products: CommerceProduct[];
  externalAuthorizations: CommerceExternalAuthorization[];
  fileKeys: CommerceFileKey[];
  sellerUserId?: string;
}): { reasons: DeviceGateReason[]; stale: StaleConfigReport } {
  const { devices, skus, products, externalAuthorizations, fileKeys, sellerUserId } = input;

  const productKeys = new Set(
    products
      .filter((p) => isConfigEffectiveAfterMerge(p.validationStatus))
      .map((p) => `${p.platform}:${p.externalProductId}`),
  );
  const fileKeyOwnerByDevice = new Map(
    fileKeys.map((k) => [k.deviceId, (k.firstOwnerId ?? "").trim()] as const),
  );

  const stale: StaleConfigReport = { rejectedOwnerDevices: [], pendingManifestDeviceSkus: [] };
  const staleDevices = new Set<string>();
  for (const sku of skus) {
    if ((sku.validationStatus ?? "").trim() === REJECTED_OWNER_STATUS) {
      staleDevices.add(sku.deviceId);
    }
    if ((sku.validationStatus ?? "").trim() === PENDING_MANIFEST_DEVICE_STATUS) {
      stale.pendingManifestDeviceSkus.push(`${sku.deviceId} → ${skuLabel(sku)}`);
    }
  }
  for (const ext of externalAuthorizations) {
    if ((ext.validationStatus ?? "").trim() === REJECTED_OWNER_STATUS) {
      staleDevices.add(ext.deviceId);
    }
  }
  stale.rejectedOwnerDevices = Array.from(staleDevices).filter(Boolean);

  const reasons = devices.map((deviceId): DeviceGateReason => {
    const deviceSkus = skus.filter((s) => s.deviceId === deviceId);
    // 与服务端一致：只认 isPaid，不看 enabled；仅过滤服务端已拒绝的脏配置。
    const paidSkus = deviceSkus.filter(
      (s) => s.isPaid && isConfigEffectiveAfterMerge(s.validationStatus),
    );
    const deviceExts = externalAuthorizations.filter((e) => e.deviceId === deviceId);
    // 外部授权配置只要存在即受保护，含已停用。
    const protectedByExternal = deviceExts.length > 0;
    const hasFileKey = fileKeyOwnerByDevice.has(deviceId);

    if (paidSkus.length === 0 && !protectedByExternal) {
      return {
        deviceId,
        verdict: "free",
        paidBy: "none",
        missingPurchase: [],
        hasFileKey,
      };
    }

    const paidBy: DeviceGateReason["paidBy"] =
      paidSkus.length > 0 && protectedByExternal
        ? "both"
        : paidSkus.length > 0
          ? "sku"
          : "external";

    // 自助购买：需 SKU 启用、已登记对应商品、且有可跳转的购买链接。
    // 同一设备可能登记多条付费 SKU（如多个爱发电方案），任一条入口完整即可自助购买，
    // 因此可用性按「逐条求完整」判定，而缺失环节取并集仅用于生成提示文案。
    const missingPurchase = new Set<DeviceGateReason["missingPurchase"][number]>();
    let purchaseUsable = false;
    for (const sku of paidSkus) {
      const issues: DeviceGateReason["missingPurchase"] = [];
      if (!sku.enabled) issues.push("disabled");
      if (!productKeys.has(`${sku.platform}:${sku.externalProductId}`)) {
        issues.push("product");
      }
      if (!sku.buyUrl.trim()) issues.push("buyUrl");
      for (const issue of issues) missingPurchase.add(issue);
      if (issues.length === 0) purchaseUsable = true;
    }

    // 外部授权：与 SKU 相互独立的一条解锁路径，配置存在即受保护（含已停用）。
    let externalIssue: DeviceGateReason["externalIssue"];
    if (deviceExts.length === 0) {
      externalIssue = "absent";
    } else {
      const enabledExt = deviceExts.find((e) => e.enabled);
      if (!enabledExt) {
        externalIssue = "disabled";
      } else if (
        sellerUserId &&
        enabledExt.sellerUserId &&
        enabledExt.sellerUserId !== sellerUserId
      ) {
        externalIssue = "ownerMismatch";
      } else {
        const fileKeyOwner = fileKeyOwnerByDevice.get(deviceId) ?? "";
        // 未登记加密文件密钥时归属无从校验，按服务端 checkConfigUsable 的短路处理。
        externalIssue =
          fileKeyOwner && fileKeyOwner !== enabledExt.sellerUserId
            ? "fileKeyOwnerMismatch"
            : undefined;
      }
    }
    const externalUsable = externalIssue === undefined;

    return {
      deviceId,
      verdict: purchaseUsable || externalUsable ? "unlocked" : "locked",
      paidBy,
      missingPurchase: Array.from(missingPurchase),
      externalIssue,
      hasFileKey,
    };
  });

  return { reasons, stale };
}

const PURCHASE_MISSING_TEXT: Record<DeviceGateReason["missingPurchase"][number], string> = {
  disabled: "SKU 的「启用」开关关闭",
  product: "SKU 未登记对应商品，客户端不展示购买入口",
  buyUrl: "SKU 缺少购买链接",
};

const EXTERNAL_ISSUE_TEXT: Record<
  NonNullable<DeviceGateReason["externalIssue"]>,
  string
> = {
  absent: "未登记自有网站授权",
  disabled: "自有网站授权已停用",
  ownerMismatch: "自有网站授权的卖家不是资源作者，服务端已忽略",
  fileKeyOwnerMismatch: "自有网站授权与该设备加密密钥的归属不一致，服务端已忽略",
};

/** 为单个设备生成可操作的失败原因文案；未锁死时返回空串。 */
export function describeLockedDevice(reason: DeviceGateReason): string {
  if (reason.verdict !== "locked") return "";
  const parts: string[] = [];
  parts.push(
    reason.paidBy === "external"
      ? "已登记自有网站授权，设备受保护"
      : reason.paidBy === "both"
        ? "已配置付费 SKU 与自有网站授权，设备受保护"
        : "SKU 标记为付费，设备受保护",
  );
  if (reason.missingPurchase.length > 0) {
    parts.push(
      `自助购买不可用（${Array.from(new Set(reason.missingPurchase))
        .map((k) => PURCHASE_MISSING_TEXT[k])
        .join("、")}）`,
    );
  }
  if (reason.externalIssue) {
    parts.push(EXTERNAL_ISSUE_TEXT[reason.externalIssue]);
  }
  return parts.join("，");
}

/** 判定付费但未开启「付费」开关的 SKU：收了钱却拦不住任何人。 */
export function findUnpaidSkuDevices(input: {
  devices: string[];
  skus: CommerceSku[];
}): string[] {
  const { devices, skus } = input;
  return devices.filter((deviceId) => {
    const deviceSkus = skus.filter(
      (s) =>
        s.deviceId === deviceId &&
        s.enabled &&
        isConfigEffectiveAfterMerge(s.validationStatus),
    );
    return deviceSkus.length > 0 && !deviceSkus.some((s) => s.isPaid);
  });
}
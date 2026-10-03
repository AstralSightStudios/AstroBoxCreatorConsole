/**
 * 付费门槛与解锁路径判定。
 *
 * 背景：服务端对「某个设备是否需要付费」与「用户能否拿到解密密钥」是两套独立判定，
 * 审核侧必须与它们保持逐字一致，否则会出现「检查放行但用户被锁死」或反之。
 *
 * 判定链（均以 AstroBoxServer 的 origin/elysia 为准；本地若停在 feat/cc-notice-kind
 * 会看不到外部网站授权，付费判定不完整，不要拿本地工作树当基准）：
 *
 * 1. isPaid —— community/resource/service.ts QueryCryptoInfo
 *      `const isPaid = skuPaid || Boolean(externalConfig)`
 *    · skuPaid 来自 isPaidDevice，只看 SKU 的 isPaid 字段，不看 enabled。
 *    · 外部授权配置只要存在即视为受保护，含已停用的
 *      （external-authorization/service.ts findProtection 不按 enabled 过滤），
 *      属于刻意的 fail-closed：关掉授权不该把资源放成免费。
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
 *    `pending_*` 是审核期的正常态（详见 isConfigEffectiveAfterMerge），
 *    不能据此判定配置无效；`rejected_resource_owner` 表示配置卖家不是资源作者，
 *    服务端已永久忽略，属于需要清理的脏数据。
 *
 * 注意服务端所有付费判定都只统计 active 配置（过滤条件
 * `activeResourceConfigValidationFilter = { $in: [null, "active"] }`，
 * 见 public-service.ts 的 getResourcePurchaseInfo / isPaidDevice / 爱发电 webhook）。
 * 本模块不复刻「当前状态」，而是复刻「合入官方仓库之后的状态」——
 * 审核期读到的 validationStatus 只是创作者保存那一刻的快照。
 */

/** 服务端把配置标记为当前生效所需的状态。审核期资源未上架，统一按「合入后生效」处理。 */
export const PENDING_REVIEW_STATUS = "pending_resource_review";
export const REJECTED_OWNER_STATUS = "rejected_resource_owner";
export const PENDING_MANIFEST_DEVICE_STATUS = "pending_manifest_device";

/**
 * 该配置在资源合入官方仓库后是否生效。
 *
 * 本函数是「合入后模拟器」，不是服务端当前状态的镜像：服务端的
 * validationStatus 是存量字段，只在 reconcile（public-service.ts
 * reconcileSellerResourceSkuConfigs）时重算，而 reconcile 由按需路径驱动——
 * 创作者保存 SKU、卖家打开配置页、用户请求 purchase_info、用户请求解密密钥
 * （community/resource/service.ts QueryCryptoInfo，客户端安装加密包的必经路径）、
 * 爱发电回调。审核期读到的只是快照，10 分钟的定时全量同步和管理端查询都是纯读，
 * 不会刷新它。
 *
 * 因此两类 pending 都必须按「合入后生效」处理：
 *
 *   · pending_resource_review：资源尚未进入官方索引，合入后所有权成立即转 active。
 *   · pending_manifest_device：服务端判设备存在性时读的是**已合入**的官方索引
 *     （sync.ts 的 fetchResourceIndexEntry 拉 main 分支 index_v2.csv）。
 *     edit 型 PR 恰恰是「创作者先为新设备配 SKU，本 PR 再把设备写进 manifest」，
 *     审核期必然被判为设备不存在。合入后索引含该设备，reconcile 必然转 active。
 *     服务端自己的测试用例即 keeps sku config pending until device appears in
 *     manifest（test/public-logic.test.ts），可见这是过渡态而非永久失效。
 *
 * 把 pending_manifest_device 当成永久失效会让审核端把「付费设备」判成「仅加密、
 * 不售卖」，从而漏判真正的锁死配置（SKU 缺购买链接 / 未登记商品时合并后用户付费
 * 却买不到），这是本函数此前排除它的直接后果。
 *
 * 放宽是安全的：devices 取自待合入 manifest 的 downloads，不在其中（既不在
 * downloads 也不在 trialDownloads）的设备其 SKU 不会参与任何 verdict，
 * 因此不会出现「按设备收钱却无对应设备」的死锁。
 */
export function isConfigEffectiveAfterMerge(validationStatus: string | undefined): boolean {
  const normalized = (validationStatus ?? "").trim();
  // 缺字段视为生效：Mongo 的 { $in: [null, "active"] } 会匹配缺失字段，
  // schema 默认值同样是 "active"，历史无该字段的 SKU 服务端按生效处理。
  if (!normalized || normalized === "active" || normalized === PENDING_REVIEW_STATUS) {
    return true;
  }
  return normalized !== REJECTED_OWNER_STATUS;
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

export interface PendingManifestSku {
  deviceId: string;
  /** 「deviceId → platform:productId/skuId」，用于审核提示定位到具体配置。 */
  label: string;
  /**
   * 该设备是否已写入**待合入**的 manifest。
   * true —— 服务端只是还没看到本 PR 的索引行，合入后必然生效，无需处理；
   * false —— manifest 确实没有这台设备，SKU 指向的是不存在的设备，合入后也不会生效。
   */
  declaredInManifest: boolean;
}

export interface StaleConfigReport {
  rejectedOwnerDevices: string[];
  pendingManifestDeviceSkus: PendingManifestSku[];
}

function skuLabel(sku: CommerceSku): string {
  const skuId = sku.externalSkuId.trim();
  const productId = sku.externalProductId.trim();
  return `${sku.platform}:${productId}${skuId ? `/${skuId}` : ""}`;
}

/**
 * 把 pending_manifest_device 分成两档。
 *
 * `declared` —— 设备已写入待合入 manifest，只是服务端还没看到本 PR 的索引行，
 * 合入后必然生效，不需要审核人做任何事，不该报警告。
 * `missing` —— manifest 确实没有这台设备，SKU 指向的是不存在的设备，
 * 合入后依然不会生效（收不到钱也锁不住人），属于创作者配置与包体不一致。
 */
export function partitionPendingManifestSkus(stale: StaleConfigReport): {
  declared: PendingManifestSku[];
  missing: PendingManifestSku[];
} {
  const declared: PendingManifestSku[] = [];
  const missing: PendingManifestSku[] = [];
  for (const item of stale.pendingManifestDeviceSkus) {
    (item.declaredInManifest ? declared : missing).push(item);
  }
  return { declared, missing };
}

/**
 * 逐设备复刻服务端的付费门槛与解锁路径判定。
 *
 * @param devices manifest.downloads 的正式下载设备标识
 * @param sellerUserId 资源作者在 AstroBox 的账户 id，用于校验配置归属
 * @param manifestDeviceIds 待合入 manifest（downloads + trialDownloads）声明的
 *   **规范化**设备 id 集合。只用于给 pending_manifest_device 分级，不参与门槛判定：
 *   devices 之外的设备本就不会产生 verdict，分级只影响提示级别与文案。
 */
export function evaluateDeviceGates(input: {
  devices: string[];
  skus: CommerceSku[];
  products: CommerceProduct[];
  externalAuthorizations: CommerceExternalAuthorization[];
  fileKeys: CommerceFileKey[];
  sellerUserId?: string;
  manifestDeviceIds?: Iterable<string>;
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
  const declaredDeviceIds = new Set(
    Array.from(input.manifestDeviceIds ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );

  const stale: StaleConfigReport = { rejectedOwnerDevices: [], pendingManifestDeviceSkus: [] };
  const staleDevices = new Set<string>();
  for (const sku of skus) {
    if ((sku.validationStatus ?? "").trim() === REJECTED_OWNER_STATUS) {
      staleDevices.add(sku.deviceId);
    }
    if ((sku.validationStatus ?? "").trim() === PENDING_MANIFEST_DEVICE_STATUS) {
      stale.pendingManifestDeviceSkus.push({
        deviceId: sku.deviceId,
        label: `${sku.deviceId} → ${skuLabel(sku)}`,
        declaredInManifest: declaredDeviceIds.has(sku.deviceId.trim().toLowerCase()),
      });
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
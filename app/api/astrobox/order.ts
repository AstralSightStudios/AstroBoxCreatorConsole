import { sendApiRequest } from "./request";
import type { AfdianOrder } from "~/api/afdian";

export type CommercePlatform = "afd" | "cdk";

export interface SellerPlatformConfig {
    platform: CommercePlatform;
    enabled: boolean;
    buyGuideUrl: string;
    webhookPath?: string;
    webhookUrl?: string;
}

export interface UpsertSellerPlatformConfigBody {
    platform: CommercePlatform;
    enabled: boolean;
    buyGuideUrl?: string;
}

export interface SellerResourceProduct {
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    title: string;
    buyUrl: string;
    enabled: boolean;
}

export interface SellerResourceSku {
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    externalSkuId: string;
    deviceId: string;
    title: string;
    buyUrl: string;
    isPaid: boolean;
    enabled: boolean;
    sortOrder?: number;
    validationStatus?: string;
}

export interface SellerResourceConfigListResponse {
    products: SellerResourceProduct[];
    skus: SellerResourceSku[];
}

export interface UpsertResourceProductBody {
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    title?: string;
    buyUrl?: string;
    enabled?: boolean;
}

export interface UpsertResourceSkuBody {
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    externalSkuId: string;
    deviceId: string;
    title?: string;
    buyUrl?: string;
    isPaid?: boolean;
    enabled?: boolean;
    sortOrder?: number;
}

export interface SellerOverviewCounts {
    platformConfigs: { total: number; enabled: number };
    products: { total: number; enabled: number };
    skus: { total: number; enabled: number; paid: number; free: number };
    fileKeys: { total: number };
    publicOrders: { total: number; pending_binding?: number; granted?: number; rejected_seller_inactive?: number; ignored_unmapped_sku?: number };
    entitlements: { total: number; bySource: Record<string, number> };
    cdk: { total: number; available?: number; redeemed?: number };
}

export interface SellerOverviewResponse {
    sellerUserId: string;
    resourceId: string;
    counts: SellerOverviewCounts;
    recentIssueOrders: any[];
    recentPendingBindingOrders: any[];
}

export interface SellerOverviewBody {
    resourceId?: string;
    recentLimit?: number;
}

export interface SellerResourceFileKey {
    resourceId: string;
    deviceId: string;
    encryptedFileHash: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateCdkBatchBody {
    resourceId: string;
    deviceId: string;
    quantity: number;
}

export interface CreateCdkBatchResponse {
    resourceId: string;
    deviceId: string;
    batchId: string;
    codes: string[];
}

export type CdkStatus = "available" | "redeemed";

export interface CdkListItem {
    code: string;
    resourceId: string;
    deviceId: string;
    status: CdkStatus;
    batchId: string;
    redeemedByUserId: string;
    createdAt: string;
    updatedAt: string;
}

export interface ListSellerCdkBody {
    resourceId?: string;
    deviceId?: string;
    status?: CdkStatus;
    limit?: number;
}

export function upsertSellerPlatformConfig(body: UpsertSellerPlatformConfigBody) {
    return sendApiRequest<SellerPlatformConfig>(
        "/order/seller/platform-config/upsert",
        "POST",
        undefined,
        body,
    );
}

export function listSellerPlatformConfigs() {
    return sendApiRequest<SellerPlatformConfig[]>(
        "/order/seller/platform-config/list",
        "POST",
    );
}

export function deleteSellerPlatformConfig(body: { platform: CommercePlatform }) {
    return sendApiRequest<{ deleted: boolean }>(
        "/order/seller/platform-config/delete",
        "POST",
        undefined,
        body,
    );
}

export function listSellerResourceConfigs(
    body: { resourceId?: string } = {},
    token?: string,
) {
    return sendApiRequest<SellerResourceConfigListResponse>(
        "/order/seller/resource-config/list",
        "POST",
        token,
        body,
    );
}

export function getSellerOverview(body: SellerOverviewBody = {}) {
    return sendApiRequest<SellerOverviewResponse>(
        "/order/seller/overview",
        "POST",
        undefined,
        body,
    );
}

export function listSellerResourceFileKeys(
    body: { resourceId: string; deviceId?: string; limit?: number },
    token?: string,
) {
    return sendApiRequest<SellerResourceFileKey[]>(
        "/order/seller/resource-file-key/list",
        "POST",
        token,
        body,
    );
}

export function deleteSellerResourceFileKey(body: { resourceId: string; deviceId?: string; encryptedFileHash: string }) {
    return sendApiRequest<{ deleted: boolean }>(
        "/order/seller/resource-file-key/delete",
        "POST",
        undefined,
        body,
    );
}

export function upsertResourceProduct(body: UpsertResourceProductBody) {
    return sendApiRequest<SellerResourceProduct>(
        "/order/seller/resource-product/upsert",
        "POST",
        undefined,
        body,
    );
}

export function deleteResourceProduct(body: { resourceId: string; platform: CommercePlatform; externalProductId: string }) {
    return sendApiRequest<{ deleted: boolean }>(
        "/order/seller/resource-product/delete",
        "POST",
        undefined,
        body,
    );
}

export function upsertResourceSku(body: UpsertResourceSkuBody) {
    return sendApiRequest<SellerResourceSku>(
        "/order/seller/resource-sku/upsert",
        "POST",
        undefined,
        body,
    );
}

export function deleteResourceSku(body: { resourceId: string; platform: CommercePlatform; externalProductId: string; externalSkuId: string; deviceId: string }) {
    return sendApiRequest<{ deleted: boolean }>(
        "/order/seller/resource-sku/delete",
        "POST",
        undefined,
        body,
    );
}

export function createCdkBatch(body: CreateCdkBatchBody) {
    return sendApiRequest<CreateCdkBatchResponse>(
        "/order/seller/cdk/create-batch",
        "POST",
        undefined,
        body,
    );
}

export function listSellerCdks(body: ListSellerCdkBody = {}) {
    return sendApiRequest<CdkListItem[]>(
        "/order/seller/cdk/list",
        "POST",
        undefined,
        body,
    );
}

export type EntitlementSourceType = "order" | "cdk";
export type SellerEntitlementStatus = "active" | "revoked";

/** 一条买家权益记录（同一买家同一设备可能有订单、CDK 多条来源）。 */
export interface SellerEntitlement {
    buyerUserId: string;
    /** 买家显示名，没有则退回用户名；账号已删除时为空。 */
    buyerName: string;
    buyerAvatar: string;
    sellerUserId: string;
    resourceId: string;
    deviceId: string;
    sourceType: EntitlementSourceType;
    sourcePlatform: CommercePlatform;
    sourceRef: string;
    /** 未吊销为空串。 */
    revokedAt: string;
    revokeReason: string;
    createdAt: string;
    updatedAt: string;
}

export interface ListSellerEntitlementsBody {
    resourceId?: string;
    deviceId?: string;
    buyerUserId?: string;
    status?: SellerEntitlementStatus;
    limit?: number;
}

export interface EntitlementTarget {
    resourceId: string;
    deviceId: string;
    buyerUserId: string;
}

export interface RevokeEntitlementBody extends EntitlementTarget {
    reason?: string;
}

export interface EntitlementChangeResult extends EntitlementTarget {
    /** 本次实际改动的记录数；已是目标状态时为 0。 */
    affected: number;
}

export function listSellerEntitlements(body: ListSellerEntitlementsBody = {}) {
    return sendApiRequest<SellerEntitlement[]>(
        "/order/seller/entitlement/list",
        "POST",
        undefined,
        body,
    );
}

/** 吊销买家对某资源某设备的安装权限（软删除，可恢复）。 */
export function revokeSellerEntitlement(body: RevokeEntitlementBody) {
    return sendApiRequest<EntitlementChangeResult>(
        "/order/seller/entitlement/revoke",
        "POST",
        undefined,
        body,
    );
}

export function restoreSellerEntitlement(body: EntitlementTarget) {
    return sendApiRequest<EntitlementChangeResult>(
        "/order/seller/entitlement/restore",
        "POST",
        undefined,
        body,
    );
}

export interface AfdianReissueCandidate {
  key: string;
  externalOrderId: string;
  externalProductId: string;
  externalSkuId: string;
  buyerPlatformUserId: string;
  buyerUserId: string;
  resourceId: string;
  deviceId: string;
  purchaseTime: string;
  amount: string;
  canReissue: boolean;
  reason: string;
}

export interface AfdianReconcileResponse {
  candidates: AfdianReissueCandidate[];
  skippedOrders: number;
  matchedItems: number;
}

export interface AfdianReissueItem {
  order: AfdianOrder;
  externalSkuId: string;
  resourceId: string;
  deviceId: string;
}

export interface AfdianReissueResult {
  key: string;
  externalOrderId: string;
  externalSkuId: string;
  resourceId: string;
  deviceId: string;
  ok: boolean;
  status: string;
  reason: string;
  buyerUserId: string;
}

export interface AfdianReissueResponse {
  results: AfdianReissueResult[];
  succeeded: number;
  skipped: number;
  failed: number;
}

export function reconcileAfdianOrders(body: { orders: AfdianOrder[] }) {
  return sendApiRequest<AfdianReconcileResponse>(
    "/order/seller/afdian/reconcile",
    "POST",
    undefined,
    body,
  );
}

export function reissueAfdianOrders(body: { items: AfdianReissueItem[] }) {
  return sendApiRequest<AfdianReissueResponse>(
    "/order/seller/afdian/reissue",
    "POST",
    undefined,
    body,
  );
}

// ---- 爱发电自动补单（服务端托管凭据，每 15 分钟补一次） ----

export interface AfdianAutoReissueStats {
  fetched: number;
  matched: number;
  checked: number;
  granted: number;
  waitingBinding: number;
  failed: number;
  truncated: boolean;
}

/** 服务端不会返回 token，连掩码都没有。 */
export interface AfdianAutoReissueStatus {
  configured: boolean;
  enabled: boolean;
  afdianUserId: string;
  intervalMinutes: number;
  /** ok / network / rejected / seller_inactive / error / disabled；还没跑过为空。 */
  lastStatus: string;
  lastError: string;
  lastRunAt: string;
  lastSuccessAt: string;
  nextRunAt: string;
  lastStats: AfdianAutoReissueStats;
}

export function getAfdianAutoReissueStatus() {
  return sendApiRequest<AfdianAutoReissueStatus>(
    "/order/seller/afdian/auto-reissue/status",
    "POST",
  );
}

export function saveAfdianAutoReissue(body: { afdianUserId: string; token: string }) {
  return sendApiRequest<AfdianAutoReissueStatus>(
    "/order/seller/afdian/auto-reissue/save",
    "POST",
    undefined,
    body,
  );
}

export function removeAfdianAutoReissue() {
  return sendApiRequest<{ ok: boolean }>(
    "/order/seller/afdian/auto-reissue/remove",
    "POST",
  );
}

// ---- 创作者自有网站授权 ----

export interface DecryptPeriodLimits {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
}

export interface DecryptLimits {
    perIp: DecryptPeriodLimits;
    distinctIps: DecryptPeriodLimits;
}

export interface ExternalAuthorizationConfig {
    id: string;
    resourceId: string;
    deviceId: string;
    enabled: boolean;
    displayName: string;
    authorizationUrl: string;
    buyUrl: string;
    issuer: string;
    kid: string;
    publicKey: string;
    revision: number;
    decryptLimits: DecryptLimits;
    createdAt: string;
    updatedAt: string;
}

export interface ExternalAuthorizationPlatformInfo {
    protocol: string;
    issuer: string;
    alg: string;
    kid: string;
    publicKey: string;
    challengeTyp: string;
    grantTyp: string;
}

export interface UpsertExternalAuthorizationBody {
    resourceId: string;
    deviceId: string;
    enabled?: boolean;
    displayName?: string;
    authorizationUrl: string;
    buyUrl?: string;
    issuer: string;
    publicKey: string;
    decryptLimits?: DecryptLimits;
    // 资源未上架时的所有权证明
    repoOwner?: string;
    repoName?: string;
    commitSha?: string;
}

// 服务端对未上架资源缺少 repo 证明时返回的原因，用于识别「需要发布时再登记」
export const EXTERNAL_AUTHORIZATION_PROOF_REQUIRED =
    "repo ownership proof required for unlisted resource";

export function listExternalAuthorizations(body: { resourceId?: string } = {}) {
    return sendApiRequest<{
        platform: ExternalAuthorizationPlatformInfo;
        configs: ExternalAuthorizationConfig[];
    }>("/order/seller/external-authorization/list", "POST", undefined, body);
}

export function upsertExternalAuthorization(body: UpsertExternalAuthorizationBody) {
    return sendApiRequest<ExternalAuthorizationConfig>(
        "/order/seller/external-authorization/upsert",
        "POST",
        undefined,
        body,
    );
}

export function disableExternalAuthorization(body: { resourceId: string; deviceId: string }) {
    return sendApiRequest<ExternalAuthorizationConfig>(
        "/order/seller/external-authorization/disable",
        "POST",
        undefined,
        body,
    );
}

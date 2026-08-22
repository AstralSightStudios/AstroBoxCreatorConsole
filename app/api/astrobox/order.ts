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

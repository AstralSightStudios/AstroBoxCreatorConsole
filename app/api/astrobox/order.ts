import { sendApiRequest } from "./request";

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
}

export interface SellerResourceConfigListResponse {
    products: SellerResourceProduct[];
    skus: SellerResourceSku[];
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

export function listSellerResourceConfigs(body: { resourceId?: string } = {}) {
    return sendApiRequest<SellerResourceConfigListResponse>(
        "/order/seller/resource-config/list",
        "POST",
        undefined,
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

export function listSellerResourceFileKeys(body: { resourceId: string; deviceId?: string; limit?: number }) {
    return sendApiRequest<SellerResourceFileKey[]>(
        "/order/seller/resource-file-key/list",
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

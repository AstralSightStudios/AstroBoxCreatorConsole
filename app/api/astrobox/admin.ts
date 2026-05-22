import { sendApiRequest } from "./request";
import type { CommentView } from "./community";

export interface AdminCommentView extends CommentView {
  senderIpRaw?: string | null;
  senderIpLocation?: string | null;
  children: AdminCommentView[];
}

export type AdminRole = "admin" | "moderator" | "pr-reviewer" | string;
export type BanKind = "platform" | "social";
export type VipTier = "None" | "Pro" | "CreatorPlus" | "CreatorPro";
export type ReportStatus = "pending" | "resolved" | "dismissed";
export type ReportType = "comment" | "resource";
export type CommercePlatform = "afd" | "cdk";
export type PublicOrderStatus =
  | "pending_binding"
  | "granted"
  | "rejected_seller_inactive"
  | "ignored_unmapped_sku";
export type EntitlementSourceType = "order" | "cdk";
export type CdkStatus = "available" | "redeemed";

export interface ActiveBan {
  id: string;
  userId: string;
  kind: BanKind;
  reason: string;
  bannedBy: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokedReason?: string | null;
}

export interface AdminUserSummary {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  vip: VipTier;
  vipExpireMap: Record<string, string>;
  roles: AdminRole[];
  createdAt: string;
  activeBans: ActiveBan[];
  github?: string | null;
  additionalProperties?: Record<string, unknown>;
}

export interface AdminUserDetail extends AdminUserSummary {
  banHistory: ActiveBan[];
}

export interface ListResponse<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface VipOrder {
  id: string;
  orderId: string;
  ifdianUserId: string;
  userId?: string;
  vipType: VipTier;
  month: number;
  status: string;
  createdAt: string;
  activatedAt?: string;
  expiredAt?: string;
}

export interface ReportItem {
  id: string;
  senderId: string;
  reportType: ReportType;
  commentId: string | null;
  commentParentId: string | null;
  resourceId: string | null;
  reasonCategory: string;
  reason: string;
  evidence: string[];
  status: ReportStatus;
  handledBy: string | null;
  handledAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxMessage {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  metadata: unknown;
  senderType: "system" | "admin";
  senderId: string | null;
  bulkId?: string | null;
  createdAt: string;
  readAt: string | null;
  deletedByAdminAt?: string | null;
  deletedByUserAt?: string | null;
}

export interface AdminPublicOrder {
  id: string;
  sellerUserId: string;
  platform: CommercePlatform;
  externalOrderId: string;
  externalProductId: string;
  externalSkuId: string;
  buyerPlatformUserId: string;
  buyerUserId: string;
  resourceId: string;
  deviceId: string;
  status: PublicOrderStatus;
  rawPayload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AdminResourceEntitlement {
  id: string;
  buyerUserId: string;
  sellerUserId: string;
  resourceId: string;
  deviceId: string;
  sourceType: EntitlementSourceType;
  sourcePlatform: CommercePlatform;
  sourceRef: string;
  meta: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AdminResourceCommerceConfigs {
  platformConfigs: Array<{
    id: string;
    sellerUserId: string;
    platform: CommercePlatform;
    buyGuideUrl: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  products: Array<{
    id: string;
    sellerUserId: string;
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    title: string;
    buyUrl: string;
    enabled: boolean;
    validationStatus: string;
    createdAt: string;
    updatedAt: string;
  }>;
  skus: Array<{
    id: string;
    sellerUserId: string;
    resourceId: string;
    platform: CommercePlatform;
    externalProductId: string;
    externalSkuId: string;
    deviceId: string;
    title: string;
    buyUrl: string;
    isPaid: boolean;
    enabled: boolean;
    validationStatus: string;
    createdAt: string;
    updatedAt: string;
  }>;
  cdkCodes: Array<{
    id: string;
    sellerUserId: string;
    resourceId: string;
    deviceId: string;
    code: string;
    status: CdkStatus;
    batchId: string;
    redeemedByUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  fileKeys: Array<{
    id: string;
    resourceId: string;
    deviceId: string;
    encryptedFileHash: string;
    firstOwnerId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

function buildQuery(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const AdminApi = {
  users: {
    list: (query: {
      search?: string;
      role?: string;
      vip?: string;
      banStatus?: "any" | "none" | "platform" | "social";
      limit?: number;
      cursor?: string;
    }) =>
      sendApiRequest<ListResponse<AdminUserSummary>>(
        `/admin/users${buildQuery(query)}`,
        "GET",
      ),
    detail: (userId: string) =>
      sendApiRequest<AdminUserDetail>(
        `/admin/users/${encodeURIComponent(userId)}`,
        "GET",
      ),
    createBan: (
      userId: string,
      body: {
        kind: BanKind;
        reason: string;
        durationMinutes?: number;
        expiresAt?: string;
        notifyUser?: boolean;
      },
    ) =>
      sendApiRequest<ActiveBan>(
        `/admin/users/${encodeURIComponent(userId)}/bans`,
        "POST",
        undefined,
        body,
      ),
    revokeBan: (
      userId: string,
      banId: string,
      body: { reason?: string; notifyUser?: boolean },
    ) =>
      sendApiRequest<ActiveBan>(
        `/admin/users/${encodeURIComponent(userId)}/bans/${encodeURIComponent(banId)}`,
        "DELETE",
        undefined,
        body,
      ),
    adjustVip: (
      userId: string,
      body: {
        op: "set-expire" | "grant-months" | "revoke-tier" | "set-current-tier";
        tier: VipTier;
        expiresAt?: string;
        months?: number;
        reason?: string;
        notifyUser?: boolean;
      },
    ) =>
      sendApiRequest<AdminUserDetail>(
        `/admin/users/${encodeURIComponent(userId)}/vip`,
        "POST",
        undefined,
        body,
      ),
    orders: (userId: string) =>
      sendApiRequest<VipOrder[]>(
        `/admin/users/${encodeURIComponent(userId)}/vip/orders`,
        "GET",
      ),
    roles: (
      userId: string,
      body: { add?: string[]; remove?: string[] },
    ) =>
      sendApiRequest<{ roles: string[] }>(
        `/admin/users/${encodeURIComponent(userId)}/roles`,
        "POST",
        undefined,
        body,
      ),
  },
  reports: {
    list: (query: {
      status?: ReportStatus;
      reportType?: ReportType;
      senderId?: string;
      commentId?: string;
      resourceId?: string;
      limit?: number;
      cursor?: string;
    }) =>
      sendApiRequest<ListResponse<ReportItem>>(
        `/admin/reports${buildQuery(query)}`,
        "GET",
      ),
    detail: (id: string) =>
      sendApiRequest<ReportItem>(
        `/admin/reports/${encodeURIComponent(id)}`,
        "GET",
      ),
    resolve: (
      id: string,
      body: {
        status: "resolved" | "dismissed";
        resolution: string;
        notifyReporter?: boolean;
        autoBan?: {
          targetUserId: string;
          kind: BanKind;
          reason: string;
          durationMinutes?: number;
        };
      },
    ) =>
      sendApiRequest<{ report: ReportItem; autoBan: ActiveBan | null }>(
        `/admin/reports/${encodeURIComponent(id)}/resolve`,
        "POST",
        undefined,
        body,
      ),
  },
  comments: {
    detail: (commentId: string) =>
      sendApiRequest<AdminCommentView>(
        `/admin/comments/${encodeURIComponent(commentId)}`,
        "GET",
      ),
  },
  orders: {
    publicOrders: (query: {
      search?: string;
      sellerUserId?: string;
      buyerUserId?: string;
      buyerPlatformUserId?: string;
      resourceId?: string;
      deviceId?: string;
      platform?: CommercePlatform;
      status?: PublicOrderStatus;
      limit?: number;
      cursor?: string;
    }) =>
      sendApiRequest<ListResponse<AdminPublicOrder>>(
        `/admin/orders/public-orders${buildQuery(query)}`,
        "GET",
      ),
    upsertPublicOrder: (body: {
      sellerUserId: string;
      platform: CommercePlatform;
      externalOrderId: string;
      externalProductId: string;
      externalSkuId: string;
      buyerPlatformUserId: string;
      buyerUserId?: string;
      resourceId: string;
      deviceId: string;
      status: PublicOrderStatus;
      rawPayload?: unknown;
    }) =>
      sendApiRequest<AdminPublicOrder>(
        "/admin/orders/public-orders",
        "POST",
        undefined,
        body,
      ),
    patchPublicOrder: (
      id: string,
      body: Partial<Pick<AdminPublicOrder,
        | "sellerUserId"
        | "platform"
        | "externalOrderId"
        | "externalProductId"
        | "externalSkuId"
        | "buyerPlatformUserId"
        | "buyerUserId"
        | "resourceId"
        | "deviceId"
        | "status"
        | "rawPayload"
      >>,
    ) =>
      sendApiRequest<AdminPublicOrder>(
        `/admin/orders/public-orders/${encodeURIComponent(id)}`,
        "PATCH",
        undefined,
        body,
      ),
    deletePublicOrder: (id: string) =>
      sendApiRequest<{ deleted: true }>(
        `/admin/orders/public-orders/${encodeURIComponent(id)}`,
        "DELETE",
      ),
    entitlements: (query: {
      search?: string;
      sellerUserId?: string;
      buyerUserId?: string;
      resourceId?: string;
      deviceId?: string;
      sourceType?: EntitlementSourceType;
      sourcePlatform?: CommercePlatform;
      limit?: number;
      cursor?: string;
    }) =>
      sendApiRequest<ListResponse<AdminResourceEntitlement>>(
        `/admin/orders/entitlements${buildQuery(query)}`,
        "GET",
      ),
    upsertEntitlement: (body: {
      buyerUserId: string;
      sellerUserId: string;
      resourceId: string;
      deviceId: string;
      sourceType: EntitlementSourceType;
      sourcePlatform: CommercePlatform;
      sourceRef: string;
      meta?: unknown;
    }) =>
      sendApiRequest<AdminResourceEntitlement>(
        "/admin/orders/entitlements",
        "POST",
        undefined,
        body,
      ),
    patchEntitlement: (
      id: string,
      body: Partial<Pick<AdminResourceEntitlement,
        | "buyerUserId"
        | "sellerUserId"
        | "resourceId"
        | "deviceId"
        | "sourceType"
        | "sourcePlatform"
        | "sourceRef"
        | "meta"
      >>,
    ) =>
      sendApiRequest<AdminResourceEntitlement>(
        `/admin/orders/entitlements/${encodeURIComponent(id)}`,
        "PATCH",
        undefined,
        body,
      ),
    deleteEntitlement: (id: string) =>
      sendApiRequest<{ deleted: true }>(
        `/admin/orders/entitlements/${encodeURIComponent(id)}`,
        "DELETE",
      ),
    resourceConfigs: (query: {
      sellerUserId?: string;
      resourceId?: string;
      deviceId?: string;
      platform?: CommercePlatform;
      cdkStatus?: CdkStatus;
      limit?: number;
    }) =>
      sendApiRequest<AdminResourceCommerceConfigs>(
        `/admin/orders/resource-configs${buildQuery(query)}`,
        "GET",
      ),
  },
  inbox: {
    send: (body: {
      target:
        | { type: "userIds"; userIds: string[] }
        | { type: "role"; role: string }
        | { type: "all" };
      title: string;
      body: string;
      kind?: string;
      metadata?: unknown;
    }) =>
      sendApiRequest<{ bulkId: string; count: number }>(
        "/admin/inbox",
        "POST",
        undefined,
        body,
      ),
    list: (query: {
      userId?: string;
      senderId?: string;
      kind?: string;
      bulkId?: string;
      includeDeleted?: boolean;
      limit?: number;
      cursor?: string;
    }) =>
      sendApiRequest<ListResponse<InboxMessage>>(
        `/admin/inbox${buildQuery(query)}`,
        "GET",
      ),
    delete: (id: string) =>
      sendApiRequest<{ ok: true }>(
        `/admin/inbox/${encodeURIComponent(id)}`,
        "DELETE",
      ),
    bulkDelete: (bulkId: string) =>
      sendApiRequest<{ deleted: number }>(
        "/admin/inbox/bulk-delete",
        "POST",
        undefined,
        { bulkId },
      ),
  },
};

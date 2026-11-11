import type { SellerEntitlement } from "~/api/astrobox/order";

/** 吊销原因的长度上限，与服务端一致（超出会被截断）。 */
export const MAX_REVOKE_REASON_LENGTH = 200;

/** 单次拉取的权益记录上限，与服务端一致。到顶时列表可能不完整。 */
export const ENTITLEMENT_LIST_LIMIT = 500;

/** 买家 × 设备：创作者吊销/恢复的最小单位。 */
export interface EntitlementGroup {
  key: string;
  buyerUserId: string;
  buyerName: string;
  buyerAvatar: string;
  resourceId: string;
  deviceId: string;
  /** 该买家在此设备下的全部来源记录（订单、CDK），最新的在前。 */
  sources: SellerEntitlement[];
  /** 最早获得权限的时间。 */
  firstGrantedAt: string;
  /** 只要还有一条活跃记录就算生效（与服务端取密钥的判断一致）。 */
  revoked: boolean;
  /** 全部被吊销时最近一次的吊销时间与原因；仍生效时为空串。 */
  revokedAt: string;
  revokeReason: string;
}

export function isEntitlementRevoked(item: Pick<SellerEntitlement, "revokedAt">) {
  return Boolean(item.revokedAt);
}

export function buyerDisplayName(item: Pick<EntitlementGroup, "buyerName" | "buyerUserId">) {
  return item.buyerName.trim() || item.buyerUserId;
}

function time(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 把逐条权益记录折叠成「买家 × 设备」。服务端的吊销与恢复都按这个粒度生效，
 * 列表也按这个粒度展示，避免同一买家同一设备出现两行却各自点了同一个按钮。
 */
export function groupSellerEntitlements(items: readonly SellerEntitlement[]): EntitlementGroup[] {
  const groups = new Map<string, EntitlementGroup>();
  for (const item of items) {
    const key = `${item.buyerUserId}\u0000${item.resourceId}\u0000${item.deviceId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        buyerUserId: item.buyerUserId,
        buyerName: item.buyerName,
        buyerAvatar: item.buyerAvatar,
        resourceId: item.resourceId,
        deviceId: item.deviceId,
        sources: [],
        firstGrantedAt: item.createdAt,
        revoked: true,
        revokedAt: "",
        revokeReason: "",
      };
      groups.set(key, group);
    }
    group.sources.push(item);
    if (time(item.createdAt) < time(group.firstGrantedAt)) group.firstGrantedAt = item.createdAt;
  }

  for (const group of groups.values()) {
    group.sources.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    group.revoked = group.sources.every(isEntitlementRevoked);
    if (group.revoked) {
      const latest = group.sources.reduce((a, b) => (time(b.revokedAt) > time(a.revokedAt) ? b : a));
      group.revokedAt = latest.revokedAt;
      group.revokeReason = latest.revokeReason;
    }
  }

  // 生效中的在前，同状态下最近获得的在前
  return [...groups.values()].sort((a, b) => {
    if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
    return time(b.sources[0]!.createdAt) - time(a.sources[0]!.createdAt);
  });
}

/** 按买家昵称 / 用户 ID / 设备 / 来源单号做不区分大小写的子串过滤。 */
export function filterEntitlementGroups(
  groups: readonly EntitlementGroup[],
  keyword: string,
  deviceLabel: (deviceId: string) => string = (deviceId) => deviceId,
) {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups.filter((group) =>
    [
      group.buyerName,
      group.buyerUserId,
      group.deviceId,
      deviceLabel(group.deviceId),
      ...group.sources.map((source) => source.sourceRef),
    ].some((field) => field.toLowerCase().includes(needle)),
  );
}

export function summarizeEntitlementGroups(groups: readonly EntitlementGroup[]) {
  const revoked = groups.filter((group) => group.revoked).length;
  return { total: groups.length, active: groups.length - revoked, revoked };
}

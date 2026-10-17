import { useEffect, useSyncExternalStore } from "react";
import { AdminApi, type AdminUserSummary } from "~/api/astrobox/admin";

/**
 * AstroBox 账号目录：把页面上出现的裸 userId 解析成账号摘要（昵称 / 头像 / 角色）。
 *
 * 「资源管理」详情页里到处是 sellerUserId / buyerUserId / senderId 这类裸 uid，
 * 这里统一解析成账号，供账号胶囊展示与按昵称搜索使用。
 *
 * - 同一 uid 全局只请求一次（模块级缓存，跨组件共享）；
 * - 全局限并发，避免一个资源挂着几百条订单时瞬间打出几百个请求；
 * - 用 `useSyncExternalStore` 订阅，解析完成后自动重渲染。
 */

/** undefined 表示还没解析；null 表示解析过但取不到（账号被删 / 当前没权限）。 */
type AdminUserEntry = AdminUserSummary | null;

const MAX_CONCURRENT = 4;

const entries = new Map<string, AdminUserEntry>();
const requested = new Set<string>();
const waiting: string[] = [];
const listeners = new Set<() => void>();
let active = 0;
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function pump() {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const userId = waiting.shift()!;
    active += 1;
    AdminApi.users.detail(userId)
      .then((detail) => {
        entries.set(userId, detail);
      })
      .catch(() => {
        // 失败（账号不存在 / 非管理员）只记录一次，不自动重试，避免打爆服务端。
        entries.set(userId, null);
      })
      .finally(() => {
        active -= 1;
        notify();
        pump();
      });
  }
}

/** 申请解析一个 uid；重复调用是空操作。 */
export function requestAdminUser(userId?: string | null) {
  const id = (userId ?? "").trim();
  if (!id || requested.has(id)) return;
  requested.add(id);
  waiting.push(id);
  pump();
}

export function getAdminUserEntry(
  userId?: string | null,
): AdminUserEntry | undefined {
  const id = (userId ?? "").trim();
  return id ? entries.get(id) : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 目录版本号：数据有更新时变化，供需要「全量账号名」的场景（搜索）订阅。 */
export function useAdminUserDirectoryVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

/** 解析单个 uid，并自动发起（去重、限并发的）请求。 */
export function useAdminUserEntry(userId?: string | null) {
  const id = (userId ?? "").trim();
  const entry = useSyncExternalStore(subscribe, () => getAdminUserEntry(id));
  useEffect(() => {
    requestAdminUser(id);
  }, [id]);

  return {
    user: entry ?? null,
    pending: id.length > 0 && entry === undefined,
  };
}

/** 账号展示名：昵称 → 用户名 → uid → 传入的兜底值。 */
export function adminUserDisplayName(
  user: AdminUserSummary | null | undefined,
  fallback = "",
) {
  return user?.displayName || user?.username || user?.userId || fallback;
}

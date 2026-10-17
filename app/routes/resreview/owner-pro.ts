import { useEffect, useState } from "react";
import {
  AdminApi,
  type AdminUserSummary,
  type VipTier,
} from "~/api/astrobox/admin";
import { getPublicProfile } from "~/api/astrobox/profile";
import { ApiError } from "~/api/astrobox/request";

/**
 * manifest 的 author[].name 约定填 AstroBox「用户名」（username，账号的唯一句柄），
 * 不是展示用的 displayName；author[].bindABAccount 仍是自报开关。
 *
 * 流程：先看 bindABAccount 是否开启；开启（声明已绑定 AstroBox）后，用公开的
 * /account/profile 按 username 精确取到 userId，再拉 /admin/users/:userId 拿真实
 * vip 权益。这里不走 /admin/users?search 模糊搜索——该接口对 userId / displayName /
 * email / username 做子串匹配且按注册时间截断，短用户名（如「ab」）会命中大量账号，
 * 真正的账号常被挤出结果页，于是明明存在的作者被误判成未匹配。
 *
 * 因此反查只认用户名精确匹配，分不出「displayName 恰好等于用户名」的情况也无所谓：
 * 作者字段本来就只允许填用户名，displayName 一律视为未匹配。
 * 后一步 /admin/users/:userId 仅 AstroBox 管理员可调用；未登录或非管理员时返回 no-auth。
 */
export type AuthorProStatus =
  | { state: "loading" }
  | { state: "no-auth" }
  | { state: "not-found" }
  | { state: "error"; message: string }
  | { state: "found"; user: AdminUserSummary };

const cache = new Map<string, AuthorProStatus>();
const inflight = new Map<string, Promise<AuthorProStatus>>();

async function findUserByUsername(username: string): Promise<AuthorProStatus> {
  const target = username.trim();
  if (!target) return { state: "not-found" };
  try {
    // 公开接口按 username 做 findOne（精确），短用户名不会歧义。
    const profile = await getPublicProfile({ username: target });
    // 再用管理员接口补上 vip / vipExpireMap，供 Creator Pro 与比例判定使用。
    const user = await AdminApi.users.detail(profile.userId);
    return { state: "found", user };
  } catch (err) {
    // 账号不存在时服务端返回 404，其余（网络、权限、5xx）都算查询失败。
    if (err instanceof ApiError && err.status === 404) {
      return { state: "not-found" };
    }
    return {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveOne(
  name: string,
  astroboxToken: string | undefined,
): Promise<AuthorProStatus> {
  if (!astroboxToken) return Promise.resolve({ state: "no-auth" } as AuthorProStatus);
  const cached = cache.get(name);
  if (cached && cached.state !== "loading") return Promise.resolve(cached);
  const pending = inflight.get(name) ?? findUserByUsername(name);
  inflight.set(name, pending);
  return pending.finally(() => {
    inflight.delete(name);
  });
}

/** 给定一组作者名称，返回每个名称对应的真实权益状态（plain async，供规则检查使用）。 */
export async function resolveAuthorProStatuses(
  names: string[],
  astroboxToken?: string,
): Promise<Record<string, AuthorProStatus>> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (n) => {
      const result = await resolveOne(n, astroboxToken);
      cache.set(n, result);
      return [n, result] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** React hook：供资源信息页展示作者权益徽章。 */
export function useAuthorsProStatuses(
  names: string[],
  astroboxToken?: string,
): Record<string, AuthorProStatus> {
  const key = names.join("\u0001");
  const [statuses, setStatuses] = useState<Record<string, AuthorProStatus>>({});

  useEffect(() => {
    const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
    if (unique.length === 0) {
      setStatuses({});
      return;
    }

    let cancelled = false;
    setStatuses((prev) => {
      const next: Record<string, AuthorProStatus> = {};
      for (const n of unique) next[n] = prev[n] ?? { state: "loading" };
      return next;
    });

    resolveAuthorProStatuses(unique, astroboxToken).then((result) => {
      if (cancelled) return;
      setStatuses(result);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, astroboxToken]);

  return statuses;
}

/** 是否拥有 Creator Pro 权益。Creator Plus 不计入。 */
export function hasCreatorPro(vip: VipTier): boolean {
  return vip === "CreatorPro";
}

export function vipTierLabel(vip: VipTier): string {
  switch (vip) {
    case "CreatorPro":
      return "Creator Pro";
    case "CreatorPlus":
      return "Creator Plus";
    case "Pro":
      return "Pro";
    default:
      return "无";
  }
}

/** 根据 vipExpireMap 判断该等级是否仍在有效期内。 */
export function isVipActive(
  vip: VipTier,
  vipExpireMap: Record<string, string> | undefined,
): boolean {
  if (vip === "None") return false;
  if (!vipExpireMap) return true;
  const expire = vipExpireMap[vip];
  if (!expire) return true;
  const ts = Date.parse(expire);
  if (Number.isNaN(ts)) return true;
  return ts > Date.now();
}

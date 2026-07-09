import { useEffect, useState } from "react";
import {
  AdminApi,
  type AdminUserSummary,
  type VipTier,
} from "~/api/astrobox/admin";

/**
 * manifest 的 author[].name 是创作者自填的名称（自由文本，非 GitHub 登录名，
 * 也非 AstroBox 账户 id），author[].bindABAccount 只是自报开关。
 *
 * 流程：先看 bindABAccount 是否开启；开启（声明已绑定 AstroBox）后，再通过后端
 * /admin/users 按「名称」搜索并精确比对 displayName / username，取该作者真实 vip
 * 权益。仅 AstroBox 管理员可调用；未登录或非管理员时返回 no-auth。
 */
export type AuthorProStatus =
  | { state: "loading" }
  | { state: "no-auth" }
  | { state: "not-found" }
  | { state: "error"; message: string }
  | { state: "found"; user: AdminUserSummary };

const cache = new Map<string, AuthorProStatus>();
const inflight = new Map<string, Promise<AuthorProStatus>>();

async function findUserByName(name: string): Promise<AuthorProStatus> {
  const target = name.trim().toLowerCase();
  if (!target) return { state: "not-found" };
  try {
    const res = await AdminApi.users.list({ search: target, limit: 50 });
    const match = res.items.find(
      (u) =>
        u.displayName.trim().toLowerCase() === target ||
        u.username.trim().toLowerCase() === target,
    );
    return match ? { state: "found", user: match } : { state: "not-found" };
  } catch (err) {
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
  const pending = inflight.get(name) ?? findUserByName(name);
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

/** 是否拥有 Creator Console Pro 权益（CreatorPlus / CreatorPro）。 */
export function hasCreatorPro(vip: VipTier): boolean {
  return vip === "CreatorPro" || vip === "CreatorPlus";
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

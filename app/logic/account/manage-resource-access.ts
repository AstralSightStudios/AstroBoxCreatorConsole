import { useCommunityRepoManageAccess } from "./repo-permission";
import { useAccountState } from "./store";

/**
 * AstroBox 管理后台角色。与 `AdminPage` 的默认 requiredRoles 保持一致，
 * 服务端 /admin/* 接口同样按这两个角色放行。
 */
const ASTROBOX_ADMIN_ROLES = ["admin", "moderator"] as const;

export interface ManageResourceAccess {
  /** 已登录 GitHub（仓库权限检查的前提）。 */
  loggedIn: boolean;
  /** GitHub 仓库权限检查进行中。 */
  checking: boolean;
  /** 已具备社区仓库管理权限（admin / maintain / write）。 */
  repoAllowed: boolean;
  /** 已登录 AstroBox 账号。 */
  astroboxLoggedIn: boolean;
  /** AstroBox 账号具备 admin / moderator 角色。 */
  isAstroboxAdmin: boolean;
  repoError: string;
  repoLabel: string;
}

export function isAstroboxAdminRole(roles: readonly string[] | undefined) {
  return ASTROBOX_ADMIN_ROLES.some((role) => roles?.includes(role));
}

/**
 * 「资源管理」详情页的访问判定。
 *
 * 页面本身只需要 GitHub 仓库权限就能进去读 index_v2.csv 与资源仓库的
 * manifest_v2.json；只有售卖配置 / 权益 / 订单 / 举报这些走 AstroBox
 * `/admin/*` 的分区才额外需要 admin / moderator 角色。因此这里不做整页拦截，
 * 只是把两个维度的权限都暴露出来，由调用方（详情页）按分区决定展示什么。
 */
export function useManageResourceAccess(): ManageResourceAccess {
  const repo = useCommunityRepoManageAccess();
  const accountState = useAccountState();
  const roles = accountState.astrobox?.roles ?? [];

  return {
    loggedIn: repo.loggedIn,
    checking: repo.checking,
    repoAllowed: repo.allowed,
    astroboxLoggedIn: Boolean(accountState.astrobox),
    isAstroboxAdmin: isAstroboxAdminRole(roles),
    repoError: repo.error,
    repoLabel: repo.repoLabel,
  };
}

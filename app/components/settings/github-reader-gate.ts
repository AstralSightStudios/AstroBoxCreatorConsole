import type { CommunityRepoManageAccess } from "~/logic/account/repo-permission";

/** 设置页 GitHub 读取账号入口的统一门禁文案。 */
export function getGithubReaderGateMessage(
  access: CommunityRepoManageAccess,
): string {
  if (!access.loggedIn) {
    return "请先登录 GitHub 主账号。";
  }
  if (access.checking) {
    return "正在校验主账号的社区仓库审核权限…";
  }
  if (access.error) {
    return `无法校验主账号审核权限：${access.error}`;
  }
  if (!access.allowed) {
    const repoLabel = access.repoLabel || "当前社区仓库";
    return `读取账号仅对具备 ${repoLabel} 审核权限（admin / maintain / write）的主账号开放，用于审核者绕过 GitHub API 速率限制。`;
  }
  return "";
}

export function canAddGithubReader(access: CommunityRepoManageAccess): boolean {
  return access.loggedIn && !access.checking && access.allowed;
}

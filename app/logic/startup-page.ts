import { DEFAULT_STARTUP_PAGE, normalizeStartupPage } from "~/config/startupPage";
import { normalizePath } from "~/layout/nav-config";

/**
 * 启动页跳转只应在「本次启动后首次落到概览页」时发生一次。
 *
 * 不能直接写成「在 / 上就跳转」：概览本身是导航里的一页，用户手动点回概览时
 * 同样会停在 /，那样就再也回不去了。所以用会话级标记消费掉这一次机会——
 * 应用启动（路径 /）、登录完成后落地（/）、外部登录回调落地（/）都会被消费，
 * 而用户在会话中主动导航不会重新触发。
 */
let redirectApplied = false;

export interface StartupRedirectInput {
  pathname: string;
  /** 是否已具备进入控制台的账号（否则应先落到欢迎页）。 */
  canUseConsole: boolean;
  startupPage?: string;
  redirectApplied?: boolean;
}

/** 纯函数：算出本次渲染应该跳到哪里，不需要跳转时返回 null。 */
export function resolveStartupRedirectPath({
  pathname,
  canUseConsole,
  startupPage = DEFAULT_STARTUP_PAGE,
  redirectApplied: applied = redirectApplied,
}: StartupRedirectInput): string | null {
  if (applied || !canUseConsole) return null;
  // 只有概览页是「还没决定去哪」的初始落点，其余路径都是明确意图（深链、手动导航）。
  if (normalizePath(pathname) !== "/") return null;

  const target = normalizeStartupPage(startupPage);
  if (target === "/") return null;
  return target;
}

export function hasAppliedStartupRedirect(): boolean {
  return redirectApplied;
}

export function markStartupRedirectApplied() {
  redirectApplied = true;
}

/**
 * 退出登录（或账号被清空）时重置，让本次会话里重新登录后仍能落到启动页。
 * 与 resetStartupRedirectForTest 行为一致，命名区分语义而非实现。
 */
export function resetStartupRedirect() {
  redirectApplied = false;
}
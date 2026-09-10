import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Drawer } from "vaul";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  CoinIcon,
  GithubLogoIcon,
  SignOutIcon,
  UserCircleDashedIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import NavItem from "~/components/nav/navitem";
import FunctionButton from "~/components/nav/function-button";
import {
  useGithubLoginState,
  startGithubLogin,
  cancelGithubLogin,
  type GithubLoginState,
  type GithubDeviceSession,
} from "~/logic/account/github-login-state";
import {
  getDisplayAccount,
  logoutAccount,
  useAccountState,
  type AccountProvider,
  type AccountState,
  type DisplayAccount,
} from "~/logic/account/store";
import {
  hasRequiredNavRole,
  NAV_PRIMARY_ACTION,
  NAV_SECTIONS,
  sortNavItems,
  type NavSectionConfig,
  matchesNavPath,
} from "./nav-config";
import { useNavVisibility } from "./nav-visibility-context";
import { AstroBoxLogo } from "~/components/svgs";
import InboxBell from "~/components/inbox/InboxBell";
import InboxDrawer from "~/components/inbox/InboxDrawer";
import { useInboxPolling } from "~/logic/inbox/use-inbox";
import TitlebarEffect from "~/components/TitlebarEffect";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import {
  isNavItemVisible,
  useNavAccountCollapse,
  useNavItemPreferences,
  type NavItemPreferences,
} from "~/config/nav";
import AfdianMessagesSidebar from "~/components/afdian/messages-sidebar";

import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Dialog,
  Popover,
  Spinner,
} from "~/components/ScaleAwareThemes";
import { toast } from "sonner";
import BlurEffect from "react-progressive-blur";
import { canAccessAnalysisByPlan } from "~/logic/account/permissions";
import {
  AFDIAN_INCOME_QUERY_KEY,
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
  logoutAfdian,
  type AfdianSessionStatus,
} from "~/api/afdian-account";

const NAV_HEADER_COLLAPSE_THRESHOLD = 56;
const NAV_HEADER_EXPANDED_HEIGHT = "clamp(218px, var(--ui-viewport-height-30pct), 342px)";
const NAV_HEADER_MOBILE_EXPANDED_HEIGHT = "clamp(162px, var(--ui-viewport-height-30pct), 286px)";
const NAV_HEADER_RESTING_HEIGHT = "clamp(132px, 18dvh, 200px)";
const NAV_HEADER_MOBILE_RESTING_HEIGHT = "clamp(112px, 18dvh, 180px)";

interface NavScrollState {
  scrollTop: number;
  canScrollUp: boolean;
  canScrollDown: boolean;
}

function getNavGridTemplateRows(
  scrollTop: number,
  expandedHeight: string,
  restingHeight: string,
  collapseAccountOnScroll: boolean,
) {
  const collapseOffset = Math.max(0, scrollTop - NAV_HEADER_COLLAPSE_THRESHOLD);
  const headerHeight = collapseAccountOnScroll
    ? `clamp(100px, calc(${expandedHeight} - ${collapseOffset}px), ${expandedHeight})`
    : restingHeight;

  return `${headerHeight} minmax(0, 1fr)`;
}

export default function Nav() {
  const accountState = useAccountState();
  const account = getDisplayAccount(accountState);
  const collapseAccountOnScroll = useNavAccountCollapse();
  const navItemPreferences = useNavItemPreferences();
  const location = useLocation();
  const navigate = useNavigate();
  const [navScrollState, setNavScrollState] = useState<NavScrollState>({
    scrollTop: 0,
    canScrollUp: false,
    canScrollDown: true,
  });
  const isAfdianMessagesRoute = matchesNavPath(
    "/afdian-messages",
    location.pathname,
  );
  const [showAfdianMessagesSidebar, setShowAfdianMessagesSidebar] = useState(
    isAfdianMessagesRoute,
  );
  const wasAfdianMessagesDesktopRef = useRef(false);
  useInboxPolling();
  const {
    isCollapsed,
    isDesktop,
    toggleNav,
    collapseNav,
    collapseNavForNavigation,
  } = useNavVisibility();
  const originalOverflowRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!isDesktop && !isCollapsed) {
      if (originalOverflowRef.current === null) {
        originalOverflowRef.current = document.body.style.overflow;
      }
      document.body.style.overflow = "hidden";
      return () => {
        if (originalOverflowRef.current !== null) {
          document.body.style.overflow = originalOverflowRef.current;
          originalOverflowRef.current = null;
        }
      };
    }

    if (originalOverflowRef.current !== null) {
      document.body.style.overflow = originalOverflowRef.current;
      originalOverflowRef.current = null;
    }
  }, [isCollapsed, isDesktop]);

  useEffect(() => {
    if (!isDesktop && isCollapsed) {
      setNavScrollState({
        scrollTop: 0,
        canScrollUp: false,
        canScrollDown: true,
      });
    }
  }, [isCollapsed, isDesktop]);

  useEffect(() => {
    const isAfdianMessagesDesktop = isDesktop && isAfdianMessagesRoute;
    if (isAfdianMessagesDesktop && !wasAfdianMessagesDesktopRef.current) {
      setShowAfdianMessagesSidebar(true);
    } else if (!isAfdianMessagesDesktop) {
      setShowAfdianMessagesSidebar(false);
    }
    wasAfdianMessagesDesktopRef.current = isAfdianMessagesDesktop;
  }, [isAfdianMessagesRoute, isDesktop]);

  const handleNavigate = (path: string) => {
    const drawerOpen = !isDesktop && !isCollapsed;
    const isNewRoute = location.pathname !== path;

    if (isDesktop && path === "/afdian-messages" && isAfdianMessagesRoute) {
      setShowAfdianMessagesSidebar(true);
      return;
    }

    if (isNewRoute) {
      // 移动端抽屉展开时已写入临时历史记录，导航时直接替换为目标页面。
      navigate(path, drawerOpen ? { replace: true } : undefined);
    }

    if (!isDesktop) {
      if (drawerOpen && isNewRoute) {
        collapseNavForNavigation();
      } else {
        collapseNav();
      }
    }
  };

  const handleNavScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const scrollTop = Math.max(0, target.scrollTop);

    setNavScrollState({
      scrollTop,
      canScrollUp: scrollTop > 1,
      canScrollDown: scrollTop < maxScrollTop - 1,
    });
  }, []);

  const sharedProps = {
    account,
    accountState,
    pathname: location.pathname,
    onNavigate: handleNavigate,
    navScrollState,
    onNavScroll: handleNavScroll,
    collapseAccountOnScroll,
    navItemPreferences,
  };

  if (isDesktop) {
    return (
      <DesktopNav
        {...sharedProps}
        isCollapsed={isCollapsed}
        onToggleNav={toggleNav}
        showAfdianMessagesSidebar={
          isAfdianMessagesRoute && showAfdianMessagesSidebar
        }
        onShowNav={() => setShowAfdianMessagesSidebar(false)}
      />
    );
  }

  return (
    <MobileNav
      {...sharedProps}
      open={!isCollapsed}
      onToggleNav={collapseNav}
      onDismiss={collapseNav}
    />
  );
}

interface NavContentProps {
  account: DisplayAccount;
  accountState: AccountState;
  pathname: string;
  onNavigate: (path: string) => void;
  onToggleNav: () => void;
  navScrollState: NavScrollState;
  onNavScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  collapseAccountOnScroll: boolean;
  navItemPreferences: NavItemPreferences;
  hideFunctionButton?: boolean;
  hideHeader?: boolean;
}

function NavContent({
  account,
  accountState,
  onToggleNav,
  pathname,
  onNavigate,
  onNavScroll,
  navScrollState,
  navItemPreferences,
  hideFunctionButton,
  hideHeader,
}: NavContentProps) {
  const navMaskImage = `linear-gradient(to bottom, ${
    navScrollState.canScrollUp
      ? "transparent 0, #000 56px, "
      : "#000 0, "
  }${
    navScrollState.canScrollDown
      ? "#000 calc(100% - 56px), transparent 100%"
      : "#000 100%"
  })`;

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {hideHeader ? (
          <div className="h-11 shrink-0" aria-hidden="true" />
        ) : (
          <NavHeader
            account={account}
            accountState={accountState}
            onToggleNav={onToggleNav}
            onNavigate={onNavigate}
            hideFunctionButton={hideFunctionButton}
          />
        )}
        <AccountInfo account={account} />
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <div
            className="nav-scroll-area h-full overflow-y-auto"
            style={{
              maskImage: navMaskImage,
              WebkitMaskImage: navMaskImage,
            }}
            onScroll={onNavScroll}
          >
            <div className="flex flex-col gap-0 py-14">
              {NAV_SECTIONS.map((section) => (
                <NavSection
                  key={section.id}
                  {...section}
                  accountState={accountState}
                  navItemPreferences={navItemPreferences}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
              <div className="h-px w-[calc(100%-1rem)] bg-white/10 mt-2 mb-1 mx-2"></div>
            </div>
          </div>

          {navScrollState.canScrollUp && (
            <BlurEffect
              className="!pointer-events-none h-10 w-full"
              intensity={50}
              position="top"
            />
          )}
          {navScrollState.canScrollDown && (
            <BlurEffect
              className="!pointer-events-none h-18 w-full"
              intensity={50}
              position="bottom"
            />
          )}
        </div>

        {isNavItemVisible(NAV_PRIMARY_ACTION.id, navItemPreferences) && (
          <div className="absolute inset-x-0 bottom-0 z-50 min-w-0 pb-[max(0.75rem,var(--ui-safe-area-bottom))] pt-3">
            <NavItem
              icon={NAV_PRIMARY_ACTION.icon}
              label={NAV_PRIMARY_ACTION.label}
              selected={matchesNavPath(NAV_PRIMARY_ACTION.path, pathname)}
              onClick={() => onNavigate(NAV_PRIMARY_ACTION.path)}
            />
          </div>
        )}
      </div>
    </>
  );
}

interface DesktopNavProps extends NavContentProps {
  isCollapsed: boolean;
  onToggleNav: () => void;
  showAfdianMessagesSidebar: boolean;
  onShowNav: () => void;
}

function DesktopAfdianMessagesNav() {
  return (
    <nav className="app-desktop-nav relative z-10 flex h-full w-64 flex-col gap-2 overflow-hidden bg-transparent p-3 pb-[max(0.75rem,var(--ui-safe-area-bottom))] pt-[max(0.75rem,var(--ui-safe-area-top))] pl-[max(0.75rem,var(--ui-safe-area-left))]">
      <TitlebarEffect className="titlebar-effect-sidebar" />
      <AfdianMessagesSidebar />
    </nav>
  );
}

function DesktopNav({
  isCollapsed,
  showAfdianMessagesSidebar,
  onShowNav,
  ...contentProps
}: DesktopNavProps) {
  return (
    <aside
      className={`relative isolate shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${isCollapsed ? "w-0" : "w-64"}`}
      aria-hidden={isCollapsed}
    >
      {!isCollapsed && (
        <>
          <div className="app-desktop-nav-persistent-header absolute left-[max(0.75rem,var(--ui-safe-area-left))] right-3 top-[max(0.75rem,var(--ui-safe-area-top))] z-30">
            <NavHeader
              account={contentProps.account}
              accountState={contentProps.accountState}
              onToggleNav={
                showAfdianMessagesSidebar
                  ? onShowNav
                  : contentProps.onToggleNav
              }
              onNavigate={contentProps.onNavigate}
              desktopFunctionButtonInteractive={showAfdianMessagesSidebar}
              title={
                showAfdianMessagesSidebar ? "爱发电私信" : undefined
              }
            />
          </div>
          <AnimatePresence initial={false} mode="sync">
            {showAfdianMessagesSidebar ? (
              <motion.div
                key="afdian-messages"
                className="absolute inset-0 z-10 h-full w-64"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: [0.22, 0.82, 0.3, 1] }}
              >
                <DesktopAfdianMessagesNav />
              </motion.div>
            ) : (
              <motion.div
                key="main-nav"
                className="absolute inset-0 z-10 h-full w-64"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2, ease: [0.22, 0.82, 0.3, 1] }}
              >
                <nav
                  className="app-desktop-nav relative z-10 grid h-full w-64 grid-cols-1 gap-2 overflow-hidden bg-transparent p-3 pb-0 pt-[max(0.75rem,var(--ui-safe-area-top))] pl-[max(0.75rem,var(--ui-safe-area-left))]"
                  style={{
                    gridTemplateRows: getNavGridTemplateRows(
                      contentProps.navScrollState.scrollTop,
                      NAV_HEADER_EXPANDED_HEIGHT,
                      NAV_HEADER_RESTING_HEIGHT,
                      contentProps.collapseAccountOnScroll,
                    ),
                  }}
                >
                  <TitlebarEffect className="titlebar-effect-sidebar" />
                  <NavContent {...contentProps} hideHeader />
                </nav>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </aside>
  );
}

interface MobileNavProps extends NavContentProps {
  open: boolean;
  onDismiss: () => void;
  onToggleNav: () => void;
}

function MobileNav({ open, onDismiss, ...contentProps }: MobileNavProps) {
  const { portalContainer } = useUiScaleViewport();

  return (
    <Drawer.Root
      open={open}
      direction="left"
      noBodyStyles
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss();
      }}
    >
      <Drawer.Portal container={portalContainer ?? undefined}>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-lg" />
        <Drawer.Content asChild>
          <nav
            className="app-mobile-nav fixed inset-y-0 left-0 z-50 grid h-full w-[clamp(218px,75%,342px)] grid-cols-1 gap-2 overflow-hidden bg-bg p-3 pb-0 pt-[max(0.75rem,var(--ui-safe-area-top))] pl-[max(0.75rem,var(--ui-safe-area-left))] pr-[max(0.75rem,var(--ui-safe-area-right))] outline-none"
            style={{
              gridTemplateRows: getNavGridTemplateRows(
                contentProps.navScrollState.scrollTop,
                NAV_HEADER_MOBILE_EXPANDED_HEIGHT,
                NAV_HEADER_MOBILE_RESTING_HEIGHT,
                contentProps.collapseAccountOnScroll,
              ),
            }}
          >
            <Drawer.Title className="sr-only">功能导航</Drawer.Title>
            <Drawer.Description className="sr-only">滑动或点击遮罩可关闭导航</Drawer.Description>
            <NavContent hideFunctionButton={true} {...contentProps} />
          </nav>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

interface NavHeaderProps {
  account: DisplayAccount;
  accountState: AccountState;
  onToggleNav: () => void;
  /** 主导航侧栏传入（含移动端 Drawer 的 replace/收起逻辑）；独立侧栏缺省时直接导航。 */
  onNavigate?: (path: string) => void;
  hideFunctionButton?: boolean;
  desktopFunctionButtonInteractive?: boolean;
  title?: string;
}

function NavHeader({
  account,
  accountState,
  onToggleNav,
  onNavigate,
  hideFunctionButton,
  desktopFunctionButtonInteractive,
  title,
}: NavHeaderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showGithubLogoutConfirm, setShowGithubLogoutConfirm] = useState(false);
  const [showAstroLogoutConfirm, setShowAstroLogoutConfirm] = useState(false);
  const [showAfdianLogoutConfirm, setShowAfdianLogoutConfirm] = useState(false);
  const [afdianLoggingOut, setAfdianLoggingOut] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const githubLoginState = useGithubLoginState();
  const afdianSessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: isAfdianNativeAvailable(),
    staleTime: 30_000,
    retry: false,
  });

  const handleMenuNavigate = (path: string) => {
    setIsMenuOpen(false);
    if (onNavigate) {
      onNavigate(path);
      return;
    }
    navigate(path);
  };

  const handleGithubLogin = async () => {
    setIsMenuOpen(true);
    await startGithubLogin();
  };

  const handleAstroLogout = () => {
    if (!accountState.astrobox) return;
    setIsMenuOpen(false);
    setShowAstroLogoutConfirm(true);
  };

  const confirmAstroLogout = () => {
    logoutAccount("astrobox");
    window.location.reload();
  };

  const handleGithubLogout = () => {
    if (!accountState.github) return;
    setIsMenuOpen(false);
    setShowGithubLogoutConfirm(true);
  };

  const confirmGithubLogout = () => {
    cancelGithubLogin();
    logoutAccount("github");
    window.location.reload();
  };

  const handleAfdianLogout = () => {
    if (!afdianSessionQuery.data?.connected) return;
    setIsMenuOpen(false);
    setShowAfdianLogoutConfirm(true);
  };

  const confirmAfdianLogout = async () => {
    setAfdianLoggingOut(true);
    try {
      await logoutAfdian();
      queryClient.setQueryData<AfdianSessionStatus>(AFDIAN_SESSION_QUERY_KEY, {
        connected: false,
        displayName: null,
      });
      queryClient.removeQueries({ queryKey: AFDIAN_INCOME_QUERY_KEY });
      setShowAfdianLogoutConfirm(false);
      toast.success("已退出爱发电账户");
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "退出爱发电账户失败"));
    } finally {
      setAfdianLoggingOut(false);
    }
  };

  const hasAccount =
    account.hasAstrobox ||
    account.hasGithub ||
    Boolean(afdianSessionQuery.data?.connected);
  const isGithubBusy =
    githubLoginState.status === "requesting" ||
    githubLoginState.status === "waiting";

  return (
    <>
      <Popover.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <div
          className={`flex flex-row items-center self-stretch px-1 py-1 ${hideFunctionButton ? "justify-end" : "justify-between"}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {!hideFunctionButton && (
              <FunctionButton
                desktopInteractive={desktopFunctionButtonInteractive}
                aria-label={desktopFunctionButtonInteractive ? "返回一级导航" : undefined}
                title={desktopFunctionButtonInteractive ? "返回一级导航" : undefined}
                onClick={onToggleNav}
              >
                {desktopFunctionButtonInteractive ? (
                  <ArrowLeftIcon
                    className="fill-icon-primary"
                    size={20}
                    weight="bold"
                    aria-hidden="true"
                  />
                ) : undefined}
              </FunctionButton>
            )}
            {title && (
              <h2 className="truncate font-[520] text-size-large text-white/80">
                {title}
              </h2>
            )}
          </div>
          <div className="nav-account-actions flex items-center gap-2">
            <InboxBell onClick={() => setInboxOpen(true)} />
            <Popover.Trigger>
              <button
                type="button"
                aria-label="账号菜单"
                className="inline-flex items-center justify-center rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <AccountAvatar account={account} isActive={hasAccount} />
              </button>
            </Popover.Trigger>
          </div>
        </div>
        <AccountMenu
          accountState={accountState}
          githubLoginState={githubLoginState}
          isGithubBusy={isGithubBusy}
          onAstroLogin={() => handleMenuNavigate("/login")}
          onGithubLogin={handleGithubLogin}
          onAfdianLogin={() => handleMenuNavigate("/settings")}
          onAstroLogout={handleAstroLogout}
          onGithubLogout={handleGithubLogout}
          afdianSession={afdianSessionQuery.data}
          afdianLoggingOut={afdianLoggingOut}
          onAfdianLogout={handleAfdianLogout}
        />
      </Popover.Root>

      <InboxDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} />

      <LogoutConfirmDialog
        open={showGithubLogoutConfirm}
        onOpenChange={setShowGithubLogoutConfirm}
        title="退出 GitHub 账号"
        description="确认退出 GitHub 账号？退出后需要重新登录。"
        onConfirm={confirmGithubLogout}
      />

      <LogoutConfirmDialog
        open={showAstroLogoutConfirm}
        onOpenChange={setShowAstroLogoutConfirm}
        title="退出 AstroBox 账号"
        description="确认退出 AstroBox 账号？退出后需要重新登录。"
        onConfirm={confirmAstroLogout}
      />

      <LogoutConfirmDialog
        open={showAfdianLogoutConfirm}
        onOpenChange={setShowAfdianLogoutConfirm}
        title="退出爱发电账号"
        description="确认退出爱发电账号？退出后需要重新登录。"
        onConfirm={() => void confirmAfdianLogout()}
        loading={afdianLoggingOut}
      />
    </>
  );
}

interface LogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
}

function LogoutConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  loading = false,
}: LogoutConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="max-w-[520px]">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description
          size="2"
          className="mt-3 whitespace-pre-line text-[14px]"
        >
          {description}
        </Dialog.Description>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            variant="soft"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            取消
          </Button>
          <Button variant="solid" onClick={onConfirm} disabled={loading}>
            {loading ? <Spinner size="1" /> : null}
            退出
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface AccountAvatarProps {
  account: DisplayAccount;
  isActive: boolean;
}

function AccountAvatar({ account, isActive }: AccountAvatarProps) {
  const [useFallback, setUseFallback] = useState(false);
  const [hideImage, setHideImage] = useState(false);

  useEffect(() => {
    setUseFallback(false);
    setHideImage(false);
  }, [account.avatar, account.avatarFallback]);

  const src = !useFallback ? account.avatar : account.avatarFallback;

  if (!src || hideImage) {
    return (
      <UserCircleDashedIcon
        className={`transition-colors ${isActive ? "text-white" : "text-white/80"}`}
        size={28}
      />
    );
  }

  const handleError = () => {
    if (!useFallback && account.avatarFallback) {
      setUseFallback(true);
    } else {
      setHideImage(true);
    }
  };

  return (
    <img
      src={src}
      alt=""
      className={`w-8 h-8 rounded-full object-cover border border-white/10 ${isActive ? "ring-2 ring-white/20" : ""}`}
      onError={handleError}
    />
  );
}

interface AccountMenuProps {
  accountState: AccountState;
  githubLoginState: GithubLoginState;
  isGithubBusy: boolean;
  afdianSession?: AfdianSessionStatus;
  afdianLoggingOut: boolean;
  onAstroLogin: () => void;
  onGithubLogin: () => void;
  onAfdianLogin: () => void;
  onAstroLogout: () => void;
  onGithubLogout: () => void;
  onAfdianLogout: () => void;
}

function AccountMenu({
  accountState,
  githubLoginState,
  isGithubBusy,
  afdianSession,
  afdianLoggingOut,
  onAstroLogin,
  onGithubLogin,
  onAfdianLogin,
  onAstroLogout,
  onGithubLogout,
  onAfdianLogout,
}: AccountMenuProps) {
  const hasAstrobox = Boolean(accountState.astrobox);
  const hasGithub = Boolean(accountState.github);
  const hasAfdian = Boolean(afdianSession?.connected);
  const showDeviceCard =
    githubLoginState.session && githubLoginState.status !== "idle";

  return (
    <Popover.Content
      align="end"
      side="bottom"
      sideOffset={8}
      collisionPadding={12}
      // Radix 负责边界检测与翻转，并通过 CSS 变量限制菜单大小。
      style={{
        padding: 0,
        background: "transparent",
        boxShadow: "none",
        border: "none",
        borderRadius: 20,
        width: "min(400px, var(--radix-popover-content-available-width))",
        maxHeight: "var(--radix-popover-content-available-height)",
        overflow: "visible",
        zIndex: "999",
      }}
    >
      <div className="rounded-3xl corner-rounded border border-white/10 bg-nav shadow-black backdrop-blur-xl p-1.5 space-y-1.5">
        {(hasAstrobox || hasGithub || hasAfdian) && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide text-white/60 pt-1 px-2 select-none">
              已登录账号
            </p>
            {hasAstrobox && (
              <ConnectedAccountRow
                provider="astrobox"
                name={accountState.astrobox?.name || "AstroBox"}
                detail={
                  accountState.astrobox?.email ||
                  accountState.astrobox?.plan ||
                  ""
                }
                avatar={accountState.astrobox?.avatar}
                onLogout={onAstroLogout}
              />
            )}
            {hasGithub && (
              <ConnectedAccountRow
                provider="github"
                name={
                  accountState.github?.name ||
                  accountState.github?.username ||
                  "GitHub"
                }
                detail={
                  accountState.github?.email ||
                  accountState.github?.username ||
                  ""
                }
                avatar={accountState.github?.avatar}
                onLogout={onGithubLogout}
              />
            )}
            {hasAfdian && (
              <ConnectedAccountRow
                provider="afdian"
                name={afdianSession?.displayName || "爱发电用户"}
                detail="已连接爱发电"
                onLogout={onAfdianLogout}
                loggingOut={afdianLoggingOut}
              />
            )}
          </div>
        )}

        {(!hasAstrobox || !hasGithub || !hasAfdian) && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide text-white/60 pt-1 px-2 select-none">
              登录新账号
            </p>
            {!hasAstrobox && (
              <MenuButton
                icon={<AstroBoxLogo size={22} />}
                label="AstroBox登录"
                description="登录到AstroBox账号以使用数据分析等功能"
                onClick={onAstroLogin}
              />
            )}
            {!hasGithub && (
              <MenuButton
                icon={<GithubLogoIcon size={24} weight="fill" />}
                label="GitHub登录"
                description="登录到GitHub账号以提交资源"
                onClick={onGithubLogin}
                loading={isGithubBusy}
              />
            )}
            {!hasAfdian && (
              <MenuButton
                icon={<CoinIcon size={22} />}
                label="爱发电登录"
                description="登录爱发电账号以查看收入数据"
                onClick={onAfdianLogin}
              />
            )}
          </div>
        )}

        {showDeviceCard && (
          <GithubDeviceCard
            session={githubLoginState.session!}
            status={githubLoginState.statusMessage}
          />
        )}
      </div>
    </Popover.Content>
  );
}

interface MenuButtonProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  loading?: boolean;
}

function MenuButton({
  icon,
  label,
  description,
  onClick,
  loading,
}: MenuButtonProps) {
  return (
    <button
      type="button"
      className="corner-rounded flex items-center gap-2 rounded-[14px] border border-white/10 bg-nav-item px-2.5 py-2 text-left text-white transition hover:border-white/20 hover:bg-nav-item-hover"
      onClick={onClick}
      disabled={loading}
    >
      <span className="flex h-8 w-8 items-center justify-center">{icon}</span>
      <span className="flex flex-col text-sm">
        <span className="text-sm font-semibold">{label}</span>
        {description && (
          <span className="text-[11px] leading-tight text-white/60">
            {loading ? "请求中…" : description}
          </span>
        )}
      </span>
    </button>
  );
}

interface ConnectedAccountRowProps {
  provider: AccountProvider | "afdian";
  name: string;
  detail?: string;
  avatar?: string;
  onLogout: () => void;
  loggingOut?: boolean;
}

function ConnectedAccountRow({
  provider,
  name,
  detail,
  avatar,
  onLogout,
  loggingOut = false,
}: ConnectedAccountRowProps) {
  const [avatarError, setAvatarError] = useState(false);
  const initials =
    provider === "github" ? "GH" : provider === "afdian" ? "AF" : "AB";
  const showAvatar = Boolean(avatar && !avatarError);

  return (
    <div className="corner-rounded flex items-center gap-2 rounded-[14px] border border-white/10 bg-nav-item p-1.5 px-2.5 py-2">
      {showAvatar ? (
        <img
          src={avatar}
          alt=""
          onError={() => setAvatarError(true)}
          className="h-8 w-8 rounded-full object-cover border border-white/10"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-semibold text-white/80">
          {initials}
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold">
          {name} ({formatProvider(provider)})
        </span>
        <span className="text-[11px] text-white/60">
          {detail || formatProvider(provider)}
        </span>
      </div>
      <button
        type="button"
        className="flex items-center gap-1 rounded-xs px-1 py-1 text-size-small text-white/80 hover:text-red-700 dark:hover:text-red-300 transition-colors"
        onClick={onLogout}
        disabled={loggingOut}
      >
        {loggingOut ? <Spinner size="1" /> : <SignOutIcon size={14} />}
        退出
      </button>
    </div>
  );
}

interface GithubDeviceCardProps {
  session: GithubDeviceSession;
  status?: string;
}

function GithubDeviceCard({ session, status }: GithubDeviceCardProps) {
  const deepLink =
    session.verificationUriComplete || session.verificationUri || "";

  const handleOpen = () => {
    if (deepLink) {
      openUrl(deepLink);
    }
  };

  return (
    <div className="rounded-xl corner-rounded border border-white/10 bg-nav-item p-3 space-y-1 select-none">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[15px] font-semibold m-0">等待 GitHub 授权中</p>
        {status === "Login Successful" ? (
          <div className="w-4 h-4 flex items-center justify-center">
            <CheckCircleIcon size={20} className="text-green-500 shrink-0" />
          </div>
        ) : (
          <Spinner />
        )}
      </div>
      <p className="text-[20px] font-mono-sarasa tracking-wide select-all leading-5">
        {session.userCode}
      </p>
      <p className="text-size-small text-white/60">
        在浏览器中打开页面并输入上方代码以登录
      </p>
      <button
        type="button"
        className="text-size-medium font-mono-sarasa rounded-lg -mx-2 -my-1 px-2 py-1.5 flex gap-0.5 items-center text-blue-500/75 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        onClick={handleOpen}
      >
        {session.verificationUri}
        <ArrowUpRightIcon size={16} />
      </button>
      {status && <p className="text-xs text-white/70 pt-1">{status}</p>}
    </div>
  );
}

function formatProvider(provider?: AccountProvider | "afdian") {
  if (provider === "astrobox") return "AstroBox";
  if (provider === "github") return "GitHub";
  if (provider === "afdian") return "爱发电";
  return undefined;
}

interface AccountInfoProps {
  account: DisplayAccount;
}

function AccountInfo({ account }: AccountInfoProps) {
  const name = account.name || "未登录";
  const plan = account.plan?.trim() || "";
  const email = account.email?.trim() || "";

  return (
    <div className="flex flex-col px-3 pt-2.5 pb-6 h-full justify-center z-50">
      <p className="truncate text-[15px] font-semibold leading-5">{name}</p>
      <p className="truncate text-[15px] font-semibold leading-5 text-white/50">{email}</p>
      <p className="truncate font-mono-sarasa text-xs font-medium text-white/60 mt-2">{plan}</p>
    </div>
  );
}

interface NavSectionProps extends NavSectionConfig {
  accountState: AccountState;
  navItemPreferences: NavItemPreferences;
  pathname: string;
  onNavigate: (path: string) => void;
}

function NavSection({
  title,
  items,
  accountState,
  navItemPreferences,
  pathname,
  onNavigate,
}: NavSectionProps) {
  const hasAnalysisAccess = canAccessAnalysisByPlan(accountState.astrobox?.plan);
  const roles = accountState.astrobox?.roles ?? [];
  const visibleItems = sortNavItems(
    items,
    navItemPreferences.itemOrder,
  ).filter(
    (item) =>
      hasRequiredNavRole(item, roles) &&
      (item.alwaysVisible || isNavItemVisible(item.id, navItemPreferences)),
  );

  if (visibleItems.length === 0) return null;

  return (
    <section className="flex flex-col gap-0">
      {title && (
        <div className="px-3 pb-1 pt-4">
          <p className="text-[12px] font-normal leading-4 text-white/45 select-none">
            {title}
          </p>
        </div>
      )}
      {visibleItems.map(
        ({
          id,
          path,
          alwaysVisible: _alwaysVisible,
          requireRoles: _requireRoles,
          ...item
        }) => {
          const disabled = path === "/analysis" && !hasAnalysisAccess;
          return (
            <NavItem
              key={id}
              {...item}
              disabled={disabled}
              selected={matchesNavPath(path, pathname)}
              onClick={disabled ? undefined : () => onNavigate(path)}
            />
          );
        },
      )}
    </section>
  );
}

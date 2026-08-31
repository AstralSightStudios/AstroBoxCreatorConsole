import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  CoinIcon,
  GithubLogoIcon,
  SignOutIcon,
  UploadIcon,
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
  NAV_SECTIONS,
  type NavSectionConfig,
  matchesNavPath,
} from "./nav-config";
import { useNavVisibility } from "./nav-visibility-context";
import { AstroBoxLogo } from "~/components/svgs";
import InboxBell from "~/components/inbox/InboxBell";
import InboxDrawer from "~/components/inbox/InboxDrawer";
import { useInboxPolling } from "~/logic/inbox/use-inbox";
import TitlebarEffect from "~/components/TitlebarEffect";

import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertDialog, Button, Dialog, Popover, Spinner } from "@radix-ui/themes";
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
const NAV_HEADER_EXPANDED_HEIGHT = "clamp(218px, 30dvh, 342px)";
const NAV_HEADER_MOBILE_EXPANDED_HEIGHT = "clamp(162px, 30dvh, 286px)";

interface NavScrollState {
  scrollTop: number;
  canScrollUp: boolean;
  canScrollDown: boolean;
}

function getNavGridTemplateRows(
  scrollTop: number,
  expandedHeight: string,
) {
  const collapseOffset = Math.max(
    0,
    scrollTop - NAV_HEADER_COLLAPSE_THRESHOLD,
  );
  const headerHeight = `clamp(100px, calc(${expandedHeight} - ${collapseOffset}px), ${expandedHeight})`;

  return `${headerHeight} minmax(0, 1fr)`;
}

export default function Nav() {
  const accountState = useAccountState();
  const account = getDisplayAccount(accountState);
  const location = useLocation();
  const navigate = useNavigate();
  const [navScrollState, setNavScrollState] = useState<NavScrollState>({
    scrollTop: 0,
    canScrollUp: false,
    canScrollDown: true,
  });
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

  const handleNavigate = (path: string) => {
    const drawerOpen = !isDesktop && !isCollapsed;
    const isNewRoute = location.pathname !== path;

    if (isNewRoute) {
      // While the mobile drawer is open we pushed a synthetic history entry.
      // Replace it with the destination so the back button doesn't first have
      // to re-close an already-closed drawer.
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
  };

  if (isDesktop) {
    return (
      <DesktopNav
        {...sharedProps}
        isCollapsed={isCollapsed}
        onToggleNav={toggleNav}
      />
    );
  }

  return (
    <AnimatePresence>
      {!isCollapsed && (
        <MobileNav
          key="mobile-nav"
          {...sharedProps}
          onToggleNav={collapseNav}
          onDismiss={collapseNav}
        />
      )}
    </AnimatePresence>
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
  hideFunctionButton?: boolean;
}

function NavContent({
  account,
  accountState,
  onToggleNav,
  pathname,
  onNavigate,
  onNavScroll,
  navScrollState,
  hideFunctionButton,
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
        <NavHeader
          account={account}
          accountState={accountState}
          onToggleNav={onToggleNav}
          hideFunctionButton={hideFunctionButton}
        />
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

        <div className="absolute inset-x-0 bottom-0 z-50 min-w-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <NavItem
            key="publish"
            icon={UploadIcon}
            label="发布新资源"
            selected={isNavItemSelected(pathname, "/publish")}
            onClick={() => onNavigate("/publish")}
          />
        </div>
      </div>
    </>
  );
}

interface DesktopNavProps extends NavContentProps {
  isCollapsed: boolean;
  onToggleNav: () => void;
}

function DesktopNav({ isCollapsed, ...contentProps }: DesktopNavProps) {
  const { isDesktop } = useNavVisibility();
  return (
    <aside
      className={`shrink-0 transition-[width] duration-300 ease-out ${isCollapsed ? "w-0" : "w-64"}`}
      aria-hidden={isCollapsed}
    >
      {!isCollapsed && (
        <nav
          className="app-desktop-nav relative z-10 grid h-screen w-64 grid-cols-1 gap-2 overflow-hidden bg-transparent p-3 pb-0 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))]"
          style={{
            height: "100dvh",
            gridTemplateRows: getNavGridTemplateRows(
              contentProps.navScrollState.scrollTop,
              NAV_HEADER_EXPANDED_HEIGHT,
            ),
          }}
        >
          <TitlebarEffect className="titlebar-effect-sidebar" />
          <NavContent {...contentProps} />
        </nav>
      )}
    </aside>
  );
}

interface MobileNavProps extends NavContentProps {
  onDismiss: () => void;
  onToggleNav: () => void;
}

function MobileNav({ onDismiss, ...contentProps }: MobileNavProps) {
  return (
    <motion.div
      className="fixed inset-0 z-40 flex"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onDismiss}
    >
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-lg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
      <motion.nav
        className="relative z-10 grid h-full w-[75vw] grid-cols-1 gap-2 overflow-hidden bg-transparent p-3 pb-0 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
        style={{
          gridTemplateRows: getNavGridTemplateRows(
            contentProps.navScrollState.scrollTop,
            NAV_HEADER_MOBILE_EXPANDED_HEIGHT,
          ),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <NavContent hideFunctionButton={true} {...contentProps} />
      </motion.nav>
    </motion.div>
  );
}

interface NavHeaderProps {
  account: DisplayAccount;
  accountState: AccountState;
  onToggleNav: () => void;
  hideFunctionButton?: boolean;
}

function NavHeader({
  account,
  accountState,
  onToggleNav,
  hideFunctionButton,
}: NavHeaderProps) {
  const queryClient = useQueryClient();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showGithubLogoutConfirm, setShowGithubLogoutConfirm] = useState(false);
  const [showAstroLogoutConfirm, setShowAstroLogoutConfirm] = useState(false);
  const [showAfdianLogoutConfirm, setShowAfdianLogoutConfirm] = useState(false);
  const [afdianLoggingOut, setAfdianLoggingOut] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const githubLoginState = useGithubLoginState();
  const navigate = useNavigate();
  const afdianSessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: isAfdianNativeAvailable(),
    staleTime: 30_000,
    retry: false,
  });

  const handleAstroLogin = () => {
    setIsMenuOpen(false);
    navigate("/login");
  };

  const handleAfdianLogin = () => {
    setIsMenuOpen(false);
    navigate("/settings");
  };

  const handleGithubLogin = async () => {
    setIsMenuOpen(true);
    await startGithubLogin();
  };

  const handleAstroLogout = () => {
    if (!accountState.astrobox) return;
    setShowAstroLogoutConfirm(true);
  };

  const confirmAstroLogout = () => {
    logoutAccount("astrobox");
    window.location.reload();
  };

  const handleGithubLogout = () => {
    if (!accountState.github) return;
    setShowGithubLogoutConfirm(true);
  };

  const confirmGithubLogout = () => {
    cancelGithubLogin();
    logoutAccount("github");
    window.location.reload();
  };

  const handleAfdianLogout = () => {
    if (!afdianSessionQuery.data?.connected) return;
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
  const isGithubBusy = githubLoginState.status === "requesting" || githubLoginState.status === "waiting";

  return (
    <>
      <Popover.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <div
          className={`flex flex-row items-center self-stretch px-1 py-1 ${hideFunctionButton ? "justify-end" : "justify-between"}`}
        >
          {!hideFunctionButton && <FunctionButton onClick={onToggleNav} />}
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
          onAstroLogin={handleAstroLogin}
          onGithubLogin={handleGithubLogin}
          onAfdianLogin={handleAfdianLogin}
          onAstroLogout={handleAstroLogout}
          onGithubLogout={handleGithubLogout}
          afdianSession={afdianSessionQuery.data}
          afdianLoggingOut={afdianLoggingOut}
          onAfdianLogout={handleAfdianLogout}
        />
      </Popover.Root>

      <InboxDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} />

      <Dialog.Root open={showGithubLogoutConfirm} onOpenChange={setShowGithubLogoutConfirm}>
        <Dialog.Content className="max-w-[520px]">
          <Dialog.Title>退出 GitHub 账号</Dialog.Title>
          <Dialog.Description size="2" className="mt-3 whitespace-pre-line text-[14px]">
            确认退出 GitHub 账号？退出后需要重新登录。
          </Dialog.Description>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="soft" onClick={() => setShowGithubLogoutConfirm(false)}>
              取消
            </Button>
            <Button variant="solid" onClick={confirmGithubLogout}>
              退出
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showAstroLogoutConfirm} onOpenChange={setShowAstroLogoutConfirm}>
        <Dialog.Content className="max-w-[520px]">
          <Dialog.Title>退出 AstroBox 账号</Dialog.Title>
          <Dialog.Description size="2" className="mt-3 whitespace-pre-line text-[14px]">
            确认退出 AstroBox 账号？退出后需要重新登录。
          </Dialog.Description>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="soft" onClick={() => setShowAstroLogoutConfirm(false)}>
              取消
            </Button>
            <Button variant="solid" onClick={confirmAstroLogout}>
              退出
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showAfdianLogoutConfirm} onOpenChange={setShowAfdianLogoutConfirm}>
        <Dialog.Content className="max-w-[520px]">
          <Dialog.Title>退出爱发电账号</Dialog.Title>
          <Dialog.Description size="2" className="mt-3 whitespace-pre-line text-[14px]">
            确认退出爱发电账号？退出后需要重新登录。
          </Dialog.Description>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="soft"
              onClick={() => setShowAfdianLogoutConfirm(false)}
              disabled={afdianLoggingOut}
            >
              取消
            </Button>
            <Button
              variant="solid"
              onClick={() => void confirmAfdianLogout()}
              disabled={afdianLoggingOut}
            >
              {afdianLoggingOut ? <Spinner size="1" /> : null}
              退出
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
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
  const showDeviceCard = githubLoginState.session && githubLoginState.status !== "idle";

  return (
    <Popover.Content
      align="end"
      side="bottom"
      sideOffset={8}
      collisionPadding={12}
      // Radix handles collision/flip and exposes the available space as CSS
      // vars, so the menu can never overflow the viewport regardless of width.
      style={{
        padding: 0,
        background: "transparent",
        boxShadow: "none",
        border: "none",
        borderRadius: 24,
        width: "min(400px, var(--radix-popover-content-available-width))",
        maxHeight: "var(--radix-popover-content-available-height)",
        overflow: "visible",
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
      className="flex items-center gap-2 corner-rounded px-2.5 py-2 rounded-[14px] corner-rounded border border-white/10 bg-nav-item text-left transition hover:border-white/20 hover:bg-nav-item-hover text-white"
      onClick={onClick}
      disabled={loading}
    >
      <span className="flex h-8 w-8 items-center justify-center">{icon}</span>
      <span className="flex flex-col text-sm">
        <span className="font-semibold text-sm">{label}</span>
        <span className="text-[11px] text-white/60">
          {description && (
            <span className="text-[11px] text-white/60 leading-tight">
              {loading ? "Requesting..." : description}
            </span>
          )}
        </span>
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
    <div className="flex items-center gap-2 corner-rounded px-2.5 py-2 rounded-[14px] corner-rounded border border-white/10 bg-nav-item p-1.5">
      {showAvatar ? (
        <img
          src={avatar}
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
  pathname: string;
  onNavigate: (path: string) => void;
}

function NavSection({
  title,
  items,
  accountState,
  pathname,
  onNavigate,
}: NavSectionProps) {
  const hasAnalysisAccess = canAccessAnalysisByPlan(accountState.astrobox?.plan);
  const roles = accountState.astrobox?.roles ?? [];
  const visibleItems = items.filter((item) => {
    if (!item.requireRoles?.length) return true;
    return item.requireRoles.some((role) => roles.includes(role));
  });

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
      {visibleItems.map(({ id, path, requireRoles: _requireRoles, ...item }) => {
        const disabled = path === "/analysis" && !hasAnalysisAccess;
        return (
        <NavItem
          key={id}
          {...item}
          disabled={disabled}
          selected={isNavItemSelected(pathname, path)}
          onClick={disabled ? undefined : () => onNavigate(path)}
        />
      );
      })}
    </section>
  );
}

function isNavItemSelected(currentPath: string, targetPath: string) {
  return matchesNavPath(targetPath, currentPath);
}

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Drawer } from "vaul";
import {
  ArrowLeftIcon,
  UserCircleDashedIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import NavItem from "~/components/nav/navitem";
import FunctionButton from "~/components/nav/function-button";
import {
  getDisplayAccount,
  useAccountState,
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
import InboxBell from "~/components/inbox/InboxBell";
import { useInboxDrawer } from "~/components/inbox/drawer-context";
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

import { toast } from "sonner";
import BlurEffect from "react-progressive-blur";
import { canAccessAnalysisByPlan } from "~/logic/account/permissions";
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
      className={`relative shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${isCollapsed ? "w-0" : "w-64"}`}
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
  const navigate = useNavigate();
  const { openInbox } = useInboxDrawer();
  const hasAccount = account.hasAstrobox || account.hasGithub;

  return (
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
        <InboxBell
          onClick={() => {
            if (!accountState.astrobox?.token) {
              toast.error("请先登录 AstroBox 账号");
              return;
            }
            openInbox();
          }}
        />
        <button
          type="button"
          aria-label="账号设置"
          title="账号设置"
          className="inline-flex items-center justify-center rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          onClick={() => {
            if (onNavigate) {
              onNavigate("/settings#accounts");
            } else {
              navigate("/settings#accounts");
            }
          }}
        >
          <AccountAvatar account={account} isActive={hasAccount} />
        </button>
      </div>
    </div>
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

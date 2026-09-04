import { Link, useLocation } from "react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import FunctionButton from "~/components/nav/function-button";
import {
  useHeaderActions,
  useHeaderActionsFit,
  useHeaderBreadcrumb,
  useHeaderLargeTitle,
  useHeaderLargeTitleProgress,
  useSetHeaderActionsFit,
} from "~/layout/header-actions";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { CreatorConsoleLogoIcon } from "./svgs";
import TitlebarEffect from "./TitlebarEffect";

const PAGE_NAME_MAP: Record<string, string> = {
  "": "概览",
  login: "登录",
  settings: "设置",
  analysis: "数据分析",
  "afdian-income": "爱发电收入",
  profile: "个人主页管理",
  encrypt: "资源加解密与激活",
  manage: "已发布资源",
  publish: "审核列表",
  "publish/new": "发布新资源",
  "publish/edit": "编辑资源",
  "manage/edit": "编辑资源",
  admin: "管理后台",
  "admin/accounts": "账号管理",
  "admin/orders": "订单与权益管理",
  "admin/reports": "举报管理",
  "admin/inbox": "信箱管理",
  "admin/account-deletion": "账号注销工单",
  resreview: "PR审核",
  "resreview/detail": "详情",
  interactions: "互动管理",
  explorepage: "探索页管理",
};

export default function Header() {
  const isMacOS =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("macos");
  const location = useLocation();
  const { isCollapsed, isDesktop, toggleNav } = useNavVisibility();
  const headerActions = useHeaderActions();
  const headerActionsFit = useHeaderActionsFit();
  const breadcrumbOverride = useHeaderBreadcrumb();
  const largeTitle = useHeaderLargeTitle();
  const largeTitleProgress = useHeaderLargeTitleProgress();
  const setHeaderActionsFit = useSetHeaderActionsFit();
  const pathname = location.pathname;
  const isMobile = !isDesktop;
  const isHeaderAvailable = !isMobile || isCollapsed;
  const breadcrumbOpacity = isHeaderAvailable
    ? largeTitle
      ? largeTitleProgress
      : 1
    : 0;
  const isBreadcrumbInteractive = breadcrumbOpacity >= 0.95;

  const headerRef = useRef<HTMLElement>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const actionsMeasureRef = useRef<HTMLDivElement>(null);

  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);

  const breadcrumbKeys: string[] = [];

  if (segments.length === 0) {
    breadcrumbKeys.push("");
  } else {
    let acc = "";
    segments.forEach((seg, index) => {
      acc = index === 0 ? seg : `${acc}/${seg}`;
      breadcrumbKeys.push(acc);
    });
  }

  const measure = useCallback(() => {
    if (!headerActions) {
      setHeaderActionsFit(false);
      return;
    }
    const actionsEl = actionsMeasureRef.current;
    if (!actionsEl) return;
    const actionsWidth = actionsEl.getBoundingClientRect().width;

    const headerEl = headerRef.current;
    const breadcrumbEl = breadcrumbRef.current;
    if (!headerEl || !breadcrumbEl) return;
    const headerRight = headerEl.getBoundingClientRect().right;
    const breadcrumbRight = breadcrumbEl.getBoundingClientRect().right;
    const free = headerRight - breadcrumbRight;
    const fits = free - 40 >= actionsWidth;
    setHeaderActionsFit(fits);
  }, [headerActions, setHeaderActionsFit]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const headerEl = headerRef.current;
    const breadcrumbEl = breadcrumbRef.current;
    const actionsEl = actionsMeasureRef.current;
    if (!headerEl || !breadcrumbEl || !actionsEl) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(headerEl);
    ro.observe(breadcrumbEl);
    ro.observe(actionsEl);

    return () => ro.disconnect();
  }, [measure]);

  return (
    <header
      ref={headerRef}
      className={`app-header ${isMacOS ? "tauri-drag-region" : ""} relative flex min-w-0 flex-row flex-nowrap gap-2 overflow-hidden ${isMobile ? "p-1.5" : "py-2 px-1"} items-center transition-all`}
      data-tauri-drag-region={isMacOS ? true : undefined}
    >
      <TitlebarEffect />
      {isMobile ? (
        <FunctionButton
          className={`app-header-function-button ${isCollapsed ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onClick={toggleNav}
          aria-label="展开导航"
          title="展开导航"
        />
      ) : null}
      {isMobile ? (
        <div
          className={`creator-console-mobile-logo shrink-0 transition-all ${isCollapsed ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <CreatorConsoleLogoIcon />
        </div>
      ) : null}

      <div
        ref={breadcrumbRef}
        aria-hidden={!isBreadcrumbInteractive}
        style={{
          opacity: breadcrumbOpacity,
          transform: `translateY(${(1 - breadcrumbOpacity) * 4}px)`,
        }}
        className={`app-header-breadcrumb flex min-w-0 flex-row items-center gap-1 overflow-hidden whitespace-nowrap pl-1 ${isBreadcrumbInteractive ? "" : "pointer-events-none"}`}
      >
        {(
          breadcrumbOverride
            ? [...breadcrumbKeys, `${breadcrumbKeys[breadcrumbKeys.length - 1]}/sub`]
            : breadcrumbKeys
        ).map((key, index) => {
          const isLast =
            breadcrumbOverride
              ? index === breadcrumbKeys.length
              : index === breadcrumbKeys.length - 1;
          const label =
            largeTitle && isLast
              ? largeTitle
              : breadcrumbOverride && isLast
              ? breadcrumbOverride
              : PAGE_NAME_MAP[key] ?? key;
          const to =
            key === ""
              ? "/"
              : `/${breadcrumbOverride && isLast ? breadcrumbKeys[breadcrumbKeys.length - 1] : key}`;

          return (
            <div
              key={key}
              className="flex min-w-0 flex-row items-center gap-1"
            >
              {(isMobile || index > 0) && <Slash />}
              <Link
                to={to}
                tabIndex={isBreadcrumbInteractive ? undefined : -1}
                className={`min-w-0 truncate font-[520] text-size-large ${isLast ? "" : "text-header-text-is-not-last"} rounded-lg px-1.5 py-0.5 cursor-pointer transition-all hover:bg-neutral-800 active:scale-95 active:opacity-90`}
              >
                {label}
              </Link>
            </div>
          );
        })}
      </div>
      {headerActions ? (
        <>
          <div
            ref={actionsMeasureRef}
            className="pointer-events-none absolute left-0 top-0 opacity-0 h-0 overflow-hidden"
            aria-hidden="true"
          >
            <div className="flex flex-row items-center gap-2">
              {headerActions}
            </div>
          </div>
          {headerActionsFit && (
            <div className="ml-auto flex shrink-0 flex-row items-center gap-2">
              {headerActions}
            </div>
          )}
        </>
      ) : null}
    </header>
  );
}

function Slash() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="8"
      height="12"
      viewBox="0 0 8 12"
      fill="none"
    >
      <path
        d="M7.9992 0L1.9008 11.916H0L6.0984 0H7.9992Z"
        fill="white"
        fillOpacity="0.3"
      />
    </svg>
  );
}

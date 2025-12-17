import { Link, useLocation } from "react-router";
import FunctionButton from "~/components/nav/function-button";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { CreatorConsoleLogoIcon } from "./svgs";

const PAGE_NAME_MAP: Record<string, string> = {
  "": "概览",
  settings: "设置",
  analysis: "数据分析",
  profile: "个人主页管理",
  encrypt: "资源加解密与激活",
  manage: "资源管理",
  publish: "资源发布",
  "publish/new": "发布新资源",
  "publish/edit": "编辑资源",
  "manage/edit": "编辑资源",
};

export default function Header() {
  const location = useLocation();
  const { isCollapsed, isDesktop, toggleNav } = useNavVisibility();
  const pathname = location.pathname;
  const isMobile = !isDesktop;

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

  return (
    <header
      className={`flex flex-row flex-wrap gap-2 ${isMobile ? "p-1.5" : "py-2 px-1"} items-center transition-all`}
    >
      {isMobile ? (
        <FunctionButton
          onClick={toggleNav}
          aria-label="展开导航"
          title="展开导航"
        />
      ) : null}
      {isMobile ? (
        <div
          className={`transition-all ${!isMobile || isCollapsed ? "blur-none opacity-100" : "blur-sm opacity-50"}`}
        >
          <CreatorConsoleLogoIcon />
        </div>
      ) : null}

      <div className="flex flex-row items-center gap-1 pl-1">
        {breadcrumbKeys.map((key, index) => {
          const label = PAGE_NAME_MAP[key] ?? key;
          const isLast = index === breadcrumbKeys.length - 1;
          const to = key === "" ? "/" : `/${key}`;

          return (
            <div
              key={key}
              className={`flex flex-row items-center gap-1 transition-all ${!isMobile || isCollapsed ? "blur-none opacity-100" : "blur-sm opacity-50"}`}
            >
              {(isMobile || index > 0) && <Slash />}
              <Link
                to={to}
                className={`font-[520] text-size-large ${isLast ? "" : "text-header-text-is-not-last"} rounded-lg px-1.5 py-0.5 cursor-pointer transition-all hover:bg-neutral-800 active:scale-95 active:opacity-90`}
              >
                {label}
              </Link>
            </div>
          );
        })}
      </div>
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

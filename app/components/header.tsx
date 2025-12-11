import { Link, useLocation } from "react-router";
import FunctionButton from "~/components/nav/function-button";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { CreatorConsoleLogo, CreatorConsoleLogoIcon } from "./svgs";

const PAGE_NAME_MAP: Record<string, string> = {
    "": "概览",
    settings: "设置",
    analysis: "数据分析",
    profile: "个人主页管理",
    encrypt: "资源加解密与激活",
    manage: "资源管理",
    publish: "资源发布",
    "publish/new": "发布新资源",
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
            className={`flex flex-row flex-wrap gap-2.5 px-${isCollapsed ? "2" : "3.5"} py-2 items-center transition-all`}
        >
            {isCollapsed && (
                <FunctionButton
                    onClick={toggleNav}
                    aria-label="展开导航"
                    title="展开导航"
                />
            )}
            {isMobile ? <CreatorConsoleLogoIcon /> : <CreatorConsoleLogo />}

            {breadcrumbKeys.map((key, index) => {
                const label = PAGE_NAME_MAP[key] ?? key;
                const isLast = index === breadcrumbKeys.length - 1;
                const to = key === "" ? "/" : `/${key}`;

                return (
                    <div key={key} className="flex flex-row items-center gap-2">
                        <Slash />
                        <Link
                            to={to}
                            className={`font-[520] text-size-large ${isLast ? "" : "text-header-text-is-not-last"} rounded px-1 py-0.5 cursor-pointer transition-colors hover:bg-neutral-800`}
                        >
                            {label}
                        </Link>
                    </div>
                );
            })}
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

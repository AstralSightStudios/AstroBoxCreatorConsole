import { UserCircleDashedIcon } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import NavItem from "~/components/nav/navitem";
import FunctionButton from "~/components/nav/function-button";
import {
    ACCOUNT_INFO,
    clearAccount,
    login,
    type AccountInfo as AccountInfoData,
} from "~/logic/account/astrobox";
import {
    NAV_SECTIONS,
    type NavSectionConfig,
    matchesNavPath,
} from "./nav-config";
import { useNavVisibility } from "./nav-visibility-context";

export default function Nav() {
    const account = ACCOUNT_INFO;
    const location = useLocation();
    const navigate = useNavigate();
    const { isCollapsed, toggleNav } = useNavVisibility();
    const handleNavigate = (path: string) => {
        if (location.pathname === path) {
            return;
        }
        navigate(path);
    };

    return (
        <aside
            className={`shrink-0 transition-[width] duration-300 ease-out ${isCollapsed ? "w-0" : "w-[315px]"}`}
            aria-hidden={isCollapsed}
        >
            {!isCollapsed && (
                <nav className="flex h-screen w-[315px] flex-col gap-1.5 overflow-hidden bg-nav p-2">
                    <NavHeader account={account} onToggleNav={toggleNav} />
                    <AccountInfo account={account} />
                    <div className="flex-1 min-h-0 overflow-y-auto nav-scroll-area">
                        <div className="flex flex-col gap-2.5 pb-2">
                            {NAV_SECTIONS.map((section) => (
                                <NavSection
                                    key={section.id}
                                    {...section}
                                    pathname={location.pathname}
                                    onNavigate={handleNavigate}
                                />
                            ))}
                        </div>
                    </div>
                </nav>
            )}
        </aside>
    );
}

interface NavHeaderProps {
    account?: AccountInfoData;
    onToggleNav: () => void;
}

function NavHeader({ account, onToggleNav }: NavHeaderProps) {
    const avatar = account?.avatar?.trim();
    const handleAvatarClick = () => {
        if (!account) {
            login();
            return;
        }

        const confirmed = window.confirm("是否退出登录？");
        if (confirmed) {
            clearAccount();
            window.location.reload();
        }
    };

    return (
        <div className="p-1.5 flex flex-row justify-between items-center self-stretch">
            <FunctionButton onClick={onToggleNav} />
            {avatar ? (
                <img
                    src={avatar}
                    className="w-7 h-7 rounded-full object-cover cursor-pointer"
                    onClick={handleAvatarClick}
                />
            ) : (
                <UserCircleDashedIcon
                    className="cursor-pointer"
                    size={28}
                    onClick={handleAvatarClick}
                />
            )}
        </div>
    );
}

interface AccountInfoProps {
    account?: AccountInfoData;
}

function AccountInfo({ account }: AccountInfoProps) {
    const name = account?.name || "未登录";
    const plan = account?.plan?.trim();
    const email = account?.email?.trim();
    const meta = [plan, email].filter(Boolean).join(" · ");

    return (
        <div className="flex flex-col px-3 py-3.5">
            <p className="text-[17px] font-semibold">{name}</p>
            {meta && (
                <p className="font-mono text-[13px] font-medium opacity-75">
                    {meta}
                </p>
            )}
        </div>
    );
}

interface NavSectionProps extends NavSectionConfig {
    pathname: string;
    onNavigate: (path: string) => void;
}

function NavSection({ title, items, pathname, onNavigate }: NavSectionProps) {
    return (
        <section className="flex flex-col gap-1.5">
            {title && (
                <div className="px-3 py-3 pb-0">
                    <p className="text-nav-item-title text-size-small font-[450] select-none">
                        {title}
                    </p>
                </div>
            )}
            {items.map(({ id, path, ...item }) => (
                <NavItem
                    key={id}
                    {...item}
                    selected={isNavItemSelected(pathname, path)}
                    onClick={() => onNavigate(path)}
                />
            ))}
        </section>
    );
}

function isNavItemSelected(currentPath: string, targetPath: string) {
    return matchesNavPath(targetPath, currentPath);
}

import type { Icon } from "@phosphor-icons/react";
import { DotsNineIcon, UserCircleDashedIcon } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import NavItem from "~/components/nav/navitem";
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

export default function Nav() {
    const account = ACCOUNT_INFO;
    const location = useLocation();
    const navigate = useNavigate();
    const handleNavigate = (path: string) => {
        if (location.pathname === path) {
            return;
        }
        navigate(path);
    };

    return (
        <nav className="h-screen w-[315px] p-2 gap-1.5 bg-nav">
            <NavHeader account={account} />
            <AccountInfo account={account} />
            <div className="flex flex-col gap-2.5">
                {NAV_SECTIONS.map((section) => (
                    <NavSection
                        key={section.id}
                        {...section}
                        pathname={location.pathname}
                        onNavigate={handleNavigate}
                    />
                ))}
            </div>
        </nav>
    );
}

interface NavHeaderProps {
    account?: AccountInfoData;
}

function NavHeader({ account }: NavHeaderProps) {
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
            <IconButton icon={DotsNineIcon} />
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

interface IconButtonProps {
    icon: Icon;
}

function IconButton({ icon: IconComponent }: IconButtonProps) {
    return (
        <button
            type="button"
            className="flex gap-2.5 rounded-xl corner-rounded justify-center items-center w-[30px] h-[30px] hover:bg-btn-hover active:scale-95 active:opacity-75 transition-all duration-150 ease-in-out"
        >
            <IconComponent
                className="fill-icon-primary"
                size={20}
                weight="bold"
            />
        </button>
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

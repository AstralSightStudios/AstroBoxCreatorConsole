import type { Icon } from "@phosphor-icons/react";
import {
    BoxArrowUpIcon,
    ChartBarIcon,
    ChartPieSliceIcon,
    DotsNineIcon,
    FingerprintSimpleIcon,
    GearFineIcon,
    IdentificationBadgeIcon,
    ListStarIcon,
    UserCircleDashedIcon,
} from "@phosphor-icons/react";
import NavItem, { type NavItemProps } from "~/components/nav/navitem";
import {
    ACCOUNT_INFO,
    clearAccount,
    login,
    type AccountInfo as AccountInfoData,
} from "~/logic/account/astrobox";

type NavLinkConfig = NavItemProps & { id: string };

interface NavSectionConfig {
    id: string;
    title?: string;
    items: NavLinkConfig[];
}

const NAV_SECTIONS: NavSectionConfig[] = [
    {
        id: "dashboard",
        items: [
            {
                id: "overview",
                icon: ChartBarIcon,
                label: "概览",
                selected: false,
            },
            {
                id: "analysis",
                icon: ChartPieSliceIcon,
                label: "数据分析",
                isPlus: true,
                selected: false,
            },
        ],
    },
    {
        id: "resource",
        title: "资源",
        items: [
            {
                id: "resource-publish",
                icon: BoxArrowUpIcon,
                label: "资源发布",
                selected: false,
            },
            {
                id: "resource-manage",
                icon: ListStarIcon,
                label: "资源管理",
                selected: false,
            },
            {
                id: "resource-encrypt",
                icon: FingerprintSimpleIcon,
                label: "资源加解密与激活",
                selected: false,
            },
        ],
    },
    {
        id: "management",
        title: "管理",
        items: [
            {
                id: "profile",
                icon: IdentificationBadgeIcon,
                label: "个人主页管理",
                selected: false,
            },
            {
                id: "settings",
                icon: GearFineIcon,
                label: "设置",
                selected: false,
            },
        ],
    },
];

export default function Nav() {
    const account = ACCOUNT_INFO;

    return (
        <nav className="h-screen w-[315px] p-1.5 gap-1.5 bg-nav">
            <div className="p-2">
                <NavHeader account={account} />
                <AccountInfo account={account} />
                <div className="flex flex-col gap-2.5">
                    {NAV_SECTIONS.map((section) => (
                        <NavSection key={section.id} {...section} />
                    ))}
                </div>
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
        <div className="p-2 flex flex-row justify-between items-center self-stretch">
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
            className="flex gap-2.5 rounded-sm justify-center items-center w-[30px] h-[30px] hover:bg-btn-hover"
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

function NavSection({ title, items }: NavSectionConfig) {
    return (
        <section className="flex flex-col gap-1.5">
            {title && (
                <div className="px-2 py-3 pb-0">
                    <p className="text-nav-item-title font-[450] select-none">
                        {title}
                    </p>
                </div>
            )}
            {items.map(({ id, ...item }) => (
                <NavItem key={id} {...item} />
            ))}
        </section>
    );
}

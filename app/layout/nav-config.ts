import type { Icon } from "@phosphor-icons/react";
import {
    BoxArrowUpIcon,
    ChartBarIcon,
    ChartPieSliceIcon,
    FingerprintSimpleIcon,
    GearFineIcon,
    IdentificationBadgeIcon,
    ListStarIcon,
} from "@phosphor-icons/react";
import type { NavItemProps } from "~/components/nav/navitem";

export type NavLinkConfig = {
    id: string;
    path: string;
    icon: Icon;
} & Omit<NavItemProps, "selected" | "onClick">;

export interface NavSectionConfig {
    id: string;
    title?: string;
    items: NavLinkConfig[];
}

export const NAV_SECTIONS: NavSectionConfig[] = [
    {
        id: "dashboard",
        items: [
            {
                id: "overview",
                icon: ChartBarIcon,
                label: "概览",
                path: "/",
            },
            {
                id: "analysis",
                icon: ChartPieSliceIcon,
                label: "数据分析",
                isPlus: true,
                path: "/analysis",
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
                path: "/publish",
            },
            {
                id: "resource-manage",
                icon: ListStarIcon,
                label: "资源管理",
                path: "/manage",
            },
            {
                id: "resource-encrypt",
                icon: FingerprintSimpleIcon,
                label: "资源加解密与激活",
                path: "/encrypt",
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
                path: "/profile",
            },
            {
                id: "settings",
                icon: GearFineIcon,
                label: "设置",
                path: "/settings",
            },
        ],
    },
];

export const NAV_ITEMS_IN_ORDER = NAV_SECTIONS.flatMap(
    (section) => section.items,
);

export function normalizePath(path?: string) {
    if (!path) {
        return "/";
    }

    const value = path.trim();
    if (!value || value === "/") {
        return "/";
    }

    const leading = value.startsWith("/") ? value : `/${value}`;
    const normalized = leading.replace(/\/+$/, "");
    return normalized || "/";
}

export function matchesNavPath(navPath: string, pathname: string) {
    const normalizedNav = normalizePath(navPath);
    const normalizedPath = normalizePath(pathname);
    if (normalizedNav === "/") {
        return normalizedPath === "/";
    }

    return (
        normalizedPath === normalizedNav ||
        normalizedPath.startsWith(`${normalizedNav}/`)
    );
}

export function findNavIndex(pathname: string) {
    const normalized = normalizePath(pathname);
    for (let index = 0; index < NAV_ITEMS_IN_ORDER.length; index += 1) {
        const navItem = NAV_ITEMS_IN_ORDER[index];
        if (matchesNavPath(navItem.path, normalized)) {
            return index;
        }
    }

    return null;
}

export function getSegments(pathname: string) {
    return normalizePath(pathname)
        .split("/")
        .filter((segment) => segment.length > 0);
}

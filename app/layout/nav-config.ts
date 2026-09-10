import type { Icon } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  BinocularsIcon,
  ChartBarIcon,
  ChartPieSliceIcon,
  ChatsCircleIcon,
  CompassRoseIcon,
  CurrencyCircleDollarIcon,
  EnvelopeSimpleIcon,
  FingerprintSimpleIcon,
  FlagIcon,
  GearFineIcon,
  GitPullRequestIcon,
  IdentificationBadgeIcon,
  ListMagnifyingGlassIcon,
  ReceiptIcon,
  RocketLaunchIcon,
  UploadIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

export interface NavLinkConfig {
  id: string;
  path: string;
  icon: Icon;
  label: string;
  isPlus?: boolean;
  alwaysVisible?: boolean;
  fixedPosition?: boolean;
  requireRoles?: string[];
}

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
      {
        id: "interactions",
        icon: ChatsCircleIcon,
        label: "互动管理",
        path: "/interactions",
      },
    ],
  },
  {
    id: "afdian",
    title: "爱发电",
    items: [
      {
        id: "afdian-income",
        icon: CurrencyCircleDollarIcon,
        label: "爱发电收入",
        path: "/afdian-income",
      },
      {
        id: "afdian-messages",
        icon: ChatsCircleIcon,
        label: "爱发电私信",
        path: "/afdian-messages",
      },
    ],
  },
  {
    id: "resource",
    title: "资源",
    items: [
      {
        id: "resource-manage",
        icon: ArchiveIcon,
        label: "已发布资源",
        path: "/manage",
      },
      {
        id: "resource-review-list",
        icon: ListMagnifyingGlassIcon,
        label: "审核列表",
        path: "/publish",
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
        id: "settings",
        icon: GearFineIcon,
        label: "设置",
        path: "/settings",
        alwaysVisible: true,
      },
    ],
  },
  {
    id: "internal",
    title: "内部工具",
    items: [
      {
        id: "resreview",
        icon: GitPullRequestIcon,
        label: "PR审核",
        path: "/resreview",
      },
      {
        id: "cloudcontrol",
        icon: BinocularsIcon,
        label: "云控与资源推流",
        path: "/cloudcontrol",
      },
      {
        id: "explorepage",
        icon: CompassRoseIcon,
        label: "探索页管理",
        path: "/explorepage",
      },
    ],
  },
  {
    id: "admin",
    title: "管理后台",
    items: [
      {
        id: "admin-accounts",
        icon: UsersThreeIcon,
        label: "账号管理",
        path: "/admin/accounts",
        requireRoles: ["admin", "moderator"],
      },
      {
        id: "admin-orders",
        icon: ReceiptIcon,
        label: "订单与权益",
        path: "/admin/orders",
        requireRoles: ["admin", "moderator"],
      },
      {
        id: "admin-reports",
        icon: FlagIcon,
        label: "举报管理",
        path: "/admin/reports",
        requireRoles: ["admin", "moderator"],
      },
      {
        id: "admin-inbox",
        icon: EnvelopeSimpleIcon,
        label: "信箱管理",
        path: "/admin/inbox",
        requireRoles: ["admin", "moderator"],
      },
      {
        id: "admin-account-deletion",
        icon: IdentificationBadgeIcon,
        label: "注销工单",
        path: "/admin/account-deletion",
        requireRoles: ["admin", "moderator"],
      },
      {
        id: "admin-hotupdate",
        icon: RocketLaunchIcon,
        label: "热更新管理",
        path: "/admin/hotupdate",
        requireRoles: ["admin"],
      },
    ],
  },
];

export const NAV_ITEMS_IN_ORDER = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

export const NAV_PRIMARY_ACTION: NavLinkConfig = {
  id: "publish-new-resource",
  path: "/new-resource",
  icon: UploadIcon,
  label: "发布新资源",
  fixedPosition: true,
};

export function hasRequiredNavRole(
  item: NavLinkConfig,
  roles: readonly string[],
) {
  if (!item.requireRoles?.length) return true;
  return item.requireRoles.some((role) => roles.includes(role));
}

export function sortNavItems<T extends { id: string }>(
  items: readonly T[],
  itemOrder: readonly string[],
): T[] {
  if (itemOrder.length === 0) return [...items];

  const orderIndexes = new Map(
    itemOrder.map((itemId, index) => [itemId, index]),
  );
  return [...items].sort((first, second) => {
    const firstIndex = orderIndexes.get(first.id) ?? Number.MAX_SAFE_INTEGER;
    const secondIndex = orderIndexes.get(second.id) ?? Number.MAX_SAFE_INTEGER;
    return firstIndex - secondIndex;
  });
}

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

export function findNavIndex(
  pathname: string,
  itemOrder: readonly string[] = [],
) {
  const normalized = normalizePath(pathname);
  const orderedItems = sortNavItems(NAV_ITEMS_IN_ORDER, itemOrder);
  for (let index = 0; index < orderedItems.length; index += 1) {
    const navItem = orderedItems[index];
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

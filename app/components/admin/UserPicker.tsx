import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Spinner } from "~/components/ScaleAwareThemes";
import { MagnifyingGlassIcon, UserIcon, UserPlusIcon, XIcon } from "@phosphor-icons/react";
import { AdminApi, type AdminUserSummary, type VipTier } from "~/api/astrobox/admin";
import { inputClass } from "~/components/admin/AdminPage";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

const ROLE_LABELS: Record<string, string> = {
    admin: "管理员",
    moderator: "版主",
    "pr-reviewer": "PR审核员",
};

const VIP_BADGE_COLOR: Record<VipTier, "gray" | "blue" | "purple" | "amber"> = {
    None: "gray",
    Pro: "blue",
    CreatorPlus: "purple",
    CreatorPro: "amber",
};

export function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function userSubtitle(user: AdminUserSummary) {
    const account = [user.username && `@${user.username}`, user.email]
        .filter(Boolean)
        .join(" · ");
    return account || user.userId;
}

function BanPill({ kind }: { kind: string }) {
    return (
        <Badge color="red" variant="soft">
            {kind === "platform" ? "平台封" : "社交封"}
        </Badge>
    );
}

/**
 * 收件人选择器：搜索 AstroBox 账号（userId / 昵称 / 用户名 / 邮箱）后点选加入收件人。
 *
 * 候选直接来自 `/admin/users`，因此加入收件人的账号一定是服务端真实存在的，
 * 不需要再手输 userId 去猜。已选列表保留完整账号信息，发送时只取 userId 提交。
 */
export function UserPicker({
    selected,
    onChange,
    disabled,
}: {
    selected: AdminUserSummary[];
    onChange: (next: AdminUserSummary[]) => void;
    disabled?: boolean;
}) {
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    useEffect(() => {
        const timer = window.setTimeout(
            () => setDebouncedSearch(search.trim()),
            SEARCH_DEBOUNCE_MS,
        );
        return () => window.clearTimeout(timer);
    }, [search]);

    const trimmedSearch = debouncedSearch;
    const usersQuery = useQuery({
        queryKey: ["admin", "users", "picker", trimmedSearch],
        queryFn: () =>
            AdminApi.users.list({ search: trimmedSearch, limit: SEARCH_LIMIT }),
        enabled: !disabled && trimmedSearch.length > 0,
        staleTime: 30_000,
        retry: false,
    });

    const selectedIds = useMemo(
        () => new Set(selected.map((user) => user.userId)),
        [selected],
    );

    const candidates = usersQuery.data?.items ?? [];
    const pending = search.trim() !== trimmedSearch;

    const addUser = (user: AdminUserSummary) => {
        if (selectedIds.has(user.userId)) return;
        onChange([...selected, user]);
        setSearch("");
    };

    const removeUser = (userId: string) => {
        onChange(selected.filter((user) => user.userId !== userId));
    };

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="relative">
                <MagnifyingGlassIcon
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                />
                <input
                    className={`${inputClass} pl-8`}
                    value={search}
                    disabled={disabled}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索昵称 / 用户名 / 邮箱 / userId"
                />
            </div>

            {trimmedSearch.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/15">
                    {pending || usersQuery.isFetching ? (
                        <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-white/50">
                            <Spinner size="2" />
                            搜索中
                        </div>
                    ) : usersQuery.isError ? (
                        <div className="flex flex-col items-center gap-2 px-3 py-5 text-sm text-red-100">
                            <span className="break-all text-center">
                                {getErrorMessage(usersQuery.error)}
                            </span>
                            <Button
                                size="1"
                                variant="soft"
                                color="red"
                                onClick={() => void usersQuery.refetch()}
                            >
                                重试
                            </Button>
                        </div>
                    ) : candidates.length === 0 ? (
                        <p className="px-3 py-6 text-center text-sm text-white/50">
                            没有匹配的账号
                        </p>
                    ) : (
                        <div className="flex max-h-64 min-w-0 flex-col divide-y divide-white/5 overflow-y-auto">
                            {candidates.map((user) => {
                                const added = selectedIds.has(user.userId);
                                return (
                                    <button
                                        key={user.userId}
                                        type="button"
                                        disabled={disabled || added}
                                        onClick={() => addUser(user)}
                                        className="flex items-center gap-3 px-3 py-2 text-left transition enabled:hover:bg-white/[0.04] disabled:opacity-45"
                                    >
                                        {user.avatar ? (
                                            <img
                                                src={user.avatar}
                                                alt=""
                                                className="size-8 shrink-0 rounded-full object-cover"
                                            />
                                        ) : (
                                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/50">
                                                <UserPlusIcon size={14} />
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                <span className="truncate text-sm font-medium text-white">
                                                    {user.displayName ||
                                                        user.username ||
                                                        user.userId}
                                                </span>
                                                {user.vip !== "None" && (
                                                    <Badge
                                                        color={VIP_BADGE_COLOR[user.vip]}
                                                        variant="soft"
                                                    >
                                                        {user.vip}
                                                    </Badge>
                                                )}
                                                {user.roles.map((role) => (
                                                    <Badge
                                                        key={role}
                                                        color="gray"
                                                        variant="soft"
                                                    >
                                                        {ROLE_LABELS[role] ??
                                                            role}
                                                    </Badge>
                                                ))}
                                                {user.activeBans.map((ban) => (
                                                    <BanPill
                                                        key={ban.id}
                                                        kind={ban.kind}
                                                    />
                                                ))}
                                            </span>
                                            <span className="block truncate text-xs text-white/45">
                                                {userSubtitle(user)}
                                            </span>
                                        </span>
                                        {added ? (
                                            <span className="shrink-0 text-xs text-emerald-200/80">
                                                已添加
                                            </span>
                                        ) : (
                                            <UserPlusIcon
                                                size={16}
                                                className="shrink-0 text-white/45"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">
                        已选 {selected.length} 位收件人
                    </span>
                    {selected.length > 0 && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange([])}
                            className="text-xs text-white/45 transition enabled:hover:text-white"
                        >
                            清空
                        </button>
                    )}
                </div>
                {selected.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-sm text-white/40">
                        还没有选择收件人
                    </p>
                ) : (
                    <ul className="flex max-h-56 min-w-0 flex-col divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10 bg-black/15">
                        {selected.map((user) => {
                            const name =
                                user.displayName || user.username || user.userId;
                            return (
                                <li
                                    key={user.userId}
                                    className="flex min-w-0 items-center gap-3 px-3 py-2"
                                >
                                    {user.avatar ? (
                                        <img
                                            src={user.avatar}
                                            alt=""
                                            className="size-8 shrink-0 rounded-full object-cover"
                                        />
                                    ) : (
                                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/50">
                                            <UserIcon size={14} />
                                        </span>
                                    )}
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-white">
                                            {name}
                                        </span>
                                        <span className="block truncate font-mono-sarasa text-xs text-white/45">
                                            {user.userId}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        aria-label={`移除收件人 ${name}`}
                                        title={`移除 ${name}`}
                                        onClick={() => removeUser(user.userId)}
                                        className="grid size-6 shrink-0 place-items-center rounded-full text-white/45 transition enabled:hover:bg-red-400/20 enabled:hover:text-red-100"
                                    >
                                        <XIcon size={12} weight="bold" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

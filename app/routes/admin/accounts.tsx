import { Badge, Button, IconButton, Select, Spinner, Tabs, Tooltip } from "~/components/ScaleAwareThemes";
import { CaretLeft, CopyIcon, GithubLogoIcon, ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminApi,
  type ActiveBan,
  type AdminUserDetail,
  type AdminUserSummary,
  type BanKind,
  type VipOrder,
  type VipTier,
} from "~/api/astrobox/admin";
import {
  AdminPage,
  formatDateTime,
  inputClass,
} from "~/components/admin/AdminPage";
import NavIconButton from "~/components/nav-icon-button";
import { useAccountState } from "~/logic/account/store";

const VIP_TIERS: VipTier[] = ["None", "Pro", "CreatorPlus", "CreatorPro"];
const BAN_STATUS_OPTIONS = ["any", "none", "platform", "social"] as const;
const ADMIN_ROLES = ["admin", "moderator", "pr-reviewer"] as const;
const PAGE_SIZE = 100;

const VIP_BADGE_COLOR: Record<VipTier, "gray" | "blue" | "purple" | "amber"> = {
  None: "gray",
  Pro: "blue",
  CreatorPlus: "purple",
  CreatorPro: "amber",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  moderator: "版主",
  "pr-reviewer": "PR审核员",
};

const PLATFORM_CONFIG: Array<{ prefix: string; label: string; profileUrl: (id: string, username: string) => string }> = [
  {
    prefix: "oauth_GitHub",
    label: "GitHub",
    profileUrl: (_id, username) => username ? `https://github.com/${username}` : "",
  },
  {
    prefix: "oauth_Custom",
    label: "爱发电",
    profileUrl: (_id, username) => username ? `https://afdian.com/a/${username}` : "",
  },
  {
    prefix: "oauth_Custom2",
    label: "米坛社区",
    profileUrl: (id) => `https://www.bandbbs.cn/members/${id}/`,
  },
];

const TAB_TRIGGER_CLASS =
  "px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!";

const selectTriggerClass = "w-full min-h-10";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function VipBadge({ vip }: { vip: VipTier }) {
  return (
    <Badge color={VIP_BADGE_COLOR[vip]} variant="soft">
      {vip}
    </Badge>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge color="gray" variant="soft">
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

function parseBoundPlatforms(additional: Record<string, unknown>, github: string | null | undefined) {
  const platforms: Array<{
    label: string;
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    profileUrl: string;
  }> = [];

  for (const { prefix, label, profileUrl } of PLATFORM_CONFIG) {
    const id = additional[`${prefix}_id`];
    if (typeof id === "string" && id) {
      const username = (additional[`${prefix}_username`] as string) || "";
      platforms.push({
        label,
        id,
        username,
        displayName: (additional[`${prefix}_displayName`] as string) || "",
        avatarUrl: (additional[`${prefix}_avatarUrl`] as string) || "",
        profileUrl: profileUrl(id, username),
      });
    }
  }

  if (platforms.length === 0 && github) {
    platforms.push({
      label: "GitHub",
      id: github,
      username: "",
      displayName: "",
      avatarUrl: "",
      profileUrl: "",
    });
  }

  return platforms;
}

async function copyToClipboard(text: string, successMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMsg);
  } catch (err) {
    toast.error("复制失败：" + getErrorMessage(err));
  }
}

function CopyButton({
  value,
  label = "复制",
  size = "1",
}: {
  value: string;
  label?: string;
  size?: "1" | "2";
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        size={size}
        variant="soft"
        color="gray"
        onClick={(event) => {
          event.stopPropagation();
          void copyToClipboard(value, "已复制");
        }}
      >
        <CopyIcon size={14} />
      </IconButton>
    </Tooltip>
  );
}

function BanPill({ ban }: { ban: ActiveBan }) {
  const label = ban.kind === "platform" ? "平台封" : "社交封";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs ${
        ban.kind === "platform"
          ? "bg-red-500/15 text-red-100"
          : "bg-amber-500/15 text-amber-100"
      }`}
    >
      {label}
    </span>
  );
}

export default function AdminAccountsPage() {
  const accountState = useAccountState();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [vip, setVip] = useState("");
  const [banStatus, setBanStatus] =
    useState<(typeof BAN_STATUS_OPTIONS)[number]>("any");
  const [manageTab, setManageTab] = useState<"ban" | "vip" | "roles">("ban");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [orders, setOrders] = useState<VipOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const isAdmin = accountState.astrobox?.roles?.includes("admin") ?? false;

  const loadUsers = async (cursor?: string | null, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const res = await AdminApi.users.list({
        search,
        role,
        vip,
        banStatus,
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
      });
      setUsers((current) => (append ? [...current, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadDetail = async (userId: string) => {
    if (!userId) return;
    setDetailLoading(true);
    try {
      const [nextDetail, nextOrders] = await Promise.all([
        AdminApi.users.detail(userId),
        AdminApi.users.orders(userId),
      ]);
      setDetail(nextDetail);
      setOrders(nextOrders);
    } catch (err) {
      toast.error(getErrorMessage(err));
      setDetail(null);
      setOrders([]);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    if (openUserId) {
      void loadDetail(openUserId);
    } else {
      setDetail(null);
      setOrders([]);
    }
  }, [openUserId]);

  const openSummary = useMemo(
    () => users.find((item) => item.userId === openUserId) || null,
    [openUserId, users],
  );

  const isDetailMode = openUserId !== null;

  return (
    <AdminPage
      title={isDetailMode ? "用户详情" : "账号管理"}
      description={
        isDetailMode
          ? undefined
          : "搜索用户、处理封禁、调整会员档位、查看订单和维护角色。点击用户卡片进入详情。"
      }
      loading={!isDetailMode && loading && users.length === 0}
      error={!isDetailMode ? error : ""}
      onRetry={() => loadUsers()}
    >
      <AnimatePresence mode="popLayout">
        {isDetailMode ? (
          <motion.div
            key="detail"
            className="flex flex-col gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <UserDetailHeader
              summary={detail ?? openSummary}
              onBack={() => setOpenUserId(null)}
            />

            {detailLoading && !detail ? (
              <div className="grid place-items-center py-20">
                <Spinner />
              </div>
            ) : detail ? (
              <Tabs.Root defaultValue="info">
                <Tabs.List className="flex gap-0 border-b border-white/10">
                  <Tabs.Trigger value="info" className={TAB_TRIGGER_CLASS}>
                    用户信息
                  </Tabs.Trigger>
                  <Tabs.Trigger value="manage" className={TAB_TRIGGER_CLASS}>
                    管理用户
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="info" className="pt-4! outline-none!">
                  <div className="flex flex-col gap-4">
                    <UserBasics detail={detail} />
                    <BoundPlatforms detail={detail} />
                  </div>
                </Tabs.Content>

                <Tabs.Content value="manage" className="pt-4! outline-none!">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-1">
                      {([
                        { key: "ban", label: "封禁" },
                        { key: "vip", label: "会员授权" },
                        { key: "roles", label: "角色管理" },
                      ] as const).map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setManageTab(tab.key)}
                          className={`rounded-md px-3 py-1.5 text-sm transition ${
                            manageTab === tab.key
                              ? "bg-white/15 text-white"
                              : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {manageTab === "ban" && (
                      <BanManager
                        detail={detail}
                        onChanged={() => loadDetail(detail.userId)}
                      />
                    )}
                    {manageTab === "vip" && (
                      <VipManager
                        detail={detail}
                        orders={orders}
                        onChanged={() => loadDetail(detail.userId)}
                      />
                    )}
                    {manageTab === "roles" && (
                      <RoleManager
                        detail={detail}
                        enabled={isAdmin}
                        onChanged={() => loadDetail(detail.userId)}
                      />
                    )}
                  </div>
                </Tabs.Content>
              </Tabs.Root>
            ) : (
              <div className="py-12 text-center text-sm text-white/55">
                无法加载用户详情。
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="flex flex-col gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
                <input
                  className={inputClass}
                  placeholder="搜索 userId / 名称 / 邮箱"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadUsers();
                  }}
                />
                <Select.Root
                  value={role || "__all_roles__"}
                  onValueChange={(value) => setRole(value === "__all_roles__" ? "" : value)}
                >
                  <Select.Trigger radius="large" className={selectTriggerClass} placeholder="全部角色" />
                  <Select.Content position="popper">
                    <Select.Item value="__all_roles__">全部角色</Select.Item>
                    {ADMIN_ROLES.map((r) => (
                      <Select.Item key={r} value={r}>
                        {r}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Select.Root
                  value={vip || "__all_vip__"}
                  onValueChange={(value) => setVip(value === "__all_vip__" ? "" : value)}
                >
                  <Select.Trigger radius="large" className={selectTriggerClass} placeholder="全部会员" />
                  <Select.Content position="popper">
                    <Select.Item value="__all_vip__">全部会员</Select.Item>
                    {VIP_TIERS.map((tier) => (
                      <Select.Item key={tier} value={tier}>
                        {tier}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Select.Root
                  value={banStatus}
                  onValueChange={(value) => setBanStatus(value as typeof banStatus)}
                >
                  <Select.Trigger radius="large" className={selectTriggerClass} placeholder="封禁状态" />
                  <Select.Content position="popper">
                    {BAN_STATUS_OPTIONS.map((option) => (
                      <Select.Item key={option} value={option}>
                        {option === "any" ? "全部" : option === "none" ? "无封禁" : option === "platform" ? "平台封" : "社交封"}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Button onClick={() => loadUsers()} disabled={loading}>查询</Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {users.map((user) => (
                  <button
                    key={user.userId}
                    type="button"
                    onClick={() => setOpenUserId(user.userId)}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
                  >
                    {user.avatar && (
                      <img
                        src={user.avatar}
                        className="h-10 w-10 rounded-full object-cover"
                        alt=""
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">
                          {user.displayName || user.username || user.userId}
                        </span>
                        <VipBadge vip={user.vip} />
                      </div>
                      <p className="truncate font-mono-sarasa text-xs text-white/50">
                        {user.userId}
                      </p>
                      {user.github && (
                        <p className="flex items-center gap-1 truncate text-[11px] text-white/45">
                          <GithubLogoIcon size={11} />
                          {user.github}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {user.activeBans.map((ban) => (
                        <BanPill key={ban.id} ban={ban} />
                      ))}
                      <CopyButton value={user.userId} label="复制 userId" />
                    </div>
                  </button>
                ))}
                {users.length === 0 && (
                  <div className="col-span-full px-4 py-10 text-center text-sm text-white/50">
                    没有匹配用户
                  </div>
                )}
              </div>

              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="soft"
                    onClick={() => loadUsers(nextCursor, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "加载中..." : "加载更多"}
                  </Button>
                </div>
              )}
          </motion.div>
        )}
      </AnimatePresence>
    </AdminPage>
  );
}

function UserDetailHeader({
  summary,
  onBack,
}: {
  summary: AdminUserSummary | null;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <NavIconButton
        onClick={onBack}
        className="size-10! shrink-0 bg-white/10 hover:bg-white/20"
      >
        <CaretLeft weight="bold" size={20} />
      </NavIconButton>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {summary?.avatar && (
            <img
              src={summary.avatar}
              className="h-12 w-12 shrink-0 rounded-full object-cover"
              alt=""
            />
          )}
          <h2 className="truncate text-xl font-semibold text-white">
            {summary?.displayName ||
              summary?.username ||
              summary?.userId ||
              "用户详情"}
          </h2>
          {summary && (
            <VipBadge vip={summary.vip} />
          )}
          {summary?.activeBans.map((ban) => (
            <BanPill key={ban.id} ban={ban} />
          ))}
        </div>
        {summary?.userId && (
          <p className="truncate font-mono-sarasa text-xs text-white/50">
            {summary.userId}
          </p>
        )}
      </div>
    </div>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/40">{label}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono-sarasa text-white">
          {value || "--"}
        </p>
        {value && <CopyButton value={value} label={`复制 ${label}`} />}
      </div>
    </div>
  );
}

function UserBasics({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="grid gap-3 rounded-xl bg-black/20 p-3 text-sm text-white/70 md:grid-cols-2">
      <CopyableRow label="User ID" value={detail.userId} />
      <CopyableRow label="Username" value={detail.username || ""} />
      <CopyableRow label="Email" value={detail.email || ""} />
      <div className="min-w-0">
        <span className="text-white/40">Roles</span>
        <div className="flex flex-wrap gap-1.5">
          {detail.roles.length > 0
            ? detail.roles.map((r) => <RoleBadge key={r} role={r} />)
            : <span className="text-white/50">--</span>}
        </div>
      </div>
      <div>
        <span className="text-white/40">Created</span>
        <p className="text-white">{formatDateTime(detail.createdAt)}</p>
      </div>
    </div>
  );
}

function BoundPlatforms({ detail }: { detail: AdminUserDetail }) {
  const platforms = parseBoundPlatforms(
    detail.additionalProperties ?? {},
    detail.github,
  );

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">已绑定平台</h3>
      {platforms.length === 0 ? (
        <p className="text-sm text-white/45">没有绑定的第三方平台。</p>
      ) : (
        <div className="grid min-w-0 gap-2 md:grid-cols-2">
          {platforms.map((p) => (
            <div
              key={p.label}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            >
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                  alt=""
                />
              ) : p.label === "GitHub" ? (
                <GithubLogoIcon size={18} className="shrink-0 text-white/65" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white/50">
                  {p.label.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="text-xs text-white/40">{p.label}</span>
                <p className="truncate text-white">
                  {p.displayName || p.username || p.id}
                </p>
              </div>
              <CopyButton value={p.id} label={`复制 ${p.label} ID`} />
              {p.profileUrl && (
                <Tooltip content={`在 ${p.label} 打开`}>
                  <IconButton
                    size="1"
                    variant="soft"
                    color="gray"
                    onClick={(event) => {
                      event.stopPropagation();
                      window.open(p.profileUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ArrowSquareOutIcon size={14} />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BanManager({
  detail,
  onChanged,
}: {
  detail: AdminUserDetail;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<BanKind>("social");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [notifyUser, setNotifyUser] = useState(true);

  const createBan = async () => {
    if (!reason.trim()) {
      toast.error("请填写封禁原因");
      return;
    }
    try {
      await AdminApi.users.createBan(detail.userId, {
        kind,
        reason: reason.trim(),
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        notifyUser,
      });
      toast.success("封禁已创建");
      setReason("");
      setDurationMinutes("");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const revokeBan = async (ban: ActiveBan) => {
    try {
      await AdminApi.users.revokeBan(detail.userId, ban.id, {
        reason: "管理员手动解除",
        notifyUser: true,
      });
      toast.success("封禁已撤销");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">封禁</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <Select.Root value={kind} onValueChange={(value) => setKind(value as BanKind)}>
          <Select.Trigger radius="large" className={selectTriggerClass} />
          <Select.Content position="popper">
            <Select.Item value="social">社交封</Select.Item>
            <Select.Item value="platform">平台封</Select.Item>
          </Select.Content>
        </Select.Root>
        <input
          className={inputClass}
          placeholder="原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <input
          className={inputClass}
          placeholder="分钟，空=永久"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
        />
        <Button className="w-full" onClick={createBan}>创建封禁</Button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-white/60">
        <input
          type="checkbox"
          checked={notifyUser}
          onChange={(event) => setNotifyUser(event.target.checked)}
        />
        发送信箱通知
      </label>
      <div className="mt-3 flex flex-col gap-2">
        {detail.banHistory.map((ban) => (
          <div
            key={ban.id}
            className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70"
          >
            <div className="flex flex-wrap items-center gap-2">
              <BanPill ban={ban} />
              <span className="min-w-0 flex-1">
                {ban.reason} · {formatDateTime(ban.createdAt)} - {formatDateTime(ban.expiresAt)}
              </span>
              {!ban.revokedAt && (
                <Button size="1" color="red" variant="soft" onClick={() => revokeBan(ban)}>
                  撤销
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/45">
              <span>操作人: {ban.bannedBy}</span>
              {ban.revokedAt && (
                <>
                  <span>撤销时间: {formatDateTime(ban.revokedAt)}</span>
                  {ban.revokedBy && <span>撤销人: {ban.revokedBy}</span>}
                  {ban.revokedReason && <span>撤销原因: {ban.revokedReason}</span>}
                </>
              )}
            </div>
          </div>
        ))}
        {detail.banHistory.length === 0 && (
          <p className="text-sm text-white/45">暂无封禁记录</p>
        )}
      </div>
    </div>
  );
}

function VipManager({
  detail,
  orders,
  onChanged,
}: {
  detail: AdminUserDetail;
  orders: VipOrder[];
  onChanged: () => void;
}) {
  const [op, setOp] = useState<"set-expire" | "grant-months" | "revoke-tier" | "set-current-tier">("grant-months");
  const [tier, setTier] = useState<VipTier>("Pro");
  const [months, setMonths] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [notifyUser, setNotifyUser] = useState(false);

  const submit = async () => {
    try {
      await AdminApi.users.adjustVip(detail.userId, {
        op,
        tier,
        months: months ? Number(months) : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        reason,
        notifyUser,
      });
      toast.success("会员状态已更新");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">会员</h3>
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
          <span className="text-white/40">当前档位</span>
          <div className="mt-0.5">
            <VipBadge vip={detail.vip} />
          </div>
        </div>
        {Object.entries(detail.vipExpireMap || {}).map(([key, value]) => (
          <div key={key} className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
            <span className="text-white/40">{key}</span>
            <p className="text-white">{formatDateTime(value)}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <Select.Root value={op} onValueChange={(value) => setOp(value as typeof op)}>
          <Select.Trigger radius="large" className={selectTriggerClass} />
          <Select.Content position="popper">
            <Select.Item value="grant-months">补发月数</Select.Item>
            <Select.Item value="set-expire">设置过期</Select.Item>
            <Select.Item value="revoke-tier">中断档位</Select.Item>
            <Select.Item value="set-current-tier">改当前档位</Select.Item>
          </Select.Content>
        </Select.Root>
        <Select.Root value={tier} onValueChange={(value) => setTier(value as VipTier)}>
          <Select.Trigger radius="large" className={selectTriggerClass} />
          <Select.Content position="popper">
            {VIP_TIERS.map((item) => (
              <Select.Item key={item} value={item}>{item}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <input className={inputClass} value={months} onChange={(event) => setMonths(event.target.value)} placeholder="月数" />
        <input className={inputClass} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" />
        <Button className="w-full" onClick={submit}>应用</Button>
      </div>
      <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="备注" />
        <label className="flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white/60">
          <input type="checkbox" checked={notifyUser} onChange={(event) => setNotifyUser(event.target.checked)} />
          通知用户
        </label>
      </div>
      <h4 className="mb-2 mt-4 text-sm font-medium text-white/80">订单历史</h4>
      <div className="max-h-60 overflow-auto rounded-lg border border-white/10">
        {orders.map((order) => (
          <div key={order.id} className="flex flex-col gap-1 border-b border-white/10 px-3 py-2 text-xs text-white/65 last:border-b-0">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono-sarasa">{order.orderId}</span>
              <Badge color={order.status === "granted" ? "green" : "amber"} variant="soft">
                {order.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-white/45">
              <span>{order.vipType} · {order.month} 月</span>
              <span>创建: {formatDateTime(order.createdAt)}</span>
              {order.activatedAt && <span>激活: {formatDateTime(order.activatedAt)}</span>}
              {order.expiredAt && <span>过期: {formatDateTime(order.expiredAt)}</span>}
              {order.ifdianUserId && <span>爱发电用户: {order.ifdianUserId}</span>}
            </div>
          </div>
        ))}
        {orders.length === 0 && <div className="px-3 py-6 text-center text-sm text-white/45">暂无订单</div>}
      </div>
    </div>
  );
}

function RoleManager({
  detail,
  enabled,
  onChanged,
}: {
  detail: AdminUserDetail;
  enabled: boolean;
  onChanged: () => void;
}) {
  const currentRoles = detail.roles;
  const availableToAdd = ADMIN_ROLES.filter((r) => !currentRoles.includes(r));

  const toggleRole = async (role: string, add: boolean) => {
    try {
      await AdminApi.users.roles(detail.userId, {
        add: add ? [role] : undefined,
        remove: add ? undefined : [role],
      });
      toast.success(add ? "角色已添加" : "角色已移除");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">角色管理</h3>
      <p className="mb-2 text-xs text-white/45">
        角色控制用户在管理后台的访问权限。admin 可访问全部功能，moderator 可处理举报/订单/信箱等，pr-reviewer 当前未启用。
      </p>

      <div className="mb-4">
        <span className="mb-2 block text-xs text-white/40">当前角色</span>
        {currentRoles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {currentRoles.map((r) => (
              <span key={r} className="inline-flex items-center gap-1">
                <RoleBadge role={r} />
                {enabled && (
                  <IconButton
                    size="1"
                    variant="soft"
                    color="red"
                    onClick={() => toggleRole(r, false)}
                  >
                    <XIcon size={12} />
                  </IconButton>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">无角色</p>
        )}
      </div>

      {enabled && availableToAdd.length > 0 && (
        <div>
          <span className="mb-2 block text-xs text-white/40">可添加的角色</span>
          <div className="flex flex-wrap gap-2">
            {availableToAdd.map((r) => (
              <Button
                key={r}
                size="1"
                variant="soft"
                onClick={() => toggleRole(r, true)}
              >
                + {ROLE_LABELS[r] ?? r}
              </Button>
            ))}
          </div>
        </div>
      )}

      {!enabled && (
        <p className="mt-2 text-xs text-white/45">只有 admin 角色可以修改用户角色。</p>
      )}
    </div>
  );
}

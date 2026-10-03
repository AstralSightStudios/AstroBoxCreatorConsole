import { Button } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubLogoIcon } from "@phosphor-icons/react";
import {
  AdminApi,
  type AdminUserSummary,
  type InboxMessage,
} from "~/api/astrobox/admin";
import {
  FieldHelpButton,
  FieldHelpDialog,
  type FieldHelpItem,
} from "~/components/field-help";
import { AlertDialog, Select } from "~/components/ScaleAwareThemes";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  formatList,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";
import { UserPicker } from "~/components/admin/UserPicker";
import {
  CC_NOTICE_BADGES,
  INBOX_KINDS,
  isCcNoticeMetadata,
  type InboxKind,
} from "~/logic/inbox/types";

type TargetType = "userIds" | "role" | "all";

/** 与服务端 `src/community/account/roles.ts` 的 ADMIN_ROLES 保持一致。 */
const ADMIN_ROLES = ["admin", "moderator", "pr-reviewer"] as const;

/** `/admin/users` 单页上限 200，够覆盖这些后台角色，超出时按 "N+" 显示。 */
const ROLE_COUNT_LIMIT = 200;

/**
 * 只有这几个角色需要在标签上标人数：admin 由部署配置的 bootstrap 账号保证存在，
 * 必然非空，标人数没意义；moderator / pr-reviewer 没人手工授予过，常常是 0。
 */
const ANNOTATED_ROLES: readonly string[] = ["moderator", "pr-reviewer"];

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  moderator: "版主",
  "pr-reviewer": "PR审核员",
};

type BulkTarget =
  | { type: "userIds"; userIds: string[] }
  | { type: "role"; role: string }
  | { type: "all" };

/** 当前列表里聚合出来的一次投递（同批次所有消息内容一致）。 */
interface InboxBatch {
  bulkId: string;
  title: string;
  kind: string;
  body: string;
  /** 仅统计当前列表可见的条数，不是该批次真实总数 */
  count: number;
}


const KIND_HELP: FieldHelpItem[] = [
  {
    label: "admin-notice",
    description:
      "管理员公告，默认类型。用户在信箱里按普通通知展示，客户端走「管理」推送渠道。",
  },
  {
    label: "cc-notice",
    description:
      "创作者通知，用于资源审核结果（需修改 / 已通过 / 已拒绝 / 已关闭）。正文需配套 metadata.subtype，客户端按 subtype 渲染不同徽章。",
  },
  {
    label: "system",
    description: "系统消息，兜底类型，客户端走系统推送渠道。",
  },
  {
    label: "custom",
    description: "自定义类型，无固定语义，也不带预置图标与推送渠道。",
  },
  {
    label: "ban-notice / unban-notice",
    description: "封禁与解封通知，由风控流程自动触发，手动发送请确认收件人确实处于对应状态。",
  },
  {
    label: "report-resolved",
    description: "举报处理结果通知，建议带上处理结论，正文中附举报编号便于用户反馈。",
  },
  {
    label: "account-deletion-ticket-resolved",
    description: "账号注销工单处理结果通知，用于通过或驳回注销申请。",
  },
  {
    label: "vip-granted / vip-revoked",
    description: "会员开通与失效通知，通常由支付或后台操作自动触发。",
  },
  {
    label: "comment-reply / comment-like",
    description:
      "评论回复与点赞通知，由社区互动自动生成并按 aggregationKey 聚合，一般不需要手动发送。",
  },
];

const BULK_FIELD_HELP: FieldHelpItem[] = [
  {
    label: "bulkId（投递批次号）",
    description:
      "点一次「发送」，服务端会生成一个批次号，写进这次发送产生的每一条消息（同一次发送会给每个收件人各生成一条，它们共享同一个 bulkId）。它的唯一用途是整批撤回——发错了可以一次全撤，而不用逐个人去撤。",
  },
  {
    label: "撤回 与 撤回批次 的区别",
    description:
      "「撤回」只删当前这一条（只影响一个收件人）；「撤回批次」按 bulkId 删掉整批。两者都是软删除，消息对用户立即不可见，但记录仍在库里。",
  },
  {
    label: "在哪里撤回",
    description:
      "「最近消息」上方的「投递批次」区按批次聚合，一行就是一次发送（显示标题、类型和批次号），点「撤回整批」会二次确认并撤掉这批在所有收件人信箱里的消息。消息卡片上的「撤回」只撤当前这一条，同样需要确认。",
  },
  {
    label: "批次列表只统计当前列表",
    description:
      "批次区来自当前查询结果（默认最近 100 条），「列表内 N 条」只是这次查询看到的条数，不是该批次的真实总数——真实撤回条数以撤回后提示的「已撤回 N 条消息」为准。列表里没出现的批次，用「按 bulkId 过滤」输入完整 id 查出来再撤。",
  },
  {
    label: "userId（收件人主键）",
    description:
      "AstroBox 账号的唯一标识，来自 Casdoor 分配的用户 id，决定消息进入谁的信箱。页面上一切筛选、撤回都以它为准；列表里同时显示昵称和头像，方便核对是不是同一个人。",
  },
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function AdminInboxPage() {
  const [targetType, setTargetType] = useState<TargetType>("userIds");
  const [recipients, setRecipients] = useState<AdminUserSummary[]>([]);
  const [role, setRole] = useState<string>(ADMIN_ROLES[1]);
  const [kind, setKind] = useState<InboxKind>("admin-notice");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterBulkId, setFilterBulkId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindHelpOpen, setKindHelpOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InboxMessage | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<InboxBatch | null>(null);

  /**
   * 按 bulkId 聚合出投递批次。同一个批次的标题/正文/kind 必然一致
   * （服务端 sendInboxBulk 只在 userId 上逐条不同），所以拿首条当代表即可。
   * count 只统计"当前列表里可见的条数"，不代表该批次真实总数。
   */
  const batches = useMemo(() => {
    const grouped = new Map<string, InboxBatch>();
    for (const message of messages) {
      const bulkId = message.bulkId;
      if (!bulkId) continue;
      const existing = grouped.get(bulkId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      grouped.set(bulkId, {
        bulkId,
        title: message.title,
        kind: message.kind,
        body: message.body,
        count: 1,
      });
    }
    return Array.from(grouped.values());
  }, [messages]);

  // moderator / pr-reviewer 默认一个人都没有，在下拉里标出人数，
  // 避免选中一个必然发 0 条的角色。admin 不查，它必然非空。
  const roleCountQueries = useQueries({
    queries: ADMIN_ROLES.filter((item) => ANNOTATED_ROLES.includes(item)).map(
      (item) => ({
        queryKey: ["admin", "users", "role-count", item],
        queryFn: () =>
          AdminApi.users.list({ role: item, limit: ROLE_COUNT_LIMIT }),
        enabled: targetType === "role",
        staleTime: 30_000,
        retry: false,
      }),
    ),
  });

  const roleCountLabel = (role: string) => {
    const index = ANNOTATED_ROLES.indexOf(role);
    if (index < 0) return null;
    const query = roleCountQueries[index];
    if (!query?.data) return "…";
    return query.data.hasMore
      ? `${query.data.items.length}+`
      : String(query.data.items.length);
  };

  const loadMessages = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await AdminApi.inbox.list({
        userId: filterUserId,
        bulkId: filterBulkId,
        limit: 100,
      });
      setMessages(res.items);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
  }, []);

  const resolveTarget = (): BulkTarget | null => {
    if (targetType === "all") return { type: "all" };
    if (targetType === "role") {
      if (!role) {
        toast.error("请选择角色");
        return null;
      }
      return { type: "role", role };
    }
    if (recipients.length === 0) {
      toast.error("请至少选择一位收件人");
      return null;
    }
    return { type: "userIds", userIds: recipients.map((user) => user.userId) };
  };

  const doSend = async () => {
    const target = resolveTarget();
    if (!target) return;
    setSending(true);
    try {
      const res = await AdminApi.inbox.send({
        target,
        title: title.trim(),
        body: body.trim(),
        kind,
      });
      if (res.count === 0) {
        // 服务端在没有任何收件人时返回 bulkId="" / count=0，
        // 必须当失败提示，否则看起来像发送成功但一条都没发出去。
        toast.error(
          target.type === "role"
            ? `角色「${ROLE_LABELS[target.role] ?? target.role}」下没有任何账号，未发送`
            : "没有匹配到任何账号，未发送",
        );
      } else {
        // 收件人只能从 /admin/users 搜索结果里选，一定是真实存在的账号，
        // 所以不存在"填错 id"的情况，无需再区分部分跳过。
        toast.success(`已发送 ${res.count} 条消息`);
      }
      setTitle("");
      setBody("");
      if (target.type === "userIds") setRecipients([]);
      await loadMessages();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSending(false);
      setPendingConfirm(false);
    }
  };

  const submit = () => {
    if (!title.trim() || !body.trim()) {
      toast.error("请填写标题和正文");
      return;
    }
    const target = resolveTarget();
    if (!target) return;
    if (target.type === "all") {
      setPendingConfirm(true);
      return;
    }
    void doSend();
  };

  const deleteMessage = async (id: string) => {
    try {
      await AdminApi.inbox.delete(id);
      toast.success("消息已撤回");
      setPendingDelete(null);
      await loadMessages();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteBulk = async (bulkId: string) => {
    try {
      const res = await AdminApi.inbox.bulkDelete(bulkId);
      toast.success(`已撤回 ${res.deleted} 条消息`);
      setPendingBulkDelete(null);
      await loadMessages();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <AdminPage
      title="信箱管理"
      description="向单个用户、角色或所有用户发送系统通知，并撤回误发消息。"
      loading={loading && messages.length === 0}
      error={error}
      onRetry={loadMessages}
    >
      {/* overflow-x-clip：AdminPage 的滚动容器只写了 overflow-y-auto，CSS 会把
          另一个轴的 visible 提升为 auto，于是任何一处超宽都会让整页横向滚动。
          clip 只裁剪不建立滚动容器（hidden 会顺带把纵轴变成 auto，多一层嵌套滚动），
          这里用它兜底，具体超宽项在下面各自处理。 */}
      <div className="grid min-w-0 gap-4 overflow-x-clip 2xl:grid-cols-[minmax(420px,0.85fr)_minmax(560px,1.15fr)]">
        <Panel
          className="min-w-0"
          title="发送消息"
          action={
            <FieldHelpButton
              onClick={() => setKindHelpOpen(true)}
              title="消息类型与投递批次说明"
            />
          }
        >
          <div className="grid min-w-0 gap-3">
            <Field label="目标">
              <Select.Root
                value={targetType}
                onValueChange={(value) => setTargetType(value as TargetType)}
              >
                <Select.Trigger radius="large" className="w-full min-h-10" />
                <Select.Content position="popper">
                  <Select.Item value="userIds">指定用户</Select.Item>
                  <Select.Item value="role">按角色</Select.Item>
                  <Select.Item value="all">所有用户</Select.Item>
                </Select.Content>
              </Select.Root>
            </Field>

            {targetType === "userIds" && (
              <Field label="收件人">
                <UserPicker
                  selected={recipients}
                  onChange={setRecipients}
                  disabled={sending}
                />
              </Field>
            )}

            {targetType === "role" && (
              <Field
                label="角色"
                hint={`将发送给所有拥有该角色的账号`}
              >
                <Select.Root
                  value={role}
                  onValueChange={setRole}
                >
                  <Select.Trigger radius="large" className="w-full min-h-10" />
                  <Select.Content position="popper">
                    {ADMIN_ROLES.map((item) => {
                      const count = roleCountLabel(item);
                      return (
                        <Select.Item key={item} value={item}>
                          {count === null
                            ? `${ROLE_LABELS[item] ?? item}`
                            : `${ROLE_LABELS[item] ?? item}（${count}人）`}
                        </Select.Item>
                      );
                    })}
                  </Select.Content>
                </Select.Root>
              </Field>
            )}

            {targetType === "all" && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                将发送给所有已同步到服务端的账号，发送时会再次确认。
              </div>
            )}

            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
              <Field label="类型">
                <Select.Root
                  value={kind}
                  onValueChange={(value) => setKind(value as InboxKind)}
                >
                  <Select.Trigger radius="large" className="w-full min-h-10" />
                  <Select.Content position="popper">
                    {INBOX_KINDS.map((item) => (
                      <Select.Item key={item} value={item}>
                        {item}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Field>
              <Field label="标题">
                <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
            </div>
            <Field label="正文">
              <textarea className={textareaClass} value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button className="w-full sm:w-auto" disabled={sending} onClick={submit}>
                {sending ? "发送中…" : "发送"}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel className="min-w-0" title="最近消息">
          <div className="mb-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
            <input className={inputClass} placeholder="按 userId 过滤" value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)} />
            <input className={inputClass} placeholder="按 bulkId 过滤" value={filterBulkId} onChange={(event) => setFilterBulkId(event.target.value)} />
            <Button className="w-full" onClick={loadMessages}>查询</Button>
          </div>

          {/* 批次区：撤回是不可逆操作，按钮上必须能看出撤的是哪条内容，
              所以这里按 bulkId 聚合后直接显示标题，而不是只给一截 id。 */}
          <div className="mb-4 flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-white/70">
              投递批次
              <span className="ml-1.5 text-xs text-white/45">
                同一批次内容一致，按标题撤回整批
              </span>
            </span>
            {batches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-center text-sm text-white/40">
                当前列表里没有批次消息
              </p>
            ) : (
              <ul className="flex max-h-44 min-w-0 flex-col divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10 bg-black/15">
                {batches.map((batch) => (
                  <li
                    key={batch.bulkId}
                    className="flex min-w-0 items-center gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {batch.title}
                      </span>
                      <span className="block truncate text-xs text-white/45">
                        {batch.kind} · 列表内 {batch.count} 条 · {batch.bulkId.slice(0, 8)}
                      </span>
                    </span>
                    <Button
                      size="1"
                      color="red"
                      variant="soft"
                      className="shrink-0"
                      onClick={() => setPendingBulkDelete(batch)}
                    >
                      撤回整批
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            {messages.map((message) => {
              const ccNotice = isCcNoticeMetadata(message.metadata)
                ? message.metadata
                : null;
              const ccNoticeBadge = ccNotice
                ? CC_NOTICE_BADGES[ccNotice.subtype]
                : null;
              return (
                <div
                  key={message.id}
                  className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/65">
                      {message.kind === "cc-notice" ? "创作者通知" : message.kind}
                    </span>
                    {ccNoticeBadge ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ccNoticeBadge.className}`}
                      >
                        {ccNoticeBadge.label}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-xs text-white/45">
                      {formatDateTime(message.createdAt)}
                    </span>
                    {/* userId / bulkId 是等宽字体且没有空格，不加 break-all 时
                        它们的 min-content 宽度会顶开整张卡片 */}
                    <span className="min-w-0 break-all font-mono-sarasa text-xs text-white/45">
                      {message.userId}
                    </span>
                    {message.bulkId && (
                      <span className="min-w-0 break-all font-mono-sarasa text-xs text-white/35">
                        bulk {message.bulkId}
                      </span>
                    )}
                    <Button
                      size="1"
                      color="red"
                      variant="soft"
                      className="ml-auto shrink-0"
                      onClick={() => setPendingDelete(message)}
                    >
                      撤回
                    </Button>
                  </div>
                  <h3 className="break-words text-sm font-semibold text-white">
                    {message.title}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-white/65">
                    {message.body}
                  </p>
                  {ccNotice ? (
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                      {ccNotice.resourceName ? (
                        <span className="min-w-0 break-words">资源：{ccNotice.resourceName}</span>
                      ) : null}
                      {typeof ccNotice.prNumber === "number" ? (
                        <span className="shrink-0">PR #{ccNotice.prNumber}</span>
                      ) : null}
                      {ccNotice.resourceId ? (
                        <span className="min-w-0 break-all font-mono-sarasa text-white/40">
                          {ccNotice.resourceId}
                        </span>
                      ) : null}
                      {ccNotice.prUrl ? (
                        <button
                          type="button"
                          onClick={() => void openUrl(ccNotice.prUrl!)}
                          className="inline-flex shrink-0 items-center gap-1 text-white/60 transition-colors hover:text-white"
                        >
                          <GithubLogoIcon size={13} weight="fill" />
                          GitHub
                        </button>
                      ) : null}
                    </div>
                  ) : message.metadata ? (
                    <p className="mt-2 min-w-0 truncate font-mono-sarasa text-xs text-white/35">
                      {formatList(message.metadata)}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {messages.length === 0 && (
              <div className="rounded-xl border border-white/10 px-4 py-10 text-center text-sm text-white/50">
                暂无消息
              </div>
            )}
          </div>
        </Panel>
      </div>
      <FieldHelpDialog
        open={kindHelpOpen}
        onOpenChange={setKindHelpOpen}
        title="消息类型与投递批次说明"
        items={[...KIND_HELP, ...BULK_FIELD_HELP]}
      />
      <AlertDialog.Root
        open={pendingConfirm}
        onOpenChange={setPendingConfirm}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>确认发送给所有用户？</AlertDialog.Title>
          <AlertDialog.Description>
            消息会投递到所有已同步到服务端的账号，发送后只能通过下方的「撤回整批」找回。请确认标题与正文无误。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={sending}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={sending} onClick={() => void doSend()}>
                {sending ? "发送中…" : "确认发送"}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {/* 单条撤回二次确认：把标题、正文、收件人摆出来，避免撤错。 */}
      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>确认撤回这条消息？</AlertDialog.Title>
          <AlertDialog.Description>
            撤回后该收件人将看不到这条消息，且无法恢复。
          </AlertDialog.Description>
          {pendingDelete && (
            <div className="mt-3 flex min-w-0 flex-col gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
              <p className="break-words text-sm font-medium text-white">
                {pendingDelete.title}
              </p>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/60">
                {pendingDelete.body}
              </p>
              <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                <span>{pendingDelete.kind}</span>
                <span>{formatDateTime(pendingDelete.createdAt)}</span>
                <span className="min-w-0 break-all font-mono-sarasa">
                  {pendingDelete.userId}
                </span>
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => {
                  if (pendingDelete) void deleteMessage(pendingDelete.id);
                }}
              >
                确认撤回
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {/* 整批撤回二次确认：影响的是这批消息在所有收件人信箱里的副本。 */}
      <AlertDialog.Root
        open={pendingBulkDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBulkDelete(null);
        }}
      >
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>确认撤回整批消息？</AlertDialog.Title>
          <AlertDialog.Description>
            该批次在所有收件人信箱里的消息都会被撤回，无法恢复。
          </AlertDialog.Description>
          {pendingBulkDelete && (
            <div className="mt-3 flex min-w-0 flex-col gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
              <p className="break-words text-sm font-medium text-white">
                {pendingBulkDelete.title}
              </p>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/60">
                {pendingBulkDelete.body}
              </p>
              <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                <span>{pendingBulkDelete.kind}</span>
                <span>列表内 {pendingBulkDelete.count} 条</span>
                <span className="min-w-0 break-all font-mono-sarasa">
                  {pendingBulkDelete.bulkId}
                </span>
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => {
                  if (pendingBulkDelete) void deleteBulk(pendingBulkDelete.bulkId);
                }}
              >
                确认撤回整批
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </AdminPage>
  );
}

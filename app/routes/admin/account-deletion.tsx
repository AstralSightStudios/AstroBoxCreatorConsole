import { Button, Dialog } from "~/components/ScaleAwareThemes";
import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminApi,
  type AccountDeletionTicket,
  type AccountDeletionTicketStatus,
} from "~/api/astrobox/admin";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";

const STATUS_OPTIONS: Array<AccountDeletionTicketStatus | ""> = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "",
];

const STATUS_LABELS: Record<AccountDeletionTicketStatus, string> = {
  pending: "待处理",
  approved: "已受理",
  rejected: "已驳回",
  cancelled: "已取消",
};

const STATUS_TONES: Record<AccountDeletionTicketStatus, string> = {
  pending: "bg-amber-500/15 text-amber-100",
  approved: "bg-emerald-500/15 text-emerald-100",
  rejected: "bg-red-500/15 text-red-100",
  cancelled: "bg-white/10 text-white/60",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function AdminAccountDeletionPage() {
  const [status, setStatus] = useState<AccountDeletionTicketStatus | "">("pending");
  const [userId, setUserId] = useState("");
  const [tickets, setTickets] = useState<AccountDeletionTicket[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const loadTickets = async (cursor?: string | null, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const res = await AdminApi.accountDeletion.list({
        status: status || undefined,
        userId,
        limit: 100,
        cursor: cursor || undefined,
      });
      setTickets((current) => (append ? [...current, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const openTicket = useMemo(
    () => tickets.find((item) => item.id === openId) || null,
    [openId, tickets],
  );

  return (
    <AdminPage
      title="账号注销工单"
      description="查看用户提交的账号注销申请，确认清理状态后记录人工处理结果。"
      loading={loading && tickets.length === 0}
      error={error}
      onRetry={loadTickets}
    >
      <Panel title={`工单列表 (${tickets.length})`}>
        <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as AccountDeletionTicketStatus | "")}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || "all"} value={option}>
                {option ? STATUS_LABELS[option] : "全部状态"}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="按 userId 过滤"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadTickets();
            }}
          />
          <Button onClick={() => loadTickets()} disabled={loading}>查询</Button>
        </div>

        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => setOpenId(ticket.id)}
              className="flex w-full flex-col gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[ticket.status]}`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
                <span className="text-xs text-white/45">{formatDateTime(ticket.createdAt)}</span>
              </div>
              <p className="truncate text-sm font-medium text-white">
                {ticket.accountSnapshot.displayName || ticket.accountSnapshot.username || ticket.userId}
              </p>
              <p className="truncate font-mono-sarasa text-xs text-white/45">{ticket.userId}</p>
              {ticket.reason && (
                <p className="line-clamp-2 text-xs leading-5 text-white/55">{ticket.reason}</p>
              )}
            </button>
          ))}
          {tickets.length === 0 && (
            <div className="col-span-full rounded-xl border border-white/10 px-4 py-10 text-center text-sm text-white/50">
              暂无注销工单
            </div>
          )}
        </div>

        {hasMore && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="soft"
              onClick={() => loadTickets(nextCursor, true)}
              disabled={loadingMore}
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </Button>
          </div>
        )}
      </Panel>

      <Dialog.Root open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        <Dialog.Content maxWidth="720px">
          {openTicket ? (
            <TicketDetail ticket={openTicket} onChanged={loadTickets} />
          ) : (
            <div className="py-12 text-center text-sm text-white/55">工单不存在或已刷新。</div>
          )}
          <div className="mt-4 flex justify-end">
            <Dialog.Close>
              <Button variant="soft">关闭</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </AdminPage>
  );
}

function TicketDetail({
  ticket,
  onChanged,
}: {
  ticket: AccountDeletionTicket;
  onChanged: () => void;
}) {
  const [resolution, setResolution] = useState(ticket.resolution || "");
  const [notifyUser, setNotifyUser] = useState(true);
  const [busy, setBusy] = useState(false);
  const canResolve = ticket.status === "pending";

  const resolve = async (nextStatus: Exclude<AccountDeletionTicketStatus, "pending">) => {
    if (!canResolve) {
      toast.error("只有待处理工单可以更新状态");
      return;
    }
    if (!resolution.trim()) {
      toast.error("请填写处理说明");
      return;
    }
    setBusy(true);
    try {
      await AdminApi.accountDeletion.resolve(ticket.id, {
        status: nextStatus,
        resolution: resolution.trim(),
        notifyUser,
      });
      toast.success("工单状态已更新");
      await onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Dialog.Title>注销工单 · {ticket.id.slice(0, 8)}</Dialog.Title>
        <Dialog.Description size="2" className="mt-1">
          {ticket.userId} · {STATUS_LABELS[ticket.status]} · 创建于 {formatDateTime(ticket.createdAt)}
        </Dialog.Description>
      </div>

      <div className="grid gap-3 rounded-xl bg-black/20 p-3 text-sm text-white/70 md:grid-cols-2">
        <Info label="User ID" value={ticket.userId} />
        <Info label="Email" value={ticket.accountSnapshot.email || "--"} />
        <Info label="用户名" value={ticket.accountSnapshot.username || "--"} />
        <Info label="显示名" value={ticket.accountSnapshot.displayName || "--"} />
        <Info label="申请时间" value={formatDateTime(ticket.requestedAt)} />
        <Info label="处理时间" value={formatDateTime(ticket.handledAt)} />
      </div>

      <div className="rounded-xl bg-black/20 p-3">
        <h3 className="mb-2 text-sm font-semibold text-white">用户备注</h3>
        <p className="whitespace-pre-wrap text-sm leading-6 text-white/65">{ticket.reason || "--"}</p>
      </div>

      {ticket.blockersSnapshot.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3">
          <h3 className="mb-2 text-sm font-semibold text-amber-100">提交时阻塞项快照</h3>
          <div className="flex flex-wrap gap-2">
            {ticket.blockersSnapshot.map((item) => (
              <span key={item.key} className="rounded-full bg-black/20 px-2 py-1 text-xs text-amber-50/80">
                {item.label} ×{item.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-black/20 p-3">
        <Field label="处理说明">
          <textarea
            className={textareaClass}
            value={resolution}
            maxLength={2000}
            onChange={(event) => setResolution(event.target.value)}
            placeholder="记录处理结果、需用户补充的信息或内部备注"
          />
        </Field>
        <label className="mt-2 flex items-center gap-2 text-sm text-white/60">
          <input
            type="checkbox"
            checked={notifyUser}
            onChange={(event) => setNotifyUser(event.target.checked)}
          />
          发送站内信通知用户
        </label>
        {!canResolve && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/55">
            该工单已进入终态。如需更正，请通过新的显式流程处理，避免覆盖历史处理记录。
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            color="green"
            disabled={busy || !canResolve}
            onClick={() => void resolve("approved")}
          >
            <CheckCircleIcon size={16} /> 标记已受理
          </Button>
          <Button
            color="red"
            variant="soft"
            disabled={busy || !canResolve}
            onClick={() => void resolve("rejected")}
          >
            <XCircleIcon size={16} /> 驳回
          </Button>
          <Button
            color="gray"
            variant="soft"
            disabled={busy || !canResolve}
            onClick={() => void resolve("cancelled")}
          >
            取消工单
          </Button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-white/40">{label}</span>
      <p className="mt-0.5 break-all text-white">{value}</p>
    </div>
  );
}

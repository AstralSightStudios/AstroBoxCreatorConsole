import { Button } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubLogoIcon } from "@phosphor-icons/react";
import { AdminApi, type InboxMessage } from "~/api/astrobox/admin";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  formatList,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";
import {
  CC_NOTICE_BADGES,
  isCcNoticeMetadata,
} from "~/logic/inbox/types";

type TargetType = "userIds" | "role" | "all";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function splitUserIds(value: string) {
  return value
    .split(/[,\n\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function AdminInboxPage() {
  const [targetType, setTargetType] = useState<TargetType>("userIds");
  const [userIds, setUserIds] = useState("");
  const [role, setRole] = useState("moderator");
  const [kind, setKind] = useState("admin-notice");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterBulkId, setFilterBulkId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bulkIds = useMemo(
    () => Array.from(new Set(messages.map((item) => item.bulkId).filter(Boolean))) as string[],
    [messages],
  );

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

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("请填写标题和正文");
      return;
    }
    const target =
      targetType === "all"
        ? ({ type: "all" } as const)
        : targetType === "role"
          ? ({ type: "role", role: role.trim() } as const)
          : ({ type: "userIds", userIds: splitUserIds(userIds) } as const);
    if (target.type === "userIds" && target.userIds.length === 0) {
      toast.error("请至少填写一个 userId");
      return;
    }
    if (target.type === "role" && !target.role) {
      toast.error("请填写角色");
      return;
    }
    try {
      const res = await AdminApi.inbox.send({
        target,
        title: title.trim(),
        body: body.trim(),
        kind: kind.trim() || undefined,
      });
      toast.success(`已发送 ${res.count} 条消息`);
      setTitle("");
      setBody("");
      await loadMessages();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      await AdminApi.inbox.delete(id);
      toast.success("消息已撤回");
      await loadMessages();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteBulk = async (bulkId: string) => {
    try {
      const res = await AdminApi.inbox.bulkDelete(bulkId);
      toast.success(`已撤回 ${res.deleted} 条消息`);
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
      <div className="grid gap-4 2xl:grid-cols-[minmax(420px,0.85fr)_minmax(560px,1.15fr)]">
        <Panel title="发送消息">
          <div className="grid gap-3">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
              <Field label="目标">
                <select className={inputClass} value={targetType} onChange={(event) => setTargetType(event.target.value as TargetType)}>
                  <option value="userIds">指定用户</option>
                  <option value="role">按角色</option>
                  <option value="all">所有用户</option>
                </select>
              </Field>
              {targetType === "userIds" && (
                <Field label="userIds">
                  <textarea className={textareaClass} value={userIds} onChange={(event) => setUserIds(event.target.value)} placeholder="每行一个 userId，也可用逗号分隔" />
                </Field>
              )}
              {targetType === "role" && (
                <Field label="角色">
                  <input className={inputClass} value={role} onChange={(event) => setRole(event.target.value)} />
                </Field>
              )}
              {targetType === "all" && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  将发送给所有已同步到服务端的账号。
                </div>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
              <Field label="类型">
                <input className={inputClass} value={kind} onChange={(event) => setKind(event.target.value)} />
              </Field>
              <Field label="标题">
                <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
            </div>
            <Field label="正文">
              <textarea className={textareaClass} value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button className="w-full sm:w-auto" onClick={submit}>发送</Button>
            </div>
          </div>
        </Panel>

        <Panel
          title="最近消息"
          action={
            <div className="flex flex-wrap justify-end gap-2">
              {bulkIds.slice(0, 3).map((bulkId) => (
                <Button key={bulkId} size="1" color="red" variant="soft" onClick={() => deleteBulk(bulkId)}>
                  撤回批次 {bulkId.slice(0, 8)}
                </Button>
              ))}
            </div>
          }
        >
          <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
            <input className={inputClass} placeholder="按 userId 过滤" value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)} />
            <input className={inputClass} placeholder="按 bulkId 过滤" value={filterBulkId} onChange={(event) => setFilterBulkId(event.target.value)} />
            <Button className="w-full" onClick={loadMessages}>查询</Button>
          </div>
          <div className="flex flex-col gap-2">
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
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/65">
                      {message.kind === "cc-notice" ? "创作者通知" : message.kind}
                    </span>
                    {ccNoticeBadge ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${ccNoticeBadge.className}`}
                      >
                        {ccNoticeBadge.label}
                      </span>
                    ) : null}
                    <span className="text-xs text-white/45">
                      {formatDateTime(message.createdAt)}
                    </span>
                    <span className="font-mono-sarasa text-xs text-white/45">
                      {message.userId}
                    </span>
                    {message.bulkId && (
                      <span className="font-mono-sarasa text-xs text-white/35">
                        bulk {message.bulkId}
                      </span>
                    )}
                    <Button
                      size="1"
                      color="red"
                      variant="soft"
                      onClick={() => deleteMessage(message.id)}
                    >
                      撤回
                    </Button>
                  </div>
                  <h3 className="text-sm font-semibold text-white">
                    {message.title}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-white/65">
                    {message.body}
                  </p>
                  {ccNotice ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                      {ccNotice.resourceName ? (
                        <span>资源：{ccNotice.resourceName}</span>
                      ) : null}
                      {typeof ccNotice.prNumber === "number" ? (
                        <span>PR #{ccNotice.prNumber}</span>
                      ) : null}
                      {ccNotice.resourceId ? (
                        <span className="font-mono-sarasa text-white/40">
                          {ccNotice.resourceId}
                        </span>
                      ) : null}
                      {ccNotice.prUrl ? (
                        <button
                          type="button"
                          onClick={() => void openUrl(ccNotice.prUrl!)}
                          className="inline-flex items-center gap-1 text-white/60 transition-colors hover:text-white"
                        >
                          <GithubLogoIcon size={13} weight="fill" />
                          GitHub
                        </button>
                      ) : null}
                    </div>
                  ) : message.metadata ? (
                    <p className="mt-2 truncate font-mono-sarasa text-xs text-white/35">
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
    </AdminPage>
  );
}

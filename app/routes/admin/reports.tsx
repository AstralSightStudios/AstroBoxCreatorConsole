import { Button, Dialog, IconButton, Spinner, Tooltip } from "@radix-ui/themes";
import { CopyIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminApi,
  type AdminCommentView,
  type BanKind,
  type ReportItem,
  type ReportStatus,
  type ReportType,
} from "~/api/astrobox/admin";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";
import { useAccountState } from "~/logic/account/store";
import { formatResourceType } from "~/logic/publish/resource-type";
import {
  fetchCatalogEntries,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import { useProxiedMediaUrl } from "~/logic/media-proxy";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "等待处理",
  resolved: "已处理",
  dismissed: "已驳回",
};

const STATUS_TONES: Record<ReportStatus, string> = {
  pending: "bg-amber-500/15 text-amber-100",
  resolved: "bg-emerald-500/15 text-emerald-100",
  dismissed: "bg-white/10 text-white/65",
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  } catch (err) {
    toast.error("复制失败：" + getErrorMessage(err));
  }
}

function CopyButton({
  value,
  label = "复制",
}: {
  value: string;
  label?: string;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        onClick={(event) => {
          event.stopPropagation();
          void copyToClipboard(value);
        }}
      >
        <CopyIcon size={12} />
      </IconButton>
    </Tooltip>
  );
}

function CopyableId({
  value,
  label,
  mono = true,
}: {
  value: string | null | undefined;
  label?: string;
  mono?: boolean;
}) {
  if (!value) return <span className="text-white/40">--</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className={`min-w-0 truncate ${mono ? "font-mono-sarasa" : ""}`}>{value}</span>
      <CopyButton value={value} label={label ? `复制 ${label}` : "复制"} />
    </span>
  );
}

export default function AdminReportsPage() {
  const accountState = useAccountState();
  const [status, setStatus] = useState<ReportStatus | "">("pending");
  const [reportType, setReportType] = useState<ReportType | "">("");
  const [senderId, setSenderId] = useState("");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [catalogIndex, setCatalogIndex] = useState<Map<string, CatalogEntry> | null>(null);

  const hasGithub = Boolean(accountState.github?.token);

  const loadReports = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await AdminApi.reports.list({
        status: status || undefined,
        reportType: reportType || undefined,
        senderId,
        limit: 100,
      });
      setReports(res.items);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  useEffect(() => {
    if (!hasGithub || catalogIndex) return;
    let cancelled = false;
    fetchCatalogEntries()
      .then((result) => {
        if (cancelled) return;
        const map = new Map<string, CatalogEntry>();
        for (const entry of result.entries) {
          map.set(entry.id, entry);
        }
        setCatalogIndex(map);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("无法加载资源目录：", getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hasGithub, catalogIndex]);

  const openReport = useMemo(
    () => reports.find((item) => item.id === openId) || null,
    [openId, reports],
  );

  return (
    <AdminPage
      title="举报管理"
      description="查看用户举报、记录处理结论，并可联动封禁。点击卡片在弹窗中查看上下文。"
      loading={loading && reports.length === 0}
      error={error}
      onRetry={loadReports}
    >
      <Panel title={`举报列表 (${reports.length})`}>
        <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as ReportStatus | "")}
          >
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="resolved">resolved</option>
            <option value="dismissed">dismissed</option>
          </select>
          <select
            className={inputClass}
            value={reportType}
            onChange={(event) => setReportType(event.target.value as ReportType | "")}
          >
            <option value="">全部类型</option>
            <option value="comment">comment</option>
            <option value="resource">resource</option>
          </select>
          <input
            className={inputClass}
            placeholder="举报人 userId"
            value={senderId}
            onChange={(event) => setSenderId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadReports();
            }}
          />
          <Button onClick={loadReports}>查询</Button>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => (
            <button
              key={report.id}
              type="button"
              onClick={() => setOpenId(report.id)}
              className="flex w-full flex-col gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONES[report.status]}`}>
                  {STATUS_LABELS[report.status]}
                </span>
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-100">
                  {report.reportType}
                </span>
                <span className="text-xs text-white/45">{formatDateTime(report.createdAt)}</span>
              </div>
              <p className="line-clamp-2 text-sm text-white">{report.reason}</p>
              <p className="truncate font-mono-sarasa text-xs text-white/45">
                {report.commentId || report.resourceId || report.id}
              </p>
            </button>
          ))}
          {reports.length === 0 && (
            <div className="col-span-full px-4 py-10 text-center text-sm text-white/50">
              没有匹配举报
            </div>
          )}
        </div>
      </Panel>

      <Dialog.Root
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <Dialog.Content
          maxWidth="100vw"
          className="!w-[min(96vw,1100px)] !max-w-none"
        >
          {openReport ? (
            <ReportDetail
              report={openReport}
              catalogIndex={catalogIndex}
              onChanged={loadReports}
            />
          ) : (
            <div className="py-12 text-center text-sm text-white/55">
              举报不存在或已被刷新。
            </div>
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

function ReportDetail({
  report,
  catalogIndex,
  onChanged,
}: {
  report: ReportItem;
  catalogIndex: Map<string, CatalogEntry> | null;
  onChanged: () => void;
}) {
  return (
    <>
      <Dialog.Title>
        {report.reportType === "comment" ? "评论举报" : "资源举报"} · {report.id.slice(0, 8)}
      </Dialog.Title>
      <Dialog.Description size="2" className="mb-2">
        分类：{report.reasonCategory || "--"} · 创建于 {formatDateTime(report.createdAt)}
      </Dialog.Description>

      <div className="flex max-h-[78vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 rounded-xl bg-black/20 p-3 text-sm">
          <Info label="状态" value={STATUS_LABELS[report.status]} />
          <Info label="类型" value={report.reportType} />
          <Info label="举报人" value={<CopyableId value={report.senderId} label="举报人 userId" />} />
          <Info label="评论 ID" value={<CopyableId value={report.commentId} label="评论 ID" />} />
          <Info label="资源 ID" value={<CopyableId value={report.resourceId} label="资源 ID" />} />
          <Info label="处理人" value={<CopyableId value={report.handledBy} label="处理人" />} />
        </div>

        <div className="rounded-xl bg-black/20 p-3">
          <h3 className="mb-2 text-sm font-semibold text-white">举报理由</h3>
          <p className="whitespace-pre-wrap text-sm leading-6 text-white/75">{report.reason}</p>
          {report.evidence.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 text-sm text-white/60">
              {report.evidence.map((item) => (
                <a key={item} href={item} target="_blank" rel="noreferrer" className="truncate underline">
                  {item}
                </a>
              ))}
            </div>
          )}
        </div>

        {report.reportType === "comment" && report.commentId && (
          <CommentContextSection
            commentId={report.commentId}
            parentId={report.commentParentId}
            catalogIndex={catalogIndex}
          />
        )}

        {report.reportType === "resource" && report.resourceId && (
          <ResourceContextSection
            resourceId={report.resourceId}
            catalogIndex={catalogIndex}
          />
        )}

        <ResolutionForm report={report} onChanged={onChanged} />
      </div>
    </>
  );
}

function CommentContextSection({
  commentId,
  parentId,
  catalogIndex,
}: {
  commentId: string;
  parentId: string | null;
  catalogIndex: Map<string, CatalogEntry> | null;
}) {
  const [comment, setComment] = useState<AdminCommentView | null>(null);
  const [parentComment, setParentComment] = useState<AdminCommentView | null>(null);
  const [reportedNode, setReportedNode] = useState<AdminCommentView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setComment(null);
    setParentComment(null);
    setReportedNode(null);

    (async () => {
      try {
        const lookupId = parentId || commentId;
        const result = await AdminApi.comments.detail(lookupId);
        if (cancelled) return;
        if (parentId) {
          setParentComment(result);
          const target =
            result.id === commentId
              ? result
              : (result.children ?? []).find((child) => child.id === commentId) ?? null;
          setReportedNode(target);
          setComment(result);
        } else {
          setComment(result);
          setReportedNode(result);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commentId, parentId]);

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-2 text-sm font-semibold text-white">被举报评论</h3>
      {loading && (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      )}
      {!loading && error && (
        <p className="text-xs text-red-200">无法加载评论：{error}</p>
      )}
      {!loading && !error && !comment && (
        <p className="text-sm text-white/45">评论已删除或无法访问。</p>
      )}
      {!loading && comment && (
        <div className="flex flex-col gap-3">
          {parentComment && reportedNode && reportedNode.id !== parentComment.id && (
            <div>
              <p className="mb-1 text-xs text-white/45">父评论</p>
              <CommentBubble comment={parentComment} dimmed />
            </div>
          )}

          <div>
            {reportedNode ? (
              <>
                <p className="mb-1 text-xs text-amber-100">被举报内容</p>
                <CommentBubble comment={reportedNode} highlighted />
              </>
            ) : (
              <p className="text-sm text-white/45">在父评论里找不到被举报的子评论（可能已被删除）。</p>
            )}
          </div>

          {comment.children && comment.children.length > 0 && (
            <ChildrenList
              parent={comment}
              children={comment.children}
              reportedId={commentId}
            />
          )}

          <CommentResourceSection
            resourceId={comment.resourceId}
            catalogIndex={catalogIndex}
          />
        </div>
      )}
    </div>
  );
}

function ChildrenList({
  parent,
  children,
  reportedId,
}: {
  parent: AdminCommentView;
  children: AdminCommentView[];
  reportedId: string;
}) {
  const [expanded, setExpanded] = useState(children.length <= 5);
  const visible = expanded ? children : children.slice(0, 3);
  const more = children.length - visible.length;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs text-white/45">
        <span>子评论</span>
        <span>
          {(parent.childrenTotal ?? children.length).toString()} 条
        </span>
        {!expanded && more > 0 && (
          <button
            type="button"
            className="text-blue-200 hover:underline"
            onClick={() => setExpanded(true)}
          >
            展开剩余 {more} 条
          </button>
        )}
        {expanded && children.length > 3 && (
          <button
            type="button"
            className="text-blue-200 hover:underline"
            onClick={() => setExpanded(false)}
          >
            收起
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((child) => (
          <CommentBubble
            key={child.id}
            comment={child}
            highlighted={child.id === reportedId}
          />
        ))}
      </div>
    </div>
  );
}

function CommentBubble({
  comment,
  highlighted,
  dimmed,
}: {
  comment: AdminCommentView;
  highlighted?: boolean;
  dimmed?: boolean;
}) {
  const tone = highlighted
    ? "border-amber-300/40 bg-amber-400/5"
    : dimmed
      ? "border-white/5 bg-black/15 opacity-75"
      : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
        {comment.senderAvatar && (
          <img src={comment.senderAvatar} alt="" className="h-5 w-5 rounded-full object-cover" />
        )}
        <span className="text-white/80">
          {comment.senderDisplayName || comment.senderId}
        </span>
        <CopyableId value={comment.senderId} label="评论作者 userId" />
        <span>{formatDateTime(comment.timestamp)}</span>
        {comment.replyTo && <span>{comment.replyTo}</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-white/85">{comment.content}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/45">
        <span>👍 {comment.likes}</span>
        <span className="inline-flex items-center gap-1">
          ID
          <CopyableId value={comment.id} label="评论 ID" />
        </span>
        {comment.senderIpLocation && <span>地区: {comment.senderIpLocation}</span>}
        {comment.senderIpRaw && (
          <span className="inline-flex items-center gap-1">
            IP
            <CopyableId value={comment.senderIpRaw} label="原始 IP" />
          </span>
        )}
      </div>
    </div>
  );
}

function CommentResourceSection({
  resourceId,
  catalogIndex,
}: {
  resourceId: string;
  catalogIndex: Map<string, CatalogEntry> | null;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/45">所属资源</p>
      <ResourceContextSection
        resourceId={resourceId}
        catalogIndex={catalogIndex}
        compact
      />
    </div>
  );
}

function ResourceContextSection({
  resourceId,
  catalogIndex,
  compact,
}: {
  resourceId: string;
  catalogIndex: Map<string, CatalogEntry> | null;
  compact?: boolean;
}) {
  const entry = catalogIndex?.get(resourceId);
  const wrapperClass = compact ? "" : "rounded-xl bg-black/20 p-3";
  const inner = (
    <>
      {!compact && <h3 className="mb-2 text-sm font-semibold text-white">被举报资源</h3>}
      {!catalogIndex ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
          登录 GitHub 后才能展示资源元数据。
          <CopyableId value={resourceId} label="资源 ID" />
        </div>
      ) : !entry ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/45">
          资源
          <CopyableId value={resourceId} label="资源 ID" />
          不在公开目录里（可能尚未过审）。
        </div>
      ) : (
        <div className="flex flex-wrap gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          {entry.cover && (
            <ResourceImage
              entry={entry}
              path={entry.cover}
              className="h-20 w-20 rounded-lg border border-white/10 object-cover"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-white/75">
            <div className="flex items-center gap-2">
              {entry.icon && (
                <ResourceImage
                  entry={entry}
                  path={entry.icon}
                  className="h-5 w-5 rounded object-cover"
                />
              )}
              <span className="text-base font-semibold text-white">{entry.name}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{formatResourceType(entry.restype)}</span>
            </div>
            <p className="flex items-center gap-1 text-xs text-white/45">
              ID
              <CopyableId value={entry.id} label="资源 ID" />
            </p>
            <p className="truncate text-xs text-white/55">
              仓库 <span className="font-mono-sarasa">{entry.repo_owner}/{entry.repo_name}</span>
              @{entry.repo_commit_hash?.slice(0, 7)}
            </p>
            {entry.tags && <p className="text-xs text-white/45">tags: {entry.tags}</p>}
            {entry.devices && <p className="text-xs text-white/45">devices: {entry.devices}</p>}
            <a
              href={`https://github.com/${entry.repo_owner}/${entry.repo_name}/tree/${entry.repo_commit_hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-200 underline"
            >
              在 GitHub 打开仓库
            </a>
          </div>
        </div>
      )}
    </>
  );
  return wrapperClass ? <div className={wrapperClass}>{inner}</div> : <>{inner}</>;
}

function ResourceImage({
  entry,
  path,
  className,
}: {
  entry: CatalogEntry;
  path: string;
  className?: string;
}) {
  const rawUrl = useMemo(() => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    if (!entry.repo_owner || !entry.repo_name) return path;
    const ref = entry.repo_commit_hash || "HEAD";
    return buildRawFileUrl(entry.repo_owner, entry.repo_name, ref, path);
  }, [entry.repo_owner, entry.repo_name, entry.repo_commit_hash, path]);
  const src = useProxiedMediaUrl(rawUrl);
  if (!src) return null;
  return <img src={src} alt="" className={className} />;
}

function ResolutionForm({
  report,
  onChanged,
}: {
  report: ReportItem;
  onChanged: () => void;
}) {
  const [resolutionStatus, setResolutionStatus] = useState<"resolved" | "dismissed">("resolved");
  const [resolution, setResolution] = useState(report.resolution ?? "");
  const [notifyReporter, setNotifyReporter] = useState(true);
  const [autoBanEnabled, setAutoBanEnabled] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [banKind, setBanKind] = useState<BanKind>("social");
  const [banReason, setBanReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");

  useEffect(() => {
    setResolution(report.resolution ?? "");
    setTargetUserId("");
    setBanReason("");
    setDurationMinutes("");
    setAutoBanEnabled(false);
  }, [report.id]);

  const submit = async () => {
    if (!resolution.trim()) {
      toast.error("请填写处理说明");
      return;
    }
    if (autoBanEnabled && (!targetUserId.trim() || !banReason.trim())) {
      toast.error("联动封禁需要填写目标用户和原因");
      return;
    }
    try {
      await AdminApi.reports.resolve(report.id, {
        status: resolutionStatus,
        resolution: resolution.trim(),
        notifyReporter,
        autoBan: autoBanEnabled
          ? {
              targetUserId: targetUserId.trim(),
              kind: banKind,
              reason: banReason.trim(),
              durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
            }
          : undefined,
      });
      toast.success("举报已处理");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <div className="rounded-xl bg-black/20 p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">处理</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        <Field label="处理状态">
          <select className={inputClass} value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value as typeof resolutionStatus)}>
            <option value="resolved">resolved</option>
            <option value="dismissed">dismissed</option>
          </select>
        </Field>
        <Field label="处理说明">
          <textarea className={textareaClass} value={resolution} onChange={(event) => setResolution(event.target.value)} />
        </Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-white/60">
        <input type="checkbox" checked={notifyReporter} onChange={(event) => setNotifyReporter(event.target.checked)} />
        通知举报人
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm text-white/60">
        <input type="checkbox" checked={autoBanEnabled} onChange={(event) => setAutoBanEnabled(event.target.checked)} />
        同时创建封禁
      </label>
      {autoBanEnabled && (
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          <input className={inputClass} placeholder="目标用户 userId" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} />
          <select className={inputClass} value={banKind} onChange={(event) => setBanKind(event.target.value as BanKind)}>
            <option value="social">social</option>
            <option value="platform">platform</option>
          </select>
          <input className={inputClass} placeholder="封禁原因" value={banReason} onChange={(event) => setBanReason(event.target.value)} />
          <input className={inputClass} placeholder="分钟，空=永久" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button className="w-full sm:w-auto" onClick={submit} disabled={report.status !== "pending"}>
          提交处理
        </Button>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="text-white/40">{label}</span>
      <div className="min-w-0 truncate text-white">
        {typeof value === "string" ? value : value}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwise,
  ArrowRight,
  ClockCounterClockwise,
  GitBranch,
  GithubLogo,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Button,
  Checkbox,
  Dialog,
} from "~/components/ScaleAwareThemes";
import { formatResourceType } from "~/logic/publish/resource-type";
import {
  loadCatalogRollbackPreview,
  type CatalogFieldDiff,
  type CatalogRollbackPreview,
  type RollbackPreviewItem,
} from "~/logic/publish/catalog-rollback-preview";
import type { CatalogEntry } from "~/logic/publish/catalog";
import type { PrResourcePreview } from "../types";
import type { ReviewPullRequest } from "../source";
import { getErrorMessage } from "../utils";
import { LoadingIndicator } from "./LoadingIndicator";
import { RepoFileChanges } from "./RepoFileChanges";

interface RollbackImpactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pull: ReviewPullRequest | null;
  previews: PrResourcePreview[];
  resourceId?: string | null;
  onConfirm: (preview: CatalogRollbackPreview) => Promise<void>;
  onSwitchToLatest: (number: number, resourceId?: string) => void;
}

const FIELD_LABELS: Record<keyof CatalogEntry, string> = {
  id: "资源 ID",
  name: "资源名称",
  restype: "资源类型",
  repo_owner: "仓库所有者",
  repo_name: "发布仓库",
  repo_commit_hash: "发布 commit",
  icon: "图标",
  cover: "封面",
  tags: "标签",
  device_vendors: "设备厂商",
  devices: "设备",
  paid_type: "付费类型",
};

function formatPaidType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "free") return "免费";
  if (normalized === "paid") return "付费";
  if (normalized === "force_paid") return "强制付费";
  return value;
}

function formatFieldValue(field: keyof CatalogEntry, value: string) {
  if (field === "paid_type") return formatPaidType(value);
  if (!value) return "—";
  if (field === "restype") return formatResourceType(value);
  if (
    field === "tags" ||
    field === "device_vendors" ||
    field === "devices"
  ) {
    return value
      .split(";")
      .map((token) => token.trim())
      .filter(Boolean)
      .join(" · ");
  }
  return value;
}

function prLabel(
  entry: { number: number; title?: string } | undefined,
  fallback: string,
) {
  if (!entry) return fallback;
  return entry.title ? `#${entry.number} ${entry.title}` : `#${entry.number}`;
}

function openPr(url: string | undefined) {
  if (!url) return;
  openUrl(url).catch(() =>
    window.open(url, "_blank", "noopener,noreferrer"),
  );
}

function SummaryFields({
  entry,
  emptyText,
}: {
  entry?: CatalogEntry;
  emptyText: string;
}) {
  if (!entry) {
    return <p className="text-sm text-white/45">{emptyText}</p>;
  }
  const rows: Array<[keyof CatalogEntry, string]> = [
    ["id", entry.id],
    ["name", entry.name],
    ["restype", entry.restype],
    ["repo_name", `${entry.repo_owner}/${entry.repo_name}`],
    ["repo_commit_hash", entry.repo_commit_hash],
    ["paid_type", entry.paid_type],
    ["tags", entry.tags],
    ["devices", entry.devices],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([field, value]) => (
        <div key={field} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-sm">
          <span className="text-white/40">{FIELD_LABELS[field]}</span>
          <span
            className={`min-w-0 break-words ${
              field === "repo_commit_hash" || field === "id"
                ? "font-mono-sarasa text-white/80"
                : "text-white/80"
            }`}
          >
            {formatFieldValue(field, value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CatalogDiffList({
  changes,
  beforeMissing,
  afterMissing,
}: {
  changes: CatalogFieldDiff[];
  beforeMissing?: boolean;
  afterMissing?: boolean;
}) {
  if (changes.length === 0) {
    return <p className="text-sm text-white/45">目录行字段没有变化。</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {changes.map((change) => (
        <div
          key={change.field}
          className="grid min-w-0 gap-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm sm:grid-cols-[6.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center"
        >
          <span className="text-xs font-medium text-white/45 sm:text-sm">
            {FIELD_LABELS[change.field]}
          </span>
          <span className="min-w-0 break-words font-mono-sarasa text-red-200/90">
            {beforeMissing
              ? "—"
              : formatFieldValue(change.field, change.before)}
          </span>
          <ArrowRight size={14} className="hidden shrink-0 text-white/30 sm:block" />
          <span className="min-w-0 break-words font-mono-sarasa text-emerald-200">
            {afterMissing ? "—" : formatFieldValue(change.field, change.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PublishingRepoDiff({ item }: { item: RollbackPreviewItem }) {
  const repo = item.publishingRepo;
  if (!item.after) {
    return (
      <p className="text-sm text-white/45">
        回退会移除目录行，发布仓库本身不会被修改。
      </p>
    );
  }
  if (!repo) {
    return <p className="text-sm text-white/45">没有可对比的发布仓库信息。</p>;
  }
  if (!repo.comparable) {
    return (
      <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
        {repo.reason || "发布仓库无法直接对比。"}
      </div>
    );
  }
  if (repo.beforeCommit && repo.afterCommit && repo.beforeCommit === repo.afterCommit) {
    return (
      <p className="text-sm text-white/45">
        回退前后的发布仓库 commit 相同，没有文件变化。
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-white/40">
        从当前 commit 回退到目标 commit 的发布仓库文件变化。
      </p>
      <RepoFileChanges
        owner={repo.owner}
        repo={repo.repo}
        commitHash={repo.afterCommit ?? ""}
        baseCommitHash={repo.beforeCommit}
        isNew={!repo.beforeCommit}
        defaultExpanded={false}
      />
    </div>
  );
}

export function RollbackImpactDialog({
  open,
  onOpenChange,
  pull,
  previews,
  resourceId,
  onConfirm,
  onSwitchToLatest,
}: RollbackImpactDialogProps) {
  const [preview, setPreview] = useState<CatalogRollbackPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [activeId, setActiveId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open || !pull || previews.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPreview(null);
    setConfirmed(false);
    setActiveId("");
    void (async () => {
      try {
        const next = await loadCatalogRollbackPreview({
          pull,
          previews,
          resourceId: resourceId ?? undefined,
        });
        if (cancelled) return;
        setPreview(next);
        setActiveId(next.items[0]?.target.currentId ?? "");
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pull, previews, resourceId, reloadKey]);

  const activeItem = useMemo(() => {
    if (!preview) return undefined;
    return (
      preview.items.find(
        (item) =>
          item.target.currentId.trim().toLowerCase() ===
          activeId.trim().toLowerCase(),
      ) ?? preview.items[0]
    );
  }, [preview, activeId]);

  const crossedCount = preview?.crossedPrs.length ?? 0;
  const hasCrossed = crossedCount > 0;
  const extraWarnings = (activeItem?.warnings ?? []).filter(
    (warning) =>
      !hasCrossed ||
      (!warning.startsWith("本次回退会越过") &&
        !warning.startsWith("后续 PR 统计")),
  );
  const confirmDisabled =
    loading ||
    confirming ||
    Boolean(error) ||
    !preview?.canRollback ||
    (hasCrossed && !confirmed);

  const handleConfirm = async () => {
    if (!preview || confirmDisabled) return;
    setConfirming(true);
    setError("");
    try {
      await onConfirm(preview);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  };

  const globalLatest =
    preview?.latestPrShared && preview.latestPr
      ? preview.latestPr
      : undefined;
  const showGlobalLatest =
    Boolean(globalLatest) &&
    globalLatest!.number !== preview?.pull.number;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!confirming) onOpenChange(next);
      }}
    >
      <Dialog.Content className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[960px] flex-col overflow-hidden">
        <Dialog.Title>回退影响预览</Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          回退 PR #{pull?.number ?? "—"} 对资源目录的影响。确认后才会写入默认分支。
        </Dialog.Description>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 no-scrollbar">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <LoadingIndicator
                text="正在计算回退影响"
                hint="正在对比当前目录、目标状态与后续已合入 PR"
              />
              <Button
                variant="soft"
                color="gray"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
            </div>
          )}

          {!loading && error && !preview && (
            <div className="rounded-[12px] border border-red-400/20 bg-red-500/10 px-4 py-4 text-sm text-red-100">
              <div className="flex items-start gap-2">
                <WarningCircle size={18} weight="duotone" className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  <ArrowClockwise size={14} />
                  重试
                </Button>
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          {!loading && preview && activeItem && (
            <div className="flex flex-col gap-4">
              <div className="rounded-[12px] border border-white/10 bg-nav-item p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <ClockCounterClockwise size={17} weight="duotone" className="text-purple-300" />
                  <span className="min-w-0 break-words font-medium text-white">
                    {pull?.title || `PR #${pull?.number}`}
                  </span>
                  <span className="text-white/40">#{pull?.number}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                  <span>
                    当前最新：
                    <span className="text-white/75">
                      {activeItem.current
                        ? prLabel(activeItem.latestPr, "来源未知")
                        : "无（目录中已移除）"}
                    </span>
                  </span>
                  <span>
                    本次回查：
                    <span className="text-white/75">#{pull?.number}</span>
                  </span>
                  <span>
                    回退后来源：
                    <span className="text-white/75">
                      {activeItem.after
                        ? prLabel(activeItem.targetSourcePr, "合入前 Git 状态")
                        : "无（移除目录行）"}
                    </span>
                  </span>
                </div>
              </div>

              {hasCrossed && (
                <div className="rounded-[12px] border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <div className="flex items-start gap-2">
                    <WarningCircle size={18} weight="duotone" className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">
                        本次回退包含跨 PR 覆盖
                      </div>
                      <p className="mt-1 text-amber-100/80">
                        本次回退会越过 {crossedCount} 个后续已合入 PR，覆盖它们对相关资源的修改。
                        如果当前目录还包含人工修改，也会一并覆盖。
                      </p>
                      <div className="mt-2 flex flex-col gap-1">
                        {preview.crossedPrs.map((entry) => (
                          <button
                            key={`${entry.number}-${entry.commitSha}`}
                            type="button"
                            onClick={() => openPr(entry.url)}
                            className="flex min-w-0 items-center gap-2 rounded-md bg-black/15 px-2 py-1 text-left text-xs text-amber-50/90 transition-colors hover:bg-black/25"
                          >
                            <GithubLogo size={13} weight="duotone" className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {prLabel(entry, `#${entry.number}`)}
                            </span>
                            {entry.committedAt && (
                              <span className="shrink-0 text-amber-100/45">
                                {entry.committedAt.slice(0, 10)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      {!preview.items.every((item) => item.historyComplete) && (
                        <p className="mt-2 text-xs text-amber-200/65">
                          后续 PR 统计可能不完整，请以实际目录与 PR 历史为准。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {preview.items.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {preview.items.map((item) => {
                    const selected =
                      item.target.currentId === activeItem.target.currentId;
                    return (
                      <button
                        key={item.target.currentId}
                        type="button"
                        onClick={() => setActiveId(item.target.currentId)}
                        className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          selected
                            ? "border-purple-300/40 bg-purple-500/15 text-white"
                            : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white/80"
                        }`}
                      >
                        <span className="max-w-[11rem] truncate">
                          {item.after?.name || item.expected.name || item.target.currentId}
                        </span>
                        {item.crossedPrs.length > 0 && (
                          <span className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-100">
                            越过 {item.crossedPrs.length}
                          </span>
                        )}
                        {item.status === "remove" && (
                          <span className="shrink-0 rounded-full bg-red-400/15 px-1.5 py-0.5 text-[10px] text-red-100">
                            移除
                          </span>
                        )}
                        {item.status === "conflict" && (
                          <span className="shrink-0 rounded-full bg-red-400/20 px-1.5 py-0.5 text-[10px] text-red-100">
                            冲突
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <div className="rounded-[12px] border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-100">
                      回退前
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-white">
                      当前最新
                    </span>
                  </div>
                  <SummaryFields
                    entry={activeItem.current}
                    emptyText="当前目录中没有该资源行。"
                  />
                </div>
                <div className="rounded-[12px] border border-purple-400/20 bg-purple-500/[0.06] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-purple-400/15 px-2 py-0.5 text-[11px] text-purple-100">
                      回退后
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-white">
                      目标状态
                    </span>
                    {preview.items.length > 1 &&
                      !preview.latestPrShared &&
                      activeItem.latestPr &&
                      activeItem.latestPr.number !== pull?.number && (
                        <Button
                          size="1"
                          variant="soft"
                          color="purple"
                          className="ml-auto"
                          onClick={() =>
                            onSwitchToLatest(
                              activeItem.latestPr!.number,
                              activeItem.current?.id ||
                                activeItem.target.currentId,
                            )
                          }
                        >
                          改为回退 #{activeItem.latestPr.number}
                        </Button>
                      )}
                  </div>
                  <SummaryFields
                    entry={activeItem.after}
                    emptyText="回退后会从目录移除整行。"
                  />
                </div>
              </div>

              {activeItem.conflicts.length > 0 && (
                <div className="rounded-[12px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {activeItem.conflicts.map((reason) => (
                    <div key={reason}>{reason}</div>
                  ))}
                </div>
              )}

              {extraWarnings.length > 0 && (
                <div className="rounded-[12px] border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  {extraWarnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-white">目录行差异</h3>
                <CatalogDiffList
                  changes={activeItem.changedFields}
                  beforeMissing={!activeItem.current}
                  afterMissing={!activeItem.after}
                />
              </section>

              <section className="flex flex-col gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">发布仓库修改</h3>
                  <p className="mt-0.5 text-xs text-white/40">
                    展开 manifest_v2.json 可查看资源版本、包体和更新日志的字段变化。
                  </p>
                </div>
                <PublishingRepoDiff
                  key={activeItem.target.currentId}
                  item={activeItem}
                />
              </section>
            </div>
          )}
        </div>

        {!loading && preview && (
          <div className="mt-4 shrink-0 border-t border-white/10 pt-3">
            {error && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                <span className="min-w-0 flex-1 break-words">{error}</span>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  <ArrowClockwise size={13} />
                  重新预览
                </Button>
              </div>
            )}
            {preview.blockingReasons.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                {preview.blockingReasons.join(" ")}
              </div>
            )}

            {hasCrossed && (
              <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-50/90">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  disabled={confirming}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  我确认本次回退会覆盖上述 {crossedCount} 个后续已合入 PR 对相关资源的修改。
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {showGlobalLatest && (
                <Button
                  variant="soft"
                  color="purple"
                  disabled={confirming}
                  onClick={() =>
                    onSwitchToLatest(
                      globalLatest!.number,
                      resourceId
                        ? preview.items[0]?.current?.id ||
                            preview.items[0]?.target.currentId
                        : undefined,
                    )
                  }
                >
                  <GitBranch size={15} />
                  改为回退最近一次 #{globalLatest!.number}
                </Button>
              )}
              <div className="ml-auto flex flex-wrap justify-end gap-2">
                <Button
                  variant="soft"
                  color="gray"
                  disabled={confirming}
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  color="purple"
                  disabled={confirmDisabled}
                  onClick={() => void handleConfirm()}
                >
                  {confirming
                    ? "回退中..."
                    : hasCrossed
                      ? "仍要回退到目标状态"
                      : "确认回退"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

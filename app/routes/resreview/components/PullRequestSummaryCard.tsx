import { useState } from "react";
import { Button, Dialog, TextArea } from "~/components/ScaleAwareThemes";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { PrStatusBadge, StatusBadge } from "./StatusBadges";
import { formatTime } from "../utils";
import type { ReviewSource } from "../source";
import { UserCircle, GithubLogo } from "@phosphor-icons/react";

interface PullRequestSummaryCardProps {
  source?: ReviewSource;
  auditMode?: boolean;
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  onApprove: () => void;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  refusing: boolean;
  rollingBack?: boolean;
  canRollback?: boolean;
  rollbackDisabledReason?: string;
  rollbackTargetLabel?: string;
  rollbackScopeLabel: string;
  canMerge: boolean;
  requestingChanges?: boolean;
  onApproveAndMerge: () => void;
  onRequestChanges?: (body: string) => void;
  onClose: (reason: string) => void;
  onRefuse?: (reason: string) => void;
  onRollback?: () => void;
}

export function PullRequestSummaryCard({
  source = "resource",
  auditMode,
  openPull,
  openStatus,
  onApprove,
  approving,
  merging,
  closing,
  refusing,
  rollingBack = false,
  canRollback = false,
  rollbackDisabledReason,
  rollbackTargetLabel = "回退",
  rollbackScopeLabel,
  canMerge,
  requestingChanges = false,
  onApproveAndMerge,
  onRequestChanges,
  onClose,
  onRefuse,
  onRollback,
}: PullRequestSummaryCardProps) {
  const isPlugin = source === "plugin";
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [refuseDialogOpen, setRefuseDialogOpen] = useState(false);
  const [refuseReason, setRefuseReason] = useState("");
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  if (!openPull) return null;
  const badgeState: "open" | "closed" | "merged" =
    openPull.state === "closed"
      ? openPull.merged_at
        ? "merged"
        : "closed"
      : "open";

  return (
    <div className="rounded-[14px] border border-white/10 bg-nav-item p-4">
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-lg font-semibold leading-tight text-white">
              <span className="break-words">{openPull.title}</span>
              <span className="ml-1 text-sm text-white/50">#{openPull.number}</span>
            </h2>
            {isPlugin && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-100">
                ABNG 插件
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/55">
            <PrStatusBadge state={badgeState} />
            <StatusBadge state={openStatus.state} />
            <span className="inline-flex min-w-0 items-center gap-2">
              {openPull.user?.avatar_url ? (
                <img
                  src={openPull.user.avatar_url}
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                  loading="lazy"
                  alt={openPull.user.login}
                />
              ) : (
                <UserCircle size={14} weight="duotone" className="shrink-0" />
              )}
              <span className="truncate font-medium text-white">{openPull.user?.login}</span>
              <span className="shrink-0">· 更新于 {formatTime(openPull.updated_at)}</span>
            </span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="soft"
            aria-label="在 GitHub 打开"
            title="在 GitHub 打开"
            className="px-2!"
            onClick={async () => {
              try {
                await openUrl(openPull.html_url);
              } catch {
                window.open(openPull.html_url, "_blank", "noopener,noreferrer");
              }
            }}
          >
            <GithubLogo size={16} weight="duotone" />
          </Button>
          {auditMode ? (
            <Button
              color="purple"
              disabled={rollingBack || !canRollback}
              title={rollbackDisabledReason || "回退到 PR 合入前的目录行"}
              onClick={() => setRollbackDialogOpen(true)}
            >
              {rollingBack ? "回退中..." : rollbackTargetLabel}
            </Button>
          ) : isPlugin ? (
            <>
              <Button color="green" onClick={onApprove} disabled={approving}>
                {approving ? "通过中..." : "通过"}
              </Button>
              <Button
                color="blue"
                onClick={() => setMergeDialogOpen(true)}
                disabled={approving || merging}
              >
                {merging ? "合入中..." : "合并 PR"}
              </Button>
              {openPull.state === "open" && onRequestChanges && (
                <Button
                  color="amber"
                  variant="soft"
                  disabled={requestingChanges || approving || merging}
                  onClick={() => setRequestDialogOpen(true)}
                >
                  {requestingChanges ? "提交中..." : "要求修改"}
                </Button>
              )}
              {openPull.state === "open" && (
                <Button
                  color="red"
                  variant="soft"
                  disabled={closing}
                  onClick={() => setCloseDialogOpen(true)}
                >
                  {closing ? "关闭中..." : "关闭"}
                </Button>
              )}
            </>
          ) : (
            <>
              {canMerge ? (
                <Button
                  color="blue"
                  onClick={() => setMergeDialogOpen(true)}
                  disabled={approving || merging}
                >
                  {approving ? "批准中..." : merging ? "合入中..." : "批准并合入"}
                </Button>
              ) : (
                <Button color="green" onClick={onApprove} disabled={approving}>
                  {approving ? "通过中..." : "通过"}
                </Button>
              )}
              {openPull.state === "open" && (
                <Button
                  color="red"
                  variant="soft"
                  disabled={closing}
                  onClick={() => setCloseDialogOpen(true)}
                >
                  {closing ? "关闭中..." : "关闭"}
                </Button>
              )}
              {openPull.state === "open" && (
                <Button
                  color="red"
                  disabled={refusing}
                  onClick={() => setRefuseDialogOpen(true)}
                >
                  {refusing ? "拒绝中..." : "拒绝"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog.Root
        open={mergeDialogOpen}
        onOpenChange={(open) => {
          if (!merging) setMergeDialogOpen(open);
        }}
      >
        <Dialog.Content className="max-w-[420px]">
          <Dialog.Title>合入 PR #{openPull.number}</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            {isPlugin
              ? "确认后会先自动解决 index.txt 冲突（如需要），再提交 GitHub Approve（自己的 PR 自动跳过），最后合入。"
              : "确认后将先提交 GitHub Approve，再合入 PR。合入后会触发仓库 Action 自动应用该资源更新/提交请求。"}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setMergeDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="blue"
              disabled={approving || merging}
              onClick={() => {
                setMergeDialogOpen(false);
                onApproveAndMerge();
              }}
            >
              {approving ? "批准中..." : merging ? "合入中..." : "确认合入"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={closeDialogOpen}
        onOpenChange={(open) => {
          setCloseDialogOpen(open);
          if (!open) setCloseReason("");
        }}
      >
        <Dialog.Content className="max-w-[420px]">
          <Dialog.Title>关闭 PR #{openPull.number}</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            {isPlugin
              ? "关闭后会以普通评论记录关闭原因，不会生成 ABCC 标签。"
              : "关闭后将以 CLOSE 标签评论记录关闭原因，创作者可在资源审核列表重新打开。"}
          </Dialog.Description>
          <label className="mt-3 block text-sm text-white/70">
            关闭原因（可选）
          </label>
          <TextArea
            className="mt-1.5 min-h-[100px] resize-y border border-white/10 bg-black/20 text-sm text-white/80 outline-none placeholder:text-white/30"
            placeholder="例如：该提交不符合资源规范，请按审核意见修改后重新打开。"
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            radius="large"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setCloseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="red"
              disabled={closing}
              onClick={() => {
                onClose(closeReason.trim());
                setCloseDialogOpen(false);
              }}
            >
              {closing ? "关闭中..." : "确认关闭"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={requestDialogOpen}
        onOpenChange={(open) => {
          if (!requestingChanges) setRequestDialogOpen(open);
          if (!open) setRequestReason("");
        }}
      >
        <Dialog.Content className="max-w-[440px]">
          <Dialog.Title>要求修改 PR #{openPull.number}</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            将以 GitHub Review 的 REQUEST_CHANGES 提交，不会生成 ABCC 标签。
          </Dialog.Description>
          <label className="mt-3 block text-sm text-white/70">
            修改意见
          </label>
          <TextArea
            className="mt-1.5 min-h-[110px] resize-y border border-white/10 bg-black/20 text-sm text-white/80 outline-none placeholder:text-white/30"
            placeholder="例如：manifest 的 icon 不存在，请补上 icon.png 后重新提交。"
            value={requestReason}
            onChange={(e) => setRequestReason(e.target.value)}
            radius="large"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              disabled={requestingChanges}
              onClick={() => setRequestDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="amber"
              disabled={requestingChanges || !requestReason.trim()}
              onClick={() => {
                onRequestChanges?.(requestReason.trim());
                setRequestDialogOpen(false);
              }}
            >
              {requestingChanges ? "提交中..." : "提交要求修改"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={refuseDialogOpen}
        onOpenChange={(open) => {
          setRefuseDialogOpen(open);
          if (!open) setRefuseReason("");
        }}
      >
        <Dialog.Content className="max-w-[420px]">
          <Dialog.Title>拒绝 PR #{openPull.number}</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            拒绝后将关闭 PR 并记录 REFUSE 标签，该 PR 不再显示在审核列表中，创作者也无法从工具内重新打开。
          </Dialog.Description>
          <label className="mt-3 block text-sm text-white/70">
            拒绝原因（可选）
          </label>
          <TextArea
            className="mt-1.5 min-h-[100px] resize-y border border-white/10 bg-black/20 text-sm text-white/80 outline-none placeholder:text-white/30"
            placeholder="例如：该资源不符合社区收录规范，本次申请不予通过。"
            value={refuseReason}
            onChange={(e) => setRefuseReason(e.target.value)}
            radius="large"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setRefuseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="red"
              disabled={refusing}
              onClick={() => {
                onRefuse?.(refuseReason.trim());
                setRefuseDialogOpen(false);
              }}
            >
              {refusing ? "拒绝中..." : "确认拒绝"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={rollbackDialogOpen}
        onOpenChange={(open) => {
          if (!rollingBack) setRollbackDialogOpen(open);
        }}
      >
        <Dialog.Content className="max-w-[460px]">
          <Dialog.Title>回退 PR #{openPull.number}</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            将把 {rollbackScopeLabel} 在 index_v2.csv 中恢复到 PR
            合入前的状态。回退会直接写入默认分支，不会修改 PR 本身。
          </Dialog.Description>
          {rollbackDisabledReason && (
            <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {rollbackDisabledReason}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              disabled={rollingBack}
              onClick={() => setRollbackDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="purple"
              disabled={rollingBack || !canRollback}
              onClick={() => {
                setRollbackDialogOpen(false);
                onRollback?.();
              }}
            >
              {rollingBack ? "回退中..." : "确认回退"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

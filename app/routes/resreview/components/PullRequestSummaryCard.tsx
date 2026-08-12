import { useState } from "react";
import { Button, Dialog, TextArea } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { PrStatusBadge, StatusBadge } from "./StatusBadges";
import { formatTime } from "../utils";
import { UserCircle, GithubLogo } from "@phosphor-icons/react";

interface PullRequestSummaryCardProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  onApprove: () => void;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  canMerge: boolean;
  onMerge: () => void;
  onClose: (reason: string) => void;
}

export function PullRequestSummaryCard({
  openPull,
  openStatus,
  onApprove,
  approving,
  merging,
  closing,
  canMerge,
  onMerge,
  onClose,
}: PullRequestSummaryCardProps) {
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
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
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="soft"
            className="gap-1.5"
            onClick={async () => {
              try {
                await openUrl(openPull.html_url);
              } catch {
                window.open(openPull.html_url, "_blank", "noopener,noreferrer");
              }
            }}
          >
            <GithubLogo size={16} weight="duotone" />
            在 GitHub 打开
          </Button>
          <Button color="green" onClick={onApprove} disabled={approving}>
            {approving ? "Approving..." : "Approve"}
          </Button>
          {canMerge && (
            <Button color="blue" onClick={onMerge} disabled={merging}>
              {merging ? "Merging..." : "合入"}
            </Button>
          )}
          {openPull.state === "open" && (
            <Button
              color="red"
              variant="soft"
              disabled={closing}
              onClick={() => setCloseDialogOpen(true)}
            >
              {closing ? "关闭中..." : "关闭 PR"}
            </Button>
          )}
        </div>
      </div>

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
            关闭后将以 CLOSE 标签评论记录关闭原因，创作者可在资源审核列表重新打开。
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
    </div>
  );
}

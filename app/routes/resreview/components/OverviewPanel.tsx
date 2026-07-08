import { motion } from "framer-motion";
import { Button } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { PrStatusBadge, StatusBadge } from "./StatusBadges";
import { formatTime } from "../utils";
import { UserCircle } from "@phosphor-icons/react";

interface OverviewPanelProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  onApprove: () => void;
  onClose: () => void;
}

export function OverviewPanel({ openPull, openStatus, onApprove, onClose }: OverviewPanelProps) {
  if (!openPull) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-xl font-semibold text-white">
              <span className="mr-1 text-white/50">#{openPull.number}</span>
              <span className="break-words">{openPull.title}</span>
            </h2>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/55">
            <PrStatusBadge state="open" />
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
          <div className="mt-1 text-xs text-white/40">
            {openPull.head.repo?.full_name ?? openPull.head.ref} · {openPull.head.sha.slice(0, 7)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" onClick={onClose}>
            返回列表
          </Button>
          <Button variant="soft" onClick={() => openUrl(openPull.html_url)}>
            在 GitHub 打开
          </Button>
          <Button color="green" onClick={onApprove}>
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

import { motion } from "framer-motion";
import { Button } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { PrStatusBadge, StatusBadge } from "./StatusBadges";
import { formatTime } from "../utils";
import { UserCircle, GithubLogo } from "@phosphor-icons/react";

interface OverviewPanelProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  onApprove: () => void;
  onClose?: () => void;
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
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-2xl font-semibold text-white">
              <span className="break-words">{openPull.title}</span>
              <span className="ml-1 text-sm text-white/50">#{openPull.number}</span>
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
          <Button color="green" onClick={onApprove}>
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

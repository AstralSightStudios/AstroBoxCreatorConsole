import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { UserCircle } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { PrStatusBadge, ReviewStatusBadge } from "./StatusBadges";
import { CommentIcon } from "./icons";
import { formatTime } from "../utils";

interface PullRequestCardProps {
  pull: GithubPullRequest;
  comments: GithubIssueComment[];
  onClick: () => void;
}

export function PullRequestCard({ pull, comments, onClick }: PullRequestCardProps) {
  const status = deriveReviewStatus(comments);
  const prBadgeState: "open" | "closed" | "merged" =
    pull.state === "closed"
      ? pull.merged_at
        ? "merged"
        : "closed"
      : "open";
  return (
    <motion.button
      layoutId={`pr-item-${pull.number}`}
      layout
      transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.85 }}
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-[14px] border border-white/10 bg-nav-item px-4 py-4 text-left hover:border-white/20 hover:bg-nav-item-hover transition-colors"
    >
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-base font-semibold text-white">
          {pull.title}
          <span className="ml-1.5 text-[12px] font-medium text-white/40">#{pull.number}</span>
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/50">
          <PrStatusBadge state={prBadgeState} />
          <span className="inline-flex min-w-0 items-center gap-2">
            {pull.user?.avatar_url ? (
              <img
                src={pull.user.avatar_url}
                className="h-5 w-5 shrink-0 rounded-full object-cover"
                loading="lazy"
                alt={pull.user.login}
              />
            ) : (
              <UserCircle size={14} weight="duotone" className="shrink-0" />
            )}
            <span className="truncate font-medium text-white">{pull.user?.login}</span>
            <span className="shrink-0">· {formatTime(pull.updated_at)}</span>
          </span>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <ReviewStatusBadge state={status.state} />
          {(comments.length ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-white/45">
              <CommentIcon className="h-3.5 w-3.5 text-white/45" />
              {comments.length}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

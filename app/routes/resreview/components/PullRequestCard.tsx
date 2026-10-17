import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import {
  deriveReviewStatus,
  type NeedFixAuthorStat,
} from "~/logic/publish/review-status";
import { UserCircle } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { PrStatusBadge, ReviewStatusBadge } from "./StatusBadges";
import { CommentIcon } from "./icons";
import { formatTime } from "../utils";

interface PullRequestCardProps {
  pull: GithubPullRequest;
  comments: GithubIssueComment[];
  /** 该 PR 上发送 NEEDFIX 的负责审核者分布（由 deriveNeedFixAuthors 得出）。 */
  reviewers: NeedFixAuthorStat[];
  onClick: () => void;
  onOpenReviewers: () => void;
}

function ReviewerAvatar({ reviewer }: { reviewer: NeedFixAuthorStat }) {
  if (reviewer.avatar_url) {
    return (
      <img
        src={reviewer.avatar_url}
        className="h-6 w-6 shrink-0 rounded-full object-cover ring-2 ring-nav-item"
        loading="lazy"
        alt={reviewer.login}
      />
    );
  }
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-medium text-white/70 ring-2 ring-nav-item">
      {reviewer.login.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PullRequestCard({
  pull,
  comments,
  reviewers,
  onClick,
  onOpenReviewers,
}: PullRequestCardProps) {
  const status = deriveReviewStatus(comments);
  const prBadgeState: "open" | "closed" | "merged" =
    pull.state === "closed"
      ? pull.merged_at
        ? "merged"
        : "closed"
      : "open";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <motion.button
        layoutId={`pr-item-${pull.number}`}
        layout
        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.85 }}
        type="button"
        onClick={onClick}
        className="flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-t-[14px] rounded-b-none border border-white/10 bg-nav-item px-4 py-4 text-left hover:border-white/20 hover:bg-nav-item-hover transition-colors"
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

      <button
        type="button"
        onClick={onOpenReviewers}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-b-[14px] rounded-t-none border border-white/10 bg-nav-item px-4 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-nav-item-hover"
      >
        <span className="shrink-0 text-xs font-medium text-white/45">负责审核</span>
        {reviewers.length > 0 ? (
          <span className="flex min-w-0 items-center">
            <span className="flex items-center -space-x-2">
              {reviewers.slice(0, 5).map((reviewer) => (
                <ReviewerAvatar key={reviewer.login} reviewer={reviewer} />
              ))}
            </span>
            {reviewers.length > 5 && (
              <span className="ml-1.5 shrink-0 text-xs text-white/45">
                +{reviewers.length - 5}
              </span>
            )}
          </span>
        ) : (
          <span className="truncate text-xs text-white/35">暂无负责审核者</span>
        )}
      </button>
    </div>
  );
}

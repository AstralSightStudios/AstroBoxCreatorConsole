import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import {
  deriveReviewStatus,
  type NeedFixAuthorStat,
} from "~/logic/publish/review-status";
import { Check, UserCircle } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { PrStatusBadge, ReviewStatusBadge } from "./StatusBadges";
import { CommentIcon } from "./icons";
import { formatTime } from "../utils";

interface PullRequestCardProps {
  pull: GithubPullRequest;
  comments: GithubIssueComment[];
  /** 该 PR 上发送 NEEDFIX 的负责审核者分布（由 deriveNeedFixAuthors 得出）。 */
  reviewers: NeedFixAuthorStat[];
  /** 选择模式：底部审核栏左侧留出复选框格，点击卡片勾选而非进入详情。 */
  selectable?: boolean;
  selected?: boolean;
  onClick: () => void;
  onToggleSelect?: () => void;
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
  selectable = false,
  selected = false,
  onClick,
  onToggleSelect,
  onOpenReviewers,
}: PullRequestCardProps) {
  const status = deriveReviewStatus(comments);
  const prBadgeState: "open" | "closed" | "merged" =
    pull.state === "closed"
      ? pull.merged_at
        ? "merged"
        : "closed"
      : "open";

  const reviewerContent = (
    <>
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
    </>
  );

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-[14px] border transition-colors ${
        selectable && selected
          ? "border-white/30 bg-white/[0.05]"
          : "border-white/10 bg-nav-item"
      }`}
    >
      <motion.button
        layoutId={`pr-item-${pull.number}`}
        layout
        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.85 }}
        type="button"
        onClick={selectable ? onToggleSelect : onClick}
        className="flex w-full min-w-0 flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-nav-item-hover"
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

      {/*
        底部审核栏与卡片正文同属一个容器，用横向分割线连接（不再留空隙）。
        多选模式下在审核栏左侧切出复选框格，用纵向分割线隔开复选框与审核栏。
      */}
      {selectable ? (
        <div className="flex items-stretch border-t border-white/10">
          <button
            type="button"
            aria-label={selected ? "取消选择该 PR" : "选择该 PR"}
            aria-pressed={selected}
            onClick={onToggleSelect}
            className="flex w-12 shrink-0 items-center justify-center border-r border-white/10 transition-colors hover:bg-nav-item-hover"
          >
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-[6px] border transition-colors ${
                selected
                  ? "border-white/70 bg-white text-neutral-900"
                  : "border-white/30 bg-transparent text-transparent"
              }`}
            >
              <Check size={13} weight="bold" />
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenReviewers}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-nav-item-hover"
          >
            {reviewerContent}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenReviewers}
          className="flex w-full min-w-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 text-left transition-colors hover:bg-nav-item-hover"
        >
          {reviewerContent}
        </button>
      )}
    </div>
  );
}

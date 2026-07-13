import { ArrowClockwiseIcon, UserCircle } from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import { motion } from "framer-motion";
import type { GithubPullRequest } from "~/api/github/pr-review";
import type { GithubIssueComment } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewStatusBadgeMini } from "./StatusBadges";

interface PullRequestSwitcherProps {
  pulls: GithubPullRequest[];
  openNumber: number;
  commentsByPr: Record<number, GithubIssueComment[]>;
  loadingPulls: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onSelect: (pull: GithubPullRequest) => void;
  onRefresh: () => void;
}

export function PullRequestSwitcher({
  pulls,
  openNumber,
  commentsByPr,
  loadingPulls,
  isCollapsed,
  onToggle,
  onSelect,
  onRefresh,
}: PullRequestSwitcherProps) {
  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-sm transition-[width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
        isCollapsed ? "w-[4.5rem] p-2" : "w-[18rem] p-3"
      }`}
    >
      <div
        className={`mb-2 flex items-center border-b border-white/10 pb-2 ${
          isCollapsed ? "justify-center px-0" : "justify-between gap-2 px-1"
        }`}
      >
        {!isCollapsed && (
          <p className="truncate text-xs font-semibold text-white/80">Pull Requests</p>
        )}
        <div className={`flex items-center gap-1.5 ${isCollapsed ? "flex-col gap-2" : ""}`}>
          {!isCollapsed && (
            <Button
              disabled={loadingPulls}
              size="1"
              variant="soft"
              onClick={onRefresh}
              className="h-7 gap-1 px-2 text-xs"
            >
              <motion.div
                animate={{ rotate: loadingPulls ? 360 : 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
                style={{ display: "flex" }}
              >
                <ArrowClockwiseIcon size={12} />
              </motion.div>
              刷新
            </Button>
          )}
          <button
            type="button"
            title={isCollapsed ? "展开边栏" : "收起边栏"}
            aria-label={isCollapsed ? "展开 PR 切换器" : "收起 PR 切换器"}
            onClick={onToggle}
            className={`inline-flex h-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/60 transition hover:bg-white/[0.08] hover:text-white ${
              isCollapsed ? "w-7" : "w-16 gap-1 px-2"
            }`}
          >
            {!isCollapsed && <span className="shrink-0 whitespace-nowrap text-[11px]">收起</span>}
            <span className={`text-xs transition-transform duration-200 ${isCollapsed ? "rotate-180" : ""}`}>
              »
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1 no-scrollbar">
        {pulls.length === 0 && !loadingPulls && (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-white/10 px-2 py-4 text-center text-xs text-white/40">
            暂无可审核 PR
          </div>
        )}
        {pulls.map((pull) => {
          const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
          const selected = pull.number === openNumber;
          return (
            <motion.button
              key={pull.number}
              layoutId={`pr-item-${pull.number}`}
              layout
              transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.85 }}
              type="button"
              onClick={() => onSelect(pull)}
              className={`group flex items-center overflow-hidden rounded-xl border text-left ${
                selected
                  ? isCollapsed
                    ? "mx-auto h-11 w-11 justify-center border-white/20 bg-white/10 shadow-sm"
                    : "w-full gap-2.5 border-white/20 bg-white/10 px-2.5 py-2 shadow-sm"
                  : isCollapsed
                    ? "mx-auto h-11 w-11 justify-center border-transparent hover:bg-white/[0.04]"
                    : "w-full gap-2.5 border-transparent px-2.5 py-2 hover:bg-white/[0.04]"
              }`}
            >
              {pull.user?.avatar_url ? (
                <img
                  src={pull.user.avatar_url}
                  className={`${
                    isCollapsed ? "h-9 w-9 rounded-lg" : "h-8 w-8 rounded-lg"
                  } shrink-0 object-cover object-center`}
                  loading="lazy"
                  alt={pull.user.login}
                />
              ) : (
                <div
                  className={`${
                    isCollapsed ? "h-9 w-9 rounded-lg" : "h-8 w-8 rounded-lg"
                  } inline-flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.04]`}
                >
                  <UserCircle size={16} weight="duotone" className="text-white/50" />
                </div>
              )}

              {!isCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-semibold text-white">
                    #{pull.number} {pull.title}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/50">
                    <span className="truncate">{pull.user?.login}</span>
                    <ReviewStatusBadgeMini state={status.state} />
                  </div>
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </aside>
  );
}
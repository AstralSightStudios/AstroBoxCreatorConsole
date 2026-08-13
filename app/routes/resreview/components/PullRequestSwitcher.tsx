import { ArrowClockwiseIcon, UserCircle, TextOutdent, TextIndent } from "@phosphor-icons/react";
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
      className={`flex shrink-0 flex-col overflow-hidden rounded-[14px] border border-white/10 bg-nav-item shadow-sm transition-[width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
        isCollapsed ? "w-[4.5rem] p-3" : "w-[18rem] p-4"
      }`}
    >
      {/* Toolbar */}
      <div
        className={`mb-3 flex items-center ${
          isCollapsed ? "justify-center" : "justify-between"
        }`}
      >
        {isCollapsed ? (
          <button
            type="button"
            title="展开边栏"
            aria-label="展开 PR 切换器"
            onClick={onToggle}
            className="inline-flex h-9 w-4 cursor-pointer items-center justify-center rounded-lg text-white/60"
          >
            <TextIndent size={16} />
          </button>
        ) : (
          <>
            <Button
              disabled={loadingPulls}
              size="2"
              variant="soft"
              onClick={onRefresh}
              className="gap-1.5 text-sm"
            >
              <motion.div
                animate={{ rotate: loadingPulls ? 360 : 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
                style={{ display: "flex" }}
              >
                <ArrowClockwiseIcon size={16} />
              </motion.div>
              刷新
            </Button>
            <button
              type="button"
              title="收起边栏"
              aria-label="收起 PR 切换器"
              onClick={onToggle}
              className="inline-flex h-9 w-4 cursor-pointer items-center justify-center rounded-lg text-white/60"
            >
              <TextOutdent size={16} />
            </button>
          </>
        )}
      </div>

      {/* PR list */}
      <div className="flex-1 space-y-2 overflow-y-auto no-scrollbar">
        {pulls.length === 0 && !loadingPulls && (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
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
              className={`group flex items-center overflow-hidden rounded-xl border text-left transition-colors ${
                selected
                  ? "border-white/20 bg-white/10 shadow-sm"
                  : "border-transparent hover:bg-white/[0.04]"
              } ${
                isCollapsed
                  ? "mx-auto h-11 w-11 justify-center"
                  : "w-full gap-2.5 px-2.5 py-2"
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
                    <span className="inline-flex shrink-0 items-center gap-1.5">
                      {pull.state === "closed" && (
                        <span
                          className={`text-[10px] ${
                            pull.merged_at ? "text-purple-300/80" : "text-red-300/80"
                          }`}
                        >
                          {pull.merged_at ? "Merged" : "Closed"}
                        </span>
                      )}
                      <ReviewStatusBadgeMini state={status.state} />
                    </span>
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

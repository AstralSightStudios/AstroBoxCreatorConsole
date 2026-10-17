import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowSquareOut,
  UserCircle,
  XIcon,
} from "@phosphor-icons/react";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
import {
  deriveNeedFixAuthors,
  type NeedFixAuthorStat,
} from "~/logic/publish/review-status";
import {
  getGithubUserProfile,
  type GithubIssueComment,
  type GithubPullRequest,
  type GithubUserProfile,
} from "~/api/github/pr-review";

interface ReviewersDrawerProps {
  open: boolean;
  onClose: () => void;
  pull: GithubPullRequest | null;
  /** 当前 PR 的评论（已按组织成员过滤）。 */
  comments: GithubIssueComment[];
}

/** 在系统浏览器里打开该审核者的 GitHub 主页。 */
function openGithubProfile(login: string) {
  const url = `https://github.com/${login}`;
  openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function ReviewerRow({
  reviewer,
  profile,
}: {
  reviewer: NeedFixAuthorStat;
  profile?: GithubUserProfile | null;
}) {
  const displayName = profile?.name?.trim() || reviewer.login;
  return (
    <button
      type="button"
      onClick={() => openGithubProfile(reviewer.login)}
      title={`打开 ${reviewer.login} 的 GitHub 主页`}
      className="flex w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
    >
      {reviewer.avatar_url ? (
        <img
          src={reviewer.avatar_url}
          className="h-11 w-11 shrink-0 rounded-full object-cover"
          loading="lazy"
          alt={reviewer.login}
        />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
          <UserCircle size={22} weight="duotone" className="text-white/50" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">
          {displayName}
        </div>
        <div className="truncate text-xs text-white/45">@{reviewer.login}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-semibold text-white">
          {reviewer.percent}%
        </div>
        <div className="text-[11px] text-white/45">
          {reviewer.count} 条 needfix
        </div>
      </div>
      <ArrowSquareOut size={16} className="shrink-0 text-white/35" />
    </button>
  );
}

/**
 * 「负责审核者」抽屉：展示某个 PR 上所有发送过 NEEDFIX 的审核者，
 * 以及各自占本 PR 全部 NEEDFIX 的比例。displayname 通过 GitHub 用户接口懒加载。
 */
export default function ReviewersDrawer({
  open,
  onClose,
  pull,
  comments,
}: ReviewersDrawerProps) {
  const reviewers = useMemo(
    () => (pull ? deriveNeedFixAuthors(comments) : []),
    [pull, comments],
  );
  const [profiles, setProfiles] = useState<
    Record<string, GithubUserProfile | null>
  >({});

  useEffect(() => {
    if (!open) return;
    const pending = reviewers
      .map((reviewer) => reviewer.login)
      .filter((login) => !(login in profiles));
    if (pending.length === 0) return;

    let cancelled = false;
    void Promise.all(
      pending.map(async (login) => {
        try {
          const profile = await getGithubUserProfile(login);
          return [login, profile] as const;
        } catch {
          return [login, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setProfiles((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });

    return () => {
      cancelled = true;
    };
  }, [open, reviewers, profiles]);

  const totalNeedFix = reviewers.reduce((sum, item) => sum + item.count, 0);

  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="负责审核者"
      description="查看该 PR 的负责审核者及 NEEDFIX 占比"
      handleLabel="收起审核者"
      maxWidth={600}
    >
      <header className="flex items-center justify-between gap-3 px-5.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
            负责审核者
          </h1>
          {pull ? (
            <p className="mt-1 truncate text-[12px] text-white/50">
              #{pull.number} {pull.title}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="关闭审核者"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--text-color)] opacity-60 transition hover:bg-[var(--nav-btn-bg)] hover:opacity-100"
        >
          <XIcon size={18} />
        </button>
      </header>

      <div
        data-vaul-no-drag
        className="mt-2 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-[max(0.875rem,var(--ui-safe-area-bottom))]"
      >
        {reviewers.length === 0 ? (
          <div className="py-16 text-center text-sm text-white/45">
            暂无负责审核者
          </div>
        ) : (
          <>
            <p className="mb-2 px-1 text-xs text-white/45">
              共 {totalNeedFix} 条 needfix，由 {reviewers.length} 位审核者发送
            </p>
            <div className="flex flex-col gap-2">
              {reviewers.map((reviewer) => (
                <ReviewerRow
                  key={reviewer.login}
                  reviewer={reviewer}
                  profile={profiles[reviewer.login]}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </FloatingDrawer>
  );
}

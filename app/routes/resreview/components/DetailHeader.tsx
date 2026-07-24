import { useRepoEnv } from "~/config/repoEnv";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { formatTime } from "../utils";

interface DetailHeaderProps {
  scrollProgress: number;
  openPull: GithubPullRequest | null;
}

export function DetailHeader({ scrollProgress, openPull }: DetailHeaderProps) {
  const env = useRepoEnv();

  const fullOpacity = 1 - scrollProgress;
  const compactOpacity = scrollProgress;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 min-w-0 h-14 overflow-hidden">
        <div
          style={{ opacity: fullOpacity, transform: `translateY(${-8 * scrollProgress}px)` }}
          className="absolute inset-0 flex flex-col justify-center"
        >
          <p className="truncate text-sm text-white/60">
            {env.owner}/{env.repoName}
          </p>
        </div>
        <div
          style={{ opacity: compactOpacity, transform: `translateY(${8 * (1 - scrollProgress)}px)` }}
          className="absolute inset-0 flex flex-col justify-center"
        >
          <h1 className="truncate text-lg font-semibold leading-tight text-white">
            {openPull?.title ?? "PR 详情"}
          </h1>
          {openPull ? (
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-white/60">
              {openPull.user?.avatar_url ? (
                <img
                  src={openPull.user.avatar_url}
                  alt={openPull.user.login}
                  className="h-4 w-4 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              ) : null}
              <span className="truncate">
                {openPull.user?.login ?? "-"} · 更新于 {formatTime(openPull.updated_at)}
              </span>
            </div>
          ) : (
            <p className="truncate text-sm text-white/60">-</p>
          )}
        </div>
      </div>
    </div>
  );
}

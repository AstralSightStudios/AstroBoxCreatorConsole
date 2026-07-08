import { CaretLeft } from "@phosphor-icons/react";
import NavIconButton from "~/components/nav-icon-button";
import { useRepoEnv } from "~/config/repoEnv";
import type { GithubPullRequest } from "~/api/github/pr-review";
import { formatTime } from "../utils";

interface DetailHeaderProps {
  scrollProgress: number;
  openPull: GithubPullRequest | null;
  onClose: () => void;
}

export function DetailHeader({ scrollProgress, openPull, onClose }: DetailHeaderProps) {
  const env = useRepoEnv();

  const fullOpacity = 1 - scrollProgress;
  const compactOpacity = scrollProgress;

  return (
    <div className="flex items-center gap-3">
      <NavIconButton onClick={onClose} className="size-10! shrink-0 bg-white/10 hover:bg-white/20">
        <CaretLeft weight="bold" size={20} />
      </NavIconButton>
      <div className="relative flex-1 min-w-0 h-14 overflow-hidden">
        <div
          style={{ opacity: fullOpacity, transform: `translateY(${-8 * scrollProgress}px)` }}
          className="absolute inset-0 flex flex-col justify-center"
        >
          <h1 className="text-[26px] font-semibold leading-tight text-white">PR审核</h1>
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
          <p className="truncate text-sm text-white/60">
            {openPull
              ? `${openPull.user?.login ?? "-"} · 更新于 ${formatTime(openPull.updated_at)}`
              : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

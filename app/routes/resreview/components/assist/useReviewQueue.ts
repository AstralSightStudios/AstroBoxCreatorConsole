import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReviewAssistApi } from "~/api/astrobox/review";
import { ApiError } from "~/api/astrobox/request";
import { useAccountState } from "~/logic/account/store";
import type { ReviewQueueEntry } from "~/logic/review-assist/queue";

export function useReviewQueue(enabled: boolean, repo: string) {
  const account = useAccountState();
  const signedIn = !!account.astrobox?.token;
  const [clock, setClock] = useState(Date.now());
  const query = useQuery({
    queryKey: ["review-assist", "queue", repo, account.astrobox?.username ?? ""],
    queryFn: async () => ({ queue: await ReviewAssistApi.queue(), receivedAt: Date.now() }),
    enabled: enabled && signedIn,
    staleTime: 60_000,
    refetchInterval: enabled && signedIn ? 5 * 60_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") setClock(Date.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  const data = enabled && signedIn && query.data?.queue.repo === repo ? query.data.queue : undefined;
  const entries = useMemo(() => new Map<number, ReviewQueueEntry>((data?.items ?? []).map(e => [e.number, e])), [data]);
  const offset = data && query.data ? Date.parse(data.serverNow) - query.data.receivedAt : 0;
  const now = Math.max(clock, query.data?.receivedAt ?? 0) + offset;
  let message = "";
  if (enabled) {
    if (!signedIn) message = "登录 AstroBox 审核账号后可使用智能排序。";
    else if (query.error instanceof ApiError && [401, 403].includes(query.error.status ?? 0)) message = "智能队列需要 AstroBox 审核角色。";
    else if (query.isError) message = "暂时无法读取智能队列，使用最近更新时间排序。";
    else if (data && (!data.enabled || !data.configured)) message = "服务端尚未启用审核队列。";
    else if (data?.stale) message = "队列正在同步或数据已过期，使用最近更新时间排序。";
    else if (data?.aiStatus === "daily_budget_exhausted") message = "今日智能分析预算已用完，答复时限和已分析结果继续参与排序。";
  }
  return { ...query, data, entries, now, message, available: !!data?.enabled && data.configured && !data.stale && !query.isError };
}

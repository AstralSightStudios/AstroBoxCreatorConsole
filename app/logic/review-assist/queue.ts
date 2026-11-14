import type { GithubPullRequest } from "~/api/github/pr-review";
import type { ReviewPullRequest } from "~/routes/resreview/source";

export type ReviewPriorityTier = "overdue" | "due_soon" | "priority" | "follow_up" | "normal" | "low" | "waiting_author" | "draft";
export type ReviewQueueEntry = {
  number: number;
  headSha: string;
  updatedAt: string;
  author: string;
  tier: ReviewPriorityTier;
  score: number;
  rank: number;
  waitingSince: string | null;
  deadlineAt: string | null;
  reasons: string[];
  assessedAt: string | null;
  stale: boolean;
  incomplete: boolean;
  assessment: { quality: string; summary: string; signals: Array<{ kind: string; evidenceId: string; quote: string; reason: string }> } | null;
  authorEvidence: Array<{ number: number; at: string; reason: string; quote: string; url: string }>;
  pull: GithubPullRequest | null;
};
export type ReviewQueue = {
  repo: string;
  serverNow: string;
  syncedAt: string | null;
  enabled: boolean;
  configured: boolean;
  stale: boolean;
  lastError: string | null;
  aiStatus: string;
  aiEnabled: boolean;
  pollMinutes: number;
  aiCooldownHours: number;
  budget: { dailyCalls: number; calls: number; dailyUsd: number; chargedOrReservedUsd: number; actualUsd: number };
  items: ReviewQueueEntry[];
};

export const priorityLabels: Record<ReviewPriorityTier, string> = {
  overdue: "已超时 · 优先答复", due_soon: "即将到期", priority: "优先审核", normal: "常规审核",
  low: "较低优先级", waiting_author: "等待作者", draft: "草稿", follow_up: "长期未跟进",
};

export function currentQueueEntry(pull: ReviewPullRequest, entries: Map<number, ReviewQueueEntry>): ReviewQueueEntry | undefined {
  if (pull.source !== "resource") return;
  const entry = entries.get(pull.number);
  // 新提交或新评论出现后，旧理由不继续给当前版本排序。
  if (!entry || entry.headSha !== pull.head.sha || entry.updatedAt !== (pull.updated_at ?? "")) return;
  return entry;
}

export function sortReviewQueue(pulls: ReviewPullRequest[], entries: Map<number, ReviewQueueEntry>, intelligent: boolean): ReviewPullRequest[] {
  const updated = [...pulls].sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.number - a.number,
  );
  if (!intelligent) return updated;
  const resources = updated.filter(p => p.source === "resource").sort((a, b) => {
    const left = currentQueueEntry(a, entries), right = currentQueueEntry(b, entries);
    if (left && right) return left.rank - right.rank;
    if (left || right) return left ? -1 : 1;
    return 0;
  });
  // 资源按服务端队列重排，插件保留原有位置，比较规则保持可传递。
  let index = 0;
  return updated.map(p => p.source === "resource" ? resources[index++] : p);
}

export function deadlineLabel(deadlineAt: string | null, now: number): string | null {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return null;
  const minutes = Math.ceil(Math.abs(deadline - now) / 60_000);
  const duration = `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  return deadline <= now ? `已超时 ${duration}` : `答复剩余 ${duration}`;
}

export function missingQueuePulls(pulls: ReviewPullRequest[], queue: ReviewQueue | undefined): ReviewPullRequest[] {
  if (!queue?.enabled || !queue.configured || queue.stale) return [];
  const seen = new Set(pulls.filter(p => p.source === "resource").map(p => p.number));
  return queue.items.filter(e => e.pull && !seen.has(e.number)).map(e => ({ ...e.pull!, source: "resource" as const }));
}

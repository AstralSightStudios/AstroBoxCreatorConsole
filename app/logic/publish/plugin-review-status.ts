import type { GithubPullReview } from "~/api/github/pr-review";
import type { NeedFixAuthorStat, ReviewState } from "./review-status";

interface LatestReview {
  login: string;
  avatar_url?: string;
  state: string;
  submittedAt: string;
  /** 该审核者提交过 CHANGES_REQUESTED 的次数，用于“负责审核”的占比展示。 */
  requestCount: number;
}

function decisiveReviewState(state: string): "approve" | "request_changes" | "dismissed" | null {
  switch (state) {
    case "APPROVED":
      return "approve";
    case "CHANGES_REQUESTED":
      return "request_changes";
    case "DISMISSED":
      return "dismissed";
    default:
      // PENDING / COMMENTED 不改变当前状态。
      return null;
  }
}

function collectLatestReviews(
  reviews: readonly GithubPullReview[],
  allowedAuthors?: ReadonlySet<string>,
): LatestReview[] {
  const byUser = new Map<string, LatestReview>();
  const ordered = [...reviews].sort((a, b) =>
    (a.submitted_at || "").localeCompare(b.submitted_at || ""),
  );

  for (const review of ordered) {
    const login = review.user?.login?.trim();
    if (!login) continue;
    if (allowedAuthors && allowedAuthors.size > 0 && !allowedAuthors.has(login)) {
      continue;
    }
    const decisive = decisiveReviewState(review.state);
    if (!decisive) continue;
    const previous = byUser.get(login);
    byUser.set(login, {
      login,
      avatar_url: review.user?.avatar_url || previous?.avatar_url,
      state: decisive,
      submittedAt: review.submitted_at || previous?.submittedAt || "",
      requestCount:
        (previous?.requestCount ?? 0) +
        (decisive === "request_changes" ? 1 : 0),
    });
  }

  return Array.from(byUser.values());
}

/**
 * 插件 PR 的状态只来自 GitHub Review：
 * - 任一审核者最新状态是 CHANGES_REQUESTED → 需要修改；
 * - 否则 → 等待审核。
 *
 * 不推导“已修复待复核”：插件审核不需要这个中间态。
 */
export function derivePluginReviewStatus(
  reviews: readonly GithubPullReview[],
  allowedAuthors?: ReadonlySet<string>,
): ReviewState {
  return collectLatestReviews(reviews, allowedAuthors).some(
    (review) => review.state === "request_changes",
  )
    ? "changes_requested"
    : "waiting_review";
}

/** 统计当前仍处于 CHANGES_REQUESTED 的审核者，用于“负责审核”展示。 */
export function derivePluginRequestAuthors(
  reviews: readonly GithubPullReview[],
  allowedAuthors?: ReadonlySet<string>,
): NeedFixAuthorStat[] {
  const active = collectLatestReviews(reviews, allowedAuthors).filter(
    (review) => review.state === "request_changes",
  );
  const total = active.reduce(
    (sum, review) => sum + Math.max(1, review.requestCount),
    0,
  );
  if (active.length === 0 || total === 0) return [];

  return active
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((review) => {
      const count = Math.max(1, review.requestCount);
      return {
        login: review.login,
        avatar_url: review.avatar_url,
        count,
        percent: Math.round((count / total) * 100),
      };
    });
}

import { describe, expect, test } from "bun:test";
import {
  derivePluginRequestAuthors,
  derivePluginReviewStatus,
} from "../../app/logic/publish/plugin-review-status";
import type { GithubPullReview } from "../../app/api/github/pr-review";

function review(
  login: string,
  state: string,
  submittedAt: string,
): GithubPullReview {
  return {
    id: Math.random(),
    state,
    submitted_at: submittedAt,
    user: { login, avatar_url: `https://example.com/${login}.png` },
  };
}

describe("plugin review status", () => {
  test("changes requested keeps the PR in changes_requested", () => {
    expect(
      derivePluginReviewStatus([
        review("a", "CHANGES_REQUESTED", "2026-10-01T00:00:00Z"),
      ]),
    ).toBe("changes_requested");
  });

  test("a later approval from the same reviewer clears the request", () => {
    expect(
      derivePluginReviewStatus([
        review("a", "CHANGES_REQUESTED", "2026-10-01T00:00:00Z"),
        review("a", "APPROVED", "2026-10-02T00:00:00Z"),
      ]),
    ).toBe("waiting_review");
  });

  test("another reviewer's approval does not clear an active request", () => {
    expect(
      derivePluginReviewStatus([
        review("a", "CHANGES_REQUESTED", "2026-10-01T00:00:00Z"),
        review("b", "APPROVED", "2026-10-02T00:00:00Z"),
      ]),
    ).toBe("changes_requested");
  });

  test("dismissed review clears the request", () => {
    expect(
      derivePluginReviewStatus([
        review("a", "CHANGES_REQUESTED", "2026-10-01T00:00:00Z"),
        review("a", "DISMISSED", "2026-10-02T00:00:00Z"),
      ]),
    ).toBe("waiting_review");
  });

  test("plain comments never change the status", () => {
    expect(
      derivePluginReviewStatus([
        review("a", "COMMENTED", "2026-10-01T00:00:00Z"),
      ]),
    ).toBe("waiting_review");
  });

  test("counts only active request-changes reviewers", () => {
    const authors = derivePluginRequestAuthors([
      review("a", "CHANGES_REQUESTED", "2026-10-01T00:00:00Z"),
      review("b", "CHANGES_REQUESTED", "2026-10-02T00:00:00Z"),
      review("c", "APPROVED", "2026-10-03T00:00:00Z"),
    ]);
    expect(authors.map((author) => author.login)).toEqual(["b", "a"]);
    expect(authors.every((author) => author.percent === 50)).toBe(true);
  });
});

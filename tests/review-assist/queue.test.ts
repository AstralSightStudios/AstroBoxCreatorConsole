import { expect, test } from "bun:test";
import { currentQueueEntry, deadlineLabel, missingQueuePulls, sortReviewQueue, type ReviewQueue, type ReviewQueueEntry } from "../../app/logic/review-assist/queue";
import type { ReviewPullRequest } from "../../app/routes/resreview/source";

const at = "2026-11-15T12:00:00Z";
const pull = (number: number, source: ReviewPullRequest["source"] = "resource", updated = at): ReviewPullRequest => ({
  number, source, title: `PR ${number}`, html_url: "", updated_at: updated,
  head: { sha: `sha${number}`, ref: "branch", repo: { full_name: "owner/repo", name: "repo" } }, base: { ref: "main" },
});
const entry = (p: ReviewPullRequest, rank: number): ReviewQueueEntry => ({
  number: p.number, headSha: p.head.sha, updatedAt: p.updated_at!, author: "creator", rank, tier: "normal", score: 40,
  waitingSince: at, deadlineAt: at, reasons: [], assessedAt: null, stale: true, incomplete: false, assessment: null,
  authorEvidence: [], pull: p,
});

test("队列按PR来源、提交和更新时间匹配，旧版本理由不能参与排序", () => {
  const p = pull(1), e = entry(p, 0), entries = new Map([[1, e]]);
  expect(currentQueueEntry(p, entries)).toBe(e);
  expect(currentQueueEntry({ ...p, source: "plugin" }, entries)).toBeUndefined();
  expect(currentQueueEntry({ ...p, head: { ...p.head, sha: "new" } }, entries)).toBeUndefined();
  expect(currentQueueEntry({ ...p, updated_at: "new" }, entries)).toBeUndefined();
});

test("智能排序覆盖资源，插件位置保持稳定，关闭后恢复更新时间排序", () => {
  const a = pull(1), plugin = pull(9, "plugin", "2026-11-15T11:00:00Z"), b = pull(2, "resource", "2026-11-15T10:00:00Z");
  const entries = new Map([[1, entry(a, 1)], [2, entry(b, 0)]]);
  expect(sortReviewQueue([a, b, plugin], entries, true).map(p => p.number)).toEqual([2, 9, 1]);
  expect(sortReviewQueue([a, b, plugin], entries, false).map(p => p.number)).toEqual([1, 9, 2]);
});

test("新增PR缺少分析时保留可见，旧队列匹配失败时不沿用旧优先级", () => {
  const a = pull(1), b = pull(2, "resource", "2026-11-15T10:00:00Z");
  const entries = new Map([[1, { ...entry(a, 0), headSha: "old" }], [2, entry(b, 1)]]);
  expect(sortReviewQueue([a, b], entries, true).map(p => p.number)).toEqual([2, 1]);
  expect(sortReviewQueue([a, b], new Map(), true).map(p => p.number)).toEqual([1, 2]);
});

test("补入旧PR不受80条限制，不重复资源号也不与插件同号混淆", () => {
  const queue = { enabled: true, configured: true, stale: false, items: [entry(pull(100), 0), entry(pull(1), 1)] } as ReviewQueue;
  expect(missingQueuePulls([pull(1), pull(100, "plugin")], queue).map(p => p.number)).toEqual([100]);
  expect(missingQueuePulls([], { ...queue, stale: true })).toEqual([]);
  expect(missingQueuePulls([], { ...queue, enabled: false })).toEqual([]);
});

test("48小时展示支持超时、零点及无效时间", () => {
  const now = Date.parse(at);
  expect(deadlineLabel(new Date(now + 90 * 60_000).toISOString(), now)).toBe("答复剩余 1 小时 30 分");
  expect(deadlineLabel(new Date(now - 90 * 60_000).toISOString(), now)).toBe("已超时 1 小时 30 分");
  expect(deadlineLabel(at, now)).toBe("已超时 0 小时 0 分");
  expect(deadlineLabel(null, now)).toBeNull();
  expect(deadlineLabel("broken", now)).toBeNull();
});

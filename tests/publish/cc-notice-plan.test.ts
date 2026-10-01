import { describe, expect, test } from "bun:test";
import { buildCcNoticeCheckPlan } from "../../app/routes/resreview/utils";

describe("审核通知检测目标推导", () => {
  test("每条 NEEDFIX 各一个目标，CLOSE/REFUSE 只取最新一条", () => {
    const plan = buildCcNoticeCheckPlan(1029, [
      { id: 1, body: "[ABCC_NEEDFIX_aaa] 改封面", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, body: "[ABCC_NEEDFIX_bbb] 改图标", created_at: "2026-01-02T00:00:00Z" },
      { id: 3, body: "[ABCC_FIXED_aaa] 已改", created_at: "2026-01-03T00:00:00Z" },
      { id: 4, body: "[ABCC_CLOSE] 首次关闭", created_at: "2026-01-04T00:00:00Z" },
      { id: 5, body: "[ABCC_CLOSE] 再次关闭", created_at: "2026-01-05T00:00:00Z" },
    ]);

    expect(plan.targets.map((target) => target.key)).toEqual([
      "1029:review-changes-requested:aaa",
      "1029:review-changes-requested:bbb",
      "1029:review-closed:",
      "1029:review-refused:",
      "1029:review-approved:",
    ]);
    expect(plan.commentIdByKey).toEqual({
      "1029:review-changes-requested:aaa": 1,
      "1029:review-changes-requested:bbb": 2,
      "1029:review-closed:": 5,
    });
    expect([...plan.subtypeKeys.entries()]).toEqual([
      ["review-closed", "1029:review-closed:"],
      ["review-refused", "1029:review-refused:"],
      ["review-approved", "1029:review-approved:"],
    ]);
  });

  test("没有标签评论时也始终包含 PR 级的通过通知目标", () => {
    const plan = buildCcNoticeCheckPlan(7, []);
    expect(plan.targets.map((target) => target.key)).toEqual([
      "7:review-closed:",
      "7:review-refused:",
      "7:review-approved:",
    ]);
    expect(plan.commentIdByKey).toEqual({});
  });
});
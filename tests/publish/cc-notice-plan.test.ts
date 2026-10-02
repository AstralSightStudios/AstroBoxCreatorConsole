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
    ]);
    expect(plan.commentIdByKey).toEqual({
      "1029:review-changes-requested:aaa": 1,
      "1029:review-changes-requested:bbb": 2,
      "1029:review-closed:": 5,
    });
  });

  test("没有可挂载的标签评论时不含任何检测目标", () => {
    const plan = buildCcNoticeCheckPlan(7, []);
    expect(plan.targets).toEqual([]);
    expect(plan.commentIdByKey).toEqual({});
  });

  test("REFUSE 与 CLOSE 分别只跟踪各自最新一条评论", () => {
    const plan = buildCcNoticeCheckPlan(31, [
      { id: 1, body: "[ABCC_REFUSE] 首次拒绝", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, body: "[ABCC_CLOSE] 关闭", created_at: "2026-01-02T00:00:00Z" },
      { id: 3, body: "[ABCC_REFUSE] 再次拒绝", created_at: "2026-01-03T00:00:00Z" },
    ]);

    expect(plan.targets.map((target) => target.key)).toEqual([
      "31:review-closed:",
      "31:review-refused:",
    ]);
    expect(plan.commentIdByKey).toEqual({
      "31:review-closed:": 2,
      "31:review-refused:": 3,
    });
  });
});

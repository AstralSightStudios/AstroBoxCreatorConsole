import { describe, expect, test } from "bun:test";
import {
  deriveReviewStatus,
  filterReviewTagComments,
  resolveLatestTagAction,
} from "../../app/logic/publish/review-status";
import { parseReviewCommentBody } from "../../app/routes/resreview/utils/comment";

const MEMBERS = new Set(["member-one", "member-two"]);

describe("review tags", () => {
  test("quoted tags inside a FIXED comment are not counted as extra tags", () => {
    const fixedComment = {
      id: 200,
      body:
        "[ABCC_FIXED_abc123] 已按意见修复\n\n" +
        "> @member-one · 评论 #100\n" +
        "> [ABCC_NEEDFIX_abc123] 请修复图标比例",
      user: { login: "creator" },
    };
    const needFixComment = {
      id: 100,
      body: "[ABCC_NEEDFIX_abc123] 请修复图标比例",
      user: { login: "member-one" },
    };

    const status = deriveReviewStatus([needFixComment, fixedComment]);
    expect(status.items).toHaveLength(1);
    expect(status.items[0].id).toBe("abc123");
    expect(status.items[0].fixed).toBe(true);
    expect(status.state).toBe("fixed_waiting");
  });

  test("filter keeps member tags and author FIXED/REOPEN, drops external tags", () => {
    const comments = [
      { id: 1, body: "[ABCC_NEEDFIX_x] 问题", user: { login: "member-one" } },
      { id: 2, body: "[ABCC_FIXED_x] 已修复", user: { login: "creator" } },
      { id: 3, body: "[ABCC_REOPEN] 重新打开", user: { login: "creator" } },
      { id: 4, body: "[ABCC_CLOSE] 关闭", user: { login: "outsider" } },
      { id: 5, body: "[ABCC_REFUSE] 拒绝", user: { login: "outsider" } },
      { id: 6, body: "[ABCC_REOPEN] 恶意重开", user: { login: "outsider" } },
      { id: 7, body: "普通评论", user: { login: "outsider" } },
    ];

    const filtered = filterReviewTagComments(comments, MEMBERS, "creator");
    expect(filtered.map((c) => c.id)).toEqual([1, 2, 3, 7]);
  });

  test("parseReviewCommentBody only reads the leading tag", () => {
    const parsed = parseReviewCommentBody(
      "[ABCC_FIXED_abc123] 修复完成\n\n" +
        "> [ABCC_NEEDFIX_abc123] 原问题",
    );
    expect(parsed.tagType).toBe("FIXED");
    expect(parsed.tagId).toBe("abc123");
    expect(parsed.content).toContain("> [ABCC_NEEDFIX_abc123]");
    expect(parsed.content).toContain("修复完成");
  });

  test("REFUSE comment is recognized as a tag and filtered to members", () => {
    const memberRefuse = {
      id: 8,
      body: "[ABCC_REFUSE] 不符合规范",
      user: { login: "member-one" },
    };
    const outsiderRefuse = {
      id: 9,
      body: "[ABCC_REFUSE] 恶意",
      user: { login: "outsider" },
    };
    const filtered = filterReviewTagComments(
      [memberRefuse, outsiderRefuse],
      MEMBERS,
      "creator",
    );
    expect(filtered).toEqual([memberRefuse]);
  });

  test("latest CLOSE/REOPEN tag wins to avoid toggle loops", () => {
    const closeFirst = {
      body: "[ABCC_CLOSE] 关闭",
      created_at: "2026-08-12T10:00:00Z",
    };
    const reopenLater = {
      body: "[ABCC_REOPEN] 重开",
      created_at: "2026-08-12T11:00:00Z",
    };
    const closeLater = {
      body: "[ABCC_CLOSE] 关闭",
      created_at: "2026-08-12T12:00:00Z",
    };
    expect(resolveLatestTagAction([closeFirst, reopenLater])).toBe("reopen");
    expect(resolveLatestTagAction([reopenLater, closeLater])).toBe("close");
    expect(resolveLatestTagAction([closeFirst])).toBe("close");
    expect(resolveLatestTagAction([reopenLater])).toBe("reopen");
    expect(resolveLatestTagAction([])).toBeNull();
  });

  test("quoted CLOSE/REOPEN tags inside comments are ignored", () => {
    const commentWithQuote = {
      body:
        "[ABCC_FIXED_abc] 已修复\n\n> [ABCC_CLOSE] 旧评论引用",
      created_at: "2026-08-12T10:00:00Z",
    };
    expect(resolveLatestTagAction([commentWithQuote])).toBeNull();
  });
});

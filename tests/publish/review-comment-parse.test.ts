import { describe, expect, test } from "bun:test";
import { parseReviewCommentBody } from "../../app/routes/resreview/utils/comment";

/**
 * 回归：[ABCC_CLOSE] / [ABCC_REFUSE] 由审核动作直接发出，正文里没有 _tagId。
 * 之前的标签正则强制要求 tagId，导致这两类标签既拿不到 tagType 也拿不到
 * tagId，正文里的 `[ABCC_CLOSE]` 会原样显示，CLOSE/REFUSE 的信箱通知也无从检测。
 * 同时要保证 `[ABCC_NEEDFIX_xxx]` 不会被惰性/贪婪匹配拆错。
 */
describe("审核标签解析", () => {
  test("不带 tagId 的 CLOSE / REFUSE 也能解析出标签与正文", () => {
    expect(parseReviewCommentBody("[ABCC_CLOSE] 该 PR 已由审核成员关闭。")).toEqual({
      tagType: "CLOSE",
      tagId: "",
      replyTarget: "",
      replyExcerpt: "",
      content: "该 PR 已由审核成员关闭。",
    });
    expect(parseReviewCommentBody("[ABCC_REFUSE] 不符合社区收录规范")).toEqual({
      tagType: "REFUSE",
      tagId: "",
      replyTarget: "",
      replyExcerpt: "",
      content: "不符合社区收录规范",
    });
  });

  test("带 tagId 的标签解析结果不变", () => {
    expect(parseReviewCommentBody("[ABCC_NEEDFIX_a1b2c3] 头图质量过低")).toEqual({
      tagType: "NEEDFIX",
      tagId: "a1b2c3",
      replyTarget: "",
      replyExcerpt: "",
      content: "头图质量过低",
    });
    expect(parseReviewCommentBody("[ABCC_FIXED_a1b2c3] 已修复")).toEqual({
      tagType: "FIXED",
      tagId: "a1b2c3",
      replyTarget: "",
      replyExcerpt: "",
      content: "已修复",
    });
  });

  test("无标签的普通评论保持原样", () => {
    expect(parseReviewCommentBody("随便说两句")).toEqual({
      tagType: "",
      tagId: "",
      replyTarget: "",
      replyExcerpt: "",
      content: "随便说两句",
    });
  });
});

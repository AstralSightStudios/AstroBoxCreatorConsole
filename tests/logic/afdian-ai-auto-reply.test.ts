import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { AfdianMessage } from "../../app/api/afdian-messages";
import type { AfdianAiAutoReplyConfig } from "../../app/config/afdianAiAutoReply";
import {
  AI_REPLY_DISCLAIMER,
  buildOfficialDocsSearchQuery,
  buildAfdianAiMessages,
  finalizeAutoReply,
  findKeywordReply,
  generateAfdianAiReply,
  getTrailingInboundText,
  matchesLatestAfdianMessage,
} from "../../app/logic/afdian/ai-auto-reply";
import {
  beginAfdianAiReplyGeneration,
  getAfdianAiReplyActivitySnapshot,
} from "../../app/logic/afdian/ai-reply-activity";
import { redactText } from "../../app/logic/logging/mask";

function message(
  id: string,
  direction: "send" | "receive",
  content: unknown,
  sentAt: string,
  messageType = 1,
): AfdianMessage {
  return { id, direction, content, sentAt, messageType };
}

const config: AfdianAiAutoReplyConfig = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  model: "test-model",
  instructions: "保持简洁。",
  keywordRules: [],
};

describe("爱发电 AI 自动回复", () => {
  test("按顺序和匹配模式选择第一条固定回复", () => {
    const rules = [
      {
        id: "disabled",
        enabled: false,
        keywords: ["授权"],
        matchMode: "any" as const,
        reply: "不应命中",
      },
      {
        id: "all",
        enabled: true,
        keywords: ["授权", "失败"],
        matchMode: "all" as const,
        reply: "请发送订单号。",
      },
      {
        id: "any",
        enabled: true,
        keywords: ["失败"],
        matchMode: "any" as const,
        reply: "备用回复",
      },
    ];

    expect(findKeywordReply("我的授权失败了", rules)).toBe(
      "请发送订单号。",
    );
  });

  test("完全匹配会忽略大小写和全半角差异", () => {
    expect(
      findKeywordReply("ＡＢＣ", [
        {
          id: "exact",
          enabled: true,
          keywords: ["abc"],
          matchMode: "exact",
          reply: "命中",
        },
      ]),
    ).toBe("命中");
  });

  test("固定回复的免责声明始终只保留一次", () => {
    expect(finalizeAutoReply("你好")).toBe(
      `你好\n\n${AI_REPLY_DISCLAIMER}`,
    );
    expect(
      finalizeAutoReply(`你好\n\n${AI_REPLY_DISCLAIMER}\n${AI_REPLY_DISCLAIMER}`),
    ).toBe(`你好\n\n${AI_REPLY_DISCLAIMER}`);
  });

  test("只聚合最后一段连续的收到文本", () => {
    const messages = [
      message("1", "receive", "旧问题", "2026-09-08T10:00:00+08:00"),
      message("2", "send", "旧回复", "2026-09-08T10:01:00+08:00"),
      message("3", "receive", "新问题一", "2026-09-08T10:02:00+08:00"),
      message("4", "receive", "新问题二", "2026-09-08T10:03:00+08:00"),
    ];

    expect(getTrailingInboundText(messages)).toBe("新问题一\n新问题二");
    expect(buildAfdianAiMessages(messages).map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
    ]);
  });

  test("发送前会确认生成所依据的消息仍是最新消息", () => {
    const messages = [
      message("1", "receive", "旧问题", "2026-09-08T10:00:00+08:00"),
      message("2", "send", "最近回复", "2026-09-08T10:01:00+08:00"),
    ];

    expect(matchesLatestAfdianMessage(messages, "1")).toBe(false);
    expect(matchesLatestAfdianMessage(messages, "2")).toBe(true);
  });

  test("AI 生成内容在返回前强制追加免责声明", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "可以，请把订单号发给我。" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 8, text: 8, reasoning: 0 },
        },
        warnings: [],
      },
    });

    const reply = await generateAfdianAiReply({
      config,
      messages: [
        message("1", "receive", "如何查询订单？", "2026-09-08T10:00:00+08:00"),
      ],
      model,
    });

    expect(reply).toBe(`可以，请把订单号发给我。\n\n${AI_REPLY_DISCLAIMER}`);
  });

  test("日志文本会对 OpenAI 格式的 API Key 脱敏", () => {
    const secret = "sk-example-secret-value-1234";
    const redacted = redactText(`request failed: ${secret}`);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("1234");
  });

  test("文档搜索词会移除链接和敏感标识", () => {
    const query = buildOfficialDocsSearchQuery(
      "安装失败，订单号 123456789，邮箱 user@example.com，详情 https://example.com/a",
    );

    expect(query).toBe("安装失败，订单号 ，邮箱 ，详情");
  });

  test("生成状态会在开始和结束时同步", () => {
    const userId = "ai-generation-status-test";
    const stopGeneration = beginAfdianAiReplyGeneration(userId);

    expect(
      getAfdianAiReplyActivitySnapshot().generatingUserIds,
    ).toContain(userId);

    stopGeneration();
    stopGeneration();

    expect(
      getAfdianAiReplyActivitySnapshot().generatingUserIds,
    ).not.toContain(userId);
  });
});

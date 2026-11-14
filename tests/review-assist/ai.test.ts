import { describe, expect, test } from "bun:test";
import {
  buildReviewAiRequest,
  composeAiIssueReply,
  describeReviewAiError,
  formatReviewAiUsage,
  summarizeChecks,
  summarizeThread,
  type ReviewAiImage,
  type ReviewAiResourceSource,
} from "../../app/logic/review-assist/ai";
import { indexGuidelines } from "../../app/logic/review-assist/guidelines";

const CONTENT = "https://abox.run/docs/creator-tools/resource-std/content";

const index = indexGuidelines({
  documents: [
    {
      id: "content",
      title: "资源内容规范",
      description: "",
      url: CONTENT,
      root: {
        ref: "content",
        number: null,
        title: "资源内容规范",
        text: "",
        url: CONTENT,
        children: [
          {
            ref: "4",
            number: "4",
            title: "设计",
            text: "",
            url: `${CONTENT}#4-设计`,
            children: [
              {
                ref: "4.5",
                number: "4.5",
                title: "设计质量",
                text: "视觉质量是审核的一部分。",
                url: `${CONTENT}#45-设计质量`,
                children: [],
              },
            ],
          },
        ],
      },
    },
  ],
});

function resource(over: Partial<ReviewAiResourceSource> = {}): ReviewAiResourceSource {
  return {
    entry: {
      id: "com.example.app",
      name: "示例应用",
      restype: "quick_app",
      repo_owner: "creator",
      repo_name: "example-release",
      repo_commit_hash: "c".repeat(40),
      tags: "工具; 计时 ;;<__NSFW__>",
      devices: "xmb9p;xmb10",
      paid_type: "free",
    },
    ref: "main",
    request: { mode: "edit" },
    manifest: {
      item: {
        description: "一个计时器。",
        author: [{ name: "creator", bindABAccount: true }, { name: "helper" }],
      },
      links: [{ title: "主页", url: "https://example.com", icon: "house" }, { title: "反馈" }],
      ext: {
        nsfw: { reason: "恐怖元素" },
        trialDownloads: { xmb9p: { version: "1.0.0", file_name: "trial.rpk" } },
        wallpaperGenerator: { configUrl: "https://example.com/w.json" },
      },
    },
    packages: [
      {
        kind: "正式包",
        deviceId: "xmb9p",
        version: "1.1.0",
        fileName: "downloads/app.rpk",
        versionCode: 3,
        updateLogs: [{ version: "1.1.0", content: "修复计时误差" }],
      },
      { kind: "试用包", deviceId: "xmb10", version: "1.1.0", fileName: "trial/app.rpk" },
    ],
    ...over,
  };
}

const cover: ReviewAiImage = { role: "cover", mime: "image/jpeg", data: "Q09WRVI=", note: "1200×800" };

describe("AI review request", () => {
  test("a submission is flattened into what the server expects", () => {
    const request = buildReviewAiRequest({
      model: "anthropic/claude-sonnet-5.5",
      pull: { number: 2183, title: "[ABCC] Update resource: 示例应用", user: { login: "creator" } },
      resource: resource({
        baseEntry: {
          id: "com.example.app",
          name: "示例",
          restype: "quick_app",
          repo_owner: "creator",
          repo_name: "example-release",
          repo_commit_hash: "b".repeat(40),
          tags: "工具",
          devices: "xmb9p",
          paid_type: "free",
        },
      }),
      images: [cover],
      instruction: "  重点看封面  ",
    });

    expect(request.model).toBe("anthropic/claude-sonnet-5.5");
    expect(request.pr).toEqual({
      number: 2183,
      title: "[ABCC] Update resource: 示例应用",
      author: "creator",
      mode: "edit",
    });
    expect(request.resource).toEqual({
      id: "com.example.app",
      name: "示例应用",
      restype: "quick_app",
      description: "一个计时器。",
      tags: ["工具", "计时", "<__NSFW__>"],
      paidType: "free",
      authors: [
        { name: "creator", bindABAccount: true },
        { name: "helper", bindABAccount: false },
      ],
      links: [
        { title: "主页", url: "https://example.com", icon: "house" },
        { title: "反馈", url: "", icon: "" },
      ],
      devices: ["xmb9p", "xmb10"],
      downloads: [
        {
          device: "xmb9p",
          kind: "正式包",
          version: "1.1.0",
          versionCode: 3,
          fileName: "downloads/app.rpk",
          updateLog: "1.1.0: 修复计时误差",
        },
        { device: "xmb10", kind: "试用包", version: "1.1.0", fileName: "trial/app.rpk" },
      ],
      // 试用包与壁纸配置对判断没有帮助，不带
      ext: JSON.stringify({ nsfw: { reason: "恐怖元素" } }),
      repo: "creator/example-release",
      revision: "c".repeat(40),
    });
    expect(request.previous).toEqual({
      id: "com.example.app",
      name: "示例",
      restype: "quick_app",
      tags: ["工具"],
      paidType: "free",
      devices: ["xmb9p"],
    });
    expect(request.images).toEqual([cover]);
    expect(request.instruction).toBe("重点看封面");
    expect("checks" in request).toBe(false);
    expect("thread" in request).toBe(false);
  });

  test("a new submission without a manifest still produces a valid request", () => {
    const request = buildReviewAiRequest({
      model: "google/gemini-4-carbon",
      pull: { number: 7, title: "t" },
      resource: resource({ manifest: undefined, request: undefined, packages: [] }),
      images: [],
    });
    expect(request.pr).toEqual({ number: 7, title: "t" });
    expect(request.resource.description).toBe("");
    expect(request.resource.authors).toEqual([]);
    expect(request.resource.links).toEqual([]);
    expect("ext" in request.resource).toBe(false);
    expect("previous" in request).toBe(false);
    expect("instruction" in request).toBe(false);
  });

  test("fields are cut to the server's limits instead of failing the request", () => {
    const base = resource();
    const request = buildReviewAiRequest({
      model: "m",
      pull: { number: 1, title: "x".repeat(900) },
      resource: resource({
        entry: { ...base.entry, tags: Array.from({ length: 90 }, (_, i) => `tag${i}`).join(";") },
        manifest: {
          item: { description: "长".repeat(9000) },
          ext: { huge: "x".repeat(7000) },
        },
      }),
      images: [],
      instruction: "y".repeat(3000),
    });
    expect(request.pr.title).toHaveLength(300);
    expect(request.resource.tags).toHaveLength(60);
    expect(request.resource.description).toHaveLength(8000);
    expect(request.instruction).toHaveLength(1000);
    // 截断的 JSON 没法解析，超限的 ext 整个不带
    expect("ext" in request.resource).toBe(false);
  });

  test("the branch ref stands in for a missing commit hash", () => {
    const base = resource();
    const request = buildReviewAiRequest({
      model: "m",
      pull: { number: 1, title: "t" },
      resource: resource({ entry: { ...base.entry, repo_commit_hash: " " }, ref: "astrobox-submit-1" }),
      images: [],
    });
    expect(request.resource.revision).toBe("astrobox-submit-1");
  });
});

describe("auto check summary", () => {
  test("only the checks that need attention are listed; passes are counted", () => {
    expect(
      summarizeChecks([
        { title: "封面比例", status: "fail", detail: "实际 1.33" },
        { title: "图标比例", status: "pass", detail: "1:1" },
        { title: "包名一致", status: "warn", detail: "读不到包名" },
        { title: "链接有效", status: "pass", detail: "" },
        { title: "人工确认", status: "manual", detail: "模块需人工审计" },
      ]),
    ).toEqual([
      { title: "封面比例", status: "fail", detail: "实际 1.33" },
      { title: "包名一致", status: "warn", detail: "读不到包名" },
      { title: "人工确认", status: "manual", detail: "模块需人工审计" },
      { title: "其余自动检查", status: "pass", detail: "另有 2 项自动检查通过。" },
    ]);
    expect(summarizeChecks([])).toBeUndefined();
    expect(summarizeChecks(undefined)).toBeUndefined();
  });

  test("the list never exceeds what the server accepts", () => {
    const checks = Array.from({ length: 200 }, (_, i) => ({
      title: `检查 ${i}`,
      status: "fail" as const,
      detail: "d".repeat(5000),
    }));
    const summary = summarizeChecks(checks)!;
    expect(summary.length).toBeLessThanOrEqual(80);
    expect(summary[0].detail).toHaveLength(1200);
  });
});

describe("review thread summary", () => {
  test("comments are ordered by time and tagged with who wrote them", () => {
    const thread = summarizeThread(
      [
        { body: "[ABCC_FIXED_a1] 已修复", created_at: "2026-11-14T03:00:00Z", user: { login: "Creator" } },
        { body: "[ABCC_NEEDFIX_a1] 封面比例不对", created_at: "2026-11-14T01:00:00Z", user: { login: "reviewer-a" } },
        { body: "   ", created_at: "2026-11-14T02:00:00Z", user: { login: "reviewer-a" } },
        { body: "路过支持一下", created_at: "2026-11-14T02:30:00Z", user: { login: "passerby" } },
      ],
      { prAuthor: "creator", reviewers: new Set(["reviewer-a"]) },
    );
    expect(thread).toEqual([
      { author: "reviewer-a", role: "reviewer", at: "2026-11-14T01:00:00Z", body: "[ABCC_NEEDFIX_a1] 封面比例不对" },
      { author: "passerby", role: "other", at: "2026-11-14T02:30:00Z", body: "路过支持一下" },
      { author: "Creator", role: "creator", at: "2026-11-14T03:00:00Z", body: "[ABCC_FIXED_a1] 已修复" },
    ]);
  });

  test("only the most recent comments are kept", () => {
    const comments = Array.from({ length: 60 }, (_, i) => ({
      body: `comment ${i}`,
      created_at: `2026-11-14T00:${String(i).padStart(2, "0")}:00Z`,
      user: { login: "creator" },
    }));
    const thread = summarizeThread(comments, { prAuthor: "creator" })!;
    expect(thread).toHaveLength(40);
    expect(thread[0].body).toBe("comment 20");
    expect(thread[39].body).toBe("comment 59");
    expect(summarizeThread([], {})).toBeUndefined();
  });
});

describe("AI issue replies", () => {
  test("a must-fix issue cites the rule as violated", () => {
    const { text, missing } = composeAiIssueReply(
      {
        title: "封面粗糙",
        severity: "must_fix",
        target: "cover",
        rules: ["4.5", "9.9"],
        comment: "封面文字过小，缩略后看不清，建议放大资源名称。",
      },
      index,
    );
    expect(text).toBe(
      `不符合[准则 4.5 设计质量](${CONTENT}#45-设计质量)：\n\n> 视觉质量是审核的一部分。\n\n封面文字过小，缩略后看不清，建议放大资源名称。`,
    );
    expect(missing).toEqual(["9.9"]);
  });

  test("a suggestion is marked as optional and cites the rule as reference", () => {
    const { text } = composeAiIssueReply(
      { title: "可以更好", severity: "suggestion", target: "cover", rules: ["4.5"], comment: "截图可以再放大一些。" },
      index,
    );
    expect(text.startsWith("请参考[准则 4.5 设计质量]")).toBe(true);
    expect(text.endsWith("截图可以再放大一些。\n\n非强制。")).toBe(true);
    // 模型自己写了就不重复加
    const already = composeAiIssueReply(
      { title: "t", severity: "suggestion", target: "cover", rules: [], comment: "截图可以再放大一些，非强制。" },
      index,
    );
    expect(already.text).toBe("截图可以再放大一些，非强制。");
  });
});

describe("AI run presentation", () => {
  test("server error codes become readable messages", () => {
    expect(describeReviewAiError("ai_daily_limit")).toBe("今天的生成次数已用完。");
    expect(describeReviewAiError("ai_timeout")).toContain("超时");
    expect(describeReviewAiError("something_new")).toBe("生成失败（something_new）。");
    expect(describeReviewAiError(null)).toBe("生成失败，请重试。");
  });

  test("usage shows tokens and cost at a glance", () => {
    expect(
      formatReviewAiUsage({ promptTokens: 12345, completionTokens: 678, cachedTokens: 9000, cost: 0.0312 }),
    ).toBe("输入 12,345 tok · 其中缓存 9,000 · 输出 678 tok · $0.031");
    expect(
      formatReviewAiUsage({ promptTokens: 900, completionTokens: 50, cachedTokens: 0, cost: 0.0021 }),
    ).toBe("输入 900 tok · 输出 50 tok · $0.0021");
    expect(
      formatReviewAiUsage({ promptTokens: 900, completionTokens: 50, cachedTokens: 0, cost: null }),
    ).toBe("输入 900 tok · 输出 50 tok");
  });
});

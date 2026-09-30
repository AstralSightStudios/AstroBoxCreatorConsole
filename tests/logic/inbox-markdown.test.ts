import { describe, expect, test } from "bun:test";
import { renderInboxMarkdownHtml } from "../../app/logic/inbox/markdown";

/**
 * 回归：markdown-it 的 renderer.rules 覆写必须在**注册时**捕获原规则。
 * 如果返回的函数在运行时才去读 `markdown.renderer.rules[ruleName]`，那个槽位
 * 已经是本函数自己，任何非空正文都会无限递归，抛
 * "Maximum call stack size exceeded" 并被错误边界拦下（整个信箱打不开）。
 */
describe("信箱 Markdown 渲染", () => {
  test("任意非空输入都不会递归爆栈", () => {
    const sources = [
      "hello",
      "两段\n\n正文",
      "- x\n- y",
      "1. a\n2. b",
      "[链接](https://example.com)",
      "> 引用",
      "```\ncode\n```",
      "行内 `code`",
      "***",
      "| a | b |\n| - | - |\n| 1 | 2 |",
    ];
    for (const source of sources) {
      expect(() => renderInboxMarkdownHtml(source)).not.toThrow();
    }
  });

  test("空输入返回空串", () => {
    expect(renderInboxMarkdownHtml("")).toBe("");
    expect(renderInboxMarkdownHtml("   \n  ")).toBe("");
  });

  test("段落无外边距、可换行、不断词", () => {
    expect(renderInboxMarkdownHtml("正文")).toContain(
      'class="my-0 whitespace-pre-wrap break-words"',
    );
    // 收标签不应留下空 class
    expect(renderInboxMarkdownHtml("正文")).not.toContain('class=""');
  });

  test("链接新窗口打开并用信箱装饰线", () => {
    const html = renderInboxMarkdownHtml("[链接](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("underline");
    expect(html).toContain("var(--inbox-link-decoration)");
    expect(html).toContain("underline-offset-4");
  });

  test("列表与引用沿用 AstroBox 端排版", () => {
    expect(renderInboxMarkdownHtml("- x")).toContain("list-disc");
    expect(renderInboxMarkdownHtml("1. x")).toContain("list-decimal");
    expect(renderInboxMarkdownHtml("> x")).toContain(
      "border-l-2 border-white/25",
    );
  });

  test("原始 HTML 被转义而不是注入", () => {
    const html = renderInboxMarkdownHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

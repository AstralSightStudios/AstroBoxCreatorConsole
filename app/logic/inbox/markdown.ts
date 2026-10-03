import MarkdownIt from "markdown-it";

/**
 * 信箱消息正文渲染。
 *
 * AstroBox 端 `web/src/components/inbox/MarkdownBody.tsx` 走 remark 管线，
 * 对 `p` / `a` 覆写了组件，段落不带外边距、链接用 `--inbox-link-decoration`
 * 装饰线；其余元素复用 `logic/remarkRender.tsx` 的默认组件。这里用已有的
 * markdown-it 复刻同一套排版，使两端信箱的展开态正文视觉一致。
 */

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});

type RenderRule = (
  tokens: any[],
  idx: number,
  options: any,
  env: unknown,
  self: any,
) => string;

/**
 * 注册带 class 的开标签规则。
 *
 * **必须在注册时就把原规则捕获下来**，不能在返回的函数里再去读
 * `markdown.renderer.rules[key]`：赋值完成后那个槽位就是本函数自己，
 * 运行时再查会无限自我递归（表现为渲染任何正文都抛
 * "Maximum call stack size exceeded"，进而被错误边界拦下）。
 */
function withClass(
  ruleName: string,
  className: string,
  extra?: (tokens: any[], idx: number) => void,
): RenderRule {
  const previous = markdown.renderer.rules[ruleName];
  return (tokens, idx, options, env, self) => {
    if (className) tokens[idx].attrJoin("class", className);
    extra?.(tokens, idx);
    if (previous) return previous(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
  };
}

const PARAGRAPH_CLASS = "my-0 whitespace-pre-wrap break-words";
const LINK_CLASS =
  "underline decoration-[var(--inbox-link-decoration)] underline-offset-4";
const LIST_CLASS = "m-0 list-disc space-y-1 pl-4";
const ORDERED_LIST_CLASS = "m-0 list-decimal space-y-1 pl-4";
const BLOCKQUOTE_CLASS = "m-0 border-l-2 border-white/25 pl-3 opacity-80";

markdown.renderer.rules.paragraph_open = withClass(
  "paragraph_open",
  PARAGRAPH_CLASS,
);
markdown.renderer.rules.paragraph_close = withClass("paragraph_close", "");

markdown.renderer.rules.link_open = withClass("link_open", LINK_CLASS, (tokens, idx) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noreferrer");
});

markdown.renderer.rules.code_inline = (tokens, idx) =>
  `<code class="rounded bg-black/16 px-1 py-0.5 text-sm">${markdown.utils.escapeHtml(
    tokens[idx].content,
  )}</code>`;

markdown.renderer.rules.fence = (tokens, idx) =>
  `<pre class="my-2 max-w-full overflow-x-auto rounded-lg bg-black/16 p-3"><code>${markdown.utils.escapeHtml(
    tokens[idx].content,
  )}</code></pre>`;

markdown.renderer.rules.code_block = markdown.renderer.rules.fence;

markdown.renderer.rules.bullet_list_open = withClass(
  "bullet_list_open",
  LIST_CLASS,
);
markdown.renderer.rules.bullet_list_close = withClass("bullet_list_close", "");
markdown.renderer.rules.ordered_list_open = withClass(
  "ordered_list_open",
  ORDERED_LIST_CLASS,
);
markdown.renderer.rules.ordered_list_close = withClass("ordered_list_close", "");
markdown.renderer.rules.list_item_open = withClass("list_item_open", "break-words");
markdown.renderer.rules.list_item_close = withClass("list_item_close", "");

markdown.renderer.rules.blockquote_open = withClass(
  "blockquote_open",
  BLOCKQUOTE_CLASS,
);
markdown.renderer.rules.blockquote_close = withClass("blockquote_close", "");

markdown.renderer.rules.hr = () => '<hr class="my-4 border-white/10">';

export function renderInboxMarkdownHtml(source: string): string {
  const input = (source || "").replace(/\r\n/g, "\n");
  if (!input.trim()) return "";
  return markdown.render(input);
}

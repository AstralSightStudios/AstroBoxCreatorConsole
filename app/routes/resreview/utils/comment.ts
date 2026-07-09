import MarkdownIt from "markdown-it";

export interface ParsedReviewComment {
  tagType: "NEEDFIX" | "FIXED" | "";
  tagId: string;
  replyTarget: string;
  replyExcerpt: string;
  content: string;
}

const COMMENT_TAG_PATTERN = /^\s*\[ABCC_([A-Z_]+)_([^\]]+)\]\s*([\s\S]*)$/i;
const LEADING_TAG_PATTERN = /^\s*\[ABCC_(?:[A-Z_]+)_[^\]]+\]\s*/i;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: unknown, self: any) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  tokens[idx].attrSet("class", "text-white/80 underline underline-offset-2");
  if (defaultLinkOpen) {
    return defaultLinkOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const defaultParagraphOpen = markdown.renderer.rules.paragraph_open;
markdown.renderer.rules.paragraph_open = (tokens: any[], idx: number, options: any, env: unknown, self: any) => {
  tokens[idx].attrJoin("class", "my-1");
  if (defaultParagraphOpen) {
    return defaultParagraphOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.code_block = (tokens: any[], idx: number) => {
  const content = tokens[idx].content || "";
  return `<pre class="my-2 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-2.5 text-xs"><code>${escapeHtml(content)}</code></pre>`;
};

markdown.renderer.rules.fence = (tokens: any[], idx: number) => {
  const info = (tokens[idx].info || "").trim().split(/\s+/)[0];
  const langAttr = info ? ` data-lang="${escapeHtml(info)}"` : "";
  return `<pre class="my-2 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-2.5 text-xs"><code${langAttr}>${escapeHtml(tokens[idx].content || "")}</code></pre>`;
};

const defaultBulletListOpen = markdown.renderer.rules.bullet_list_open;
markdown.renderer.rules.bullet_list_open = (tokens: any[], idx: number, options: any, env: unknown, self: any) => {
  tokens[idx].attrJoin("class", "my-1 list-disc pl-5");
  if (defaultBulletListOpen) {
    return defaultBulletListOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const defaultOrderedListOpen = markdown.renderer.rules.ordered_list_open;
markdown.renderer.rules.ordered_list_open = (tokens: any[], idx: number, options: any, env: unknown, self: any) => {
  tokens[idx].attrJoin("class", "my-1 list-decimal pl-5");
  if (defaultOrderedListOpen) {
    return defaultOrderedListOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const defaultBlockquoteOpen = markdown.renderer.rules.blockquote_open;
markdown.renderer.rules.blockquote_open = (tokens: any[], idx: number, options: any, env: unknown, self: any) => {
  tokens[idx].attrJoin("class", "my-2 border-l-2 border-white/20 pl-3 text-white/50");
  if (defaultBlockquoteOpen) {
    return defaultBlockquoteOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

export function renderCommentMarkdownHtml(source: string): string {
  const input = (source || "").replace(/\r\n/g, "\n");
  if (!input.trim()) return "";
  return markdown.render(input);
}

export function renderCommentMarkdownInlineHtml(source: string): string {
  const html = renderCommentMarkdownHtml(source).trim();
  if (!html) return "";
  const singleParagraph = html.match(/^<p(?:\s+[^>]*)?>([\s\S]*)<\/p>$/);
  return singleParagraph ? singleParagraph[1] : html;
}

export function parseReviewCommentBody(body: string): ParsedReviewComment {
  const normalized = body || "";
  const tagMatch = normalized.match(COMMENT_TAG_PATTERN);
  const rawTagType = (tagMatch?.[1] || "").toUpperCase();
  const tagType: "NEEDFIX" | "FIXED" | "" =
    rawTagType === "NEEDFIX" || rawTagType === "FIXED" ? rawTagType : "";
  const tagId = tagMatch?.[2]?.trim() || "";
  const rawContent = (tagMatch?.[3] || normalized).trim();
  const normalizedContent = rawContent.replace(LEADING_TAG_PATTERN, "").trim();

  const targetMatch = normalizedContent.match(/^\s*>\s*Reply-To:\s*(.+)$/m);
  if (!targetMatch) {
    return {
      tagType,
      tagId,
      replyTarget: "",
      replyExcerpt: "",
      content: normalizedContent,
    };
  }

  const replyTarget = targetMatch[1].trim();
  const lines = normalizedContent.split("\n");
  const filtered: string[] = [];
  let replyExcerpt = "";
  let consumeNextQuote = false;

  for (const line of lines) {
    if (/^\s*>\s*Reply-To:\s*/.test(line)) {
      consumeNextQuote = true;
      continue;
    }
    if (consumeNextQuote && /^\s*>\s*/.test(line)) {
      replyExcerpt = line.replace(/^\s*>\s*/, "").trim();
      consumeNextQuote = false;
      continue;
    }
    filtered.push(line);
  }

  return {
    tagType,
    tagId,
    replyTarget,
    replyExcerpt,
    content: filtered.join("\n").trim(),
  };
}

export function formatRelativeTime(value?: string): string {
  if (!value) return "commented just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "commented just now";
  const diffMs = Date.now() - date.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (absMs < minute) return "commented just now";
  if (absMs < hour) {
    const amount = Math.max(1, Math.round(absMs / minute));
    return `commented ${amount} minute${amount > 1 ? "s" : ""} ago`;
  }
  if (absMs < day) {
    const amount = Math.max(1, Math.round(absMs / hour));
    return `commented ${amount} hour${amount > 1 ? "s" : ""} ago`;
  }
  if (absMs < month) {
    const amount = Math.max(1, Math.round(absMs / day));
    return `commented ${amount} day${amount > 1 ? "s" : ""} ago`;
  }
  if (absMs < year) {
    const amount = Math.max(1, Math.round(absMs / month));
    return `commented ${amount} month${amount > 1 ? "s" : ""} ago`;
  }
  const amount = Math.max(1, Math.round(absMs / year));
  return `commented ${amount} year${amount > 1 ? "s" : ""} ago`;
}

export function buildReplyBody(targetLogin: string, targetCommentId: number, excerpt: string, reply: string): string {
  const quote = excerpt.length > 120 ? excerpt.slice(0, 120) + "..." : excerpt;
  return `> Reply-To: @${targetLogin} #${targetCommentId}\n> ${quote}\n\n${reply}`;
}

const isLongText = (text: string): boolean => (text || "").length > 360 || (text || "").split("\n").length > 8;

export const isLongContent = (parsed?: ParsedReviewComment): boolean => isLongText(parsed?.content || "");

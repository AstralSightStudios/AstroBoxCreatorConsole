/**
 * 审核准则的条款树，以及把条款引用进评论的排版规则。
 *
 * 条款树由服务端从文档内容仓实时解析（`/admin/review/guidelines`），和 abox.run 上看到的是
 * 同一份内容。节点的 `ref` 是引用键：资源内容规范里带编号的条款直接用编号（"2.6.2"），
 * 其余用 `<文档 id>#<锚点>`（"info#封面"），文档本身用文档 id（"rate"）。预制回复与 AI 草稿
 * 里存的都是引用键，发评论时再按当前文档展开，所以文档改了措辞引用会自动跟着变。
 */

export interface GuidelineNode {
  ref: string;
  /** 条款编号；没有编号的章节为 null */
  number: string | null;
  title: string;
  /** 本节点自己的正文（Markdown），不含子节点 */
  text: string;
  /** 文档站上的地址，带锚点 */
  url: string;
  children: GuidelineNode[];
}

export interface GuidelineDocument {
  id: string;
  title: string;
  description: string;
  url: string;
  root: GuidelineNode;
}

export interface ReviewGuidelines {
  /** 文档内容仓的 commit */
  revision: string;
  fetchedAt: string;
  /** 服务端这次没连上 GitHub，给的是上一次读到的内容 */
  stale: boolean;
  documents: GuidelineDocument[];
}

export interface GuidelineEntry {
  node: GuidelineNode;
  document: GuidelineDocument;
  /** 从文档根（不含）到本节点父级的各级标题节点 */
  ancestors: GuidelineNode[];
}

export type GuidelineIndex = Map<string, GuidelineEntry>;

export function indexGuidelines(
  guidelines: Pick<ReviewGuidelines, "documents"> | null | undefined,
): GuidelineIndex {
  const index: GuidelineIndex = new Map();
  for (const document of guidelines?.documents ?? []) {
    const walk = (node: GuidelineNode, ancestors: GuidelineNode[]) => {
      index.set(node.ref, { node, document, ancestors });
      const next = node === document.root ? [] : [...ancestors, node];
      node.children.forEach((child) => walk(child, next));
    };
    walk(document.root, []);
  }
  return index;
}

/** 条款是不是「x.y.z」这种最细一级的编号条款（正文以列表项形式写在小节里）。 */
function isLeafRule(entry: GuidelineEntry): boolean {
  const parent = entry.ancestors[entry.ancestors.length - 1];
  return Boolean(
    entry.node.number &&
      parent?.number &&
      entry.node.number.startsWith(`${parent.number}.`) &&
      entry.node.url === parent.url,
  );
}

/**
 * 条款的称呼：
 * - 编号条款：「准则 2.6.2（打包要求）」「准则 4.5 设计质量」；
 * - 没有编号的章节：「《资源基本信息规范》· 封面 · 硬性要求」；
 * - 整篇文档：「《资源比例要求》」。
 */
export function guidelineLabel(entry: GuidelineEntry): string {
  const { node, document, ancestors } = entry;
  if (node.number) {
    return isLeafRule(entry)
      ? `准则 ${node.number}（${node.title}）`
      : `准则 ${node.number} ${node.title}`;
  }
  if (node === document.root) return `《${document.title}》`;
  const path = [...ancestors.filter((item) => !item.number), node]
    .map((item) => item.title)
    .join(" · ");
  return `《${document.title}》· ${path}`;
}

const QUOTE_SOFT_LIMIT = 420;

function isTableOrFence(paragraph: string): boolean {
  const first = paragraph.trimStart();
  return first.startsWith("|") || first.startsWith("```") || first.startsWith("~~~");
}

/**
 * 引用块里放的原文。编号条款很短，原样引用；整节、整篇这类长内容只取开头几段
 * （表格、代码块不进引用，GitHub 的引用块里它们排不好），其余靠链接。
 */
export function guidelineQuote(entry: GuidelineEntry): string {
  const { node } = entry;
  if (isLeafRule(entry)) return `**${node.number}** ${node.text}`.trim();

  const paragraphs = node.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  // 小节自己没有正文、全是编号条款（例如 4.6）：引用它下面的各条
  const ruleLines = node.children
    .filter((child) => child.number && child.url === node.url)
    .map((child) => `**${child.number}** ${child.text}`.trim());

  const picked: string[] = [];
  let length = 0;
  let truncated = false;
  for (const paragraph of [...paragraphs, ...ruleLines]) {
    if (isTableOrFence(paragraph)) {
      truncated = true;
      continue;
    }
    if (picked.length > 0 && length + paragraph.length > QUOTE_SOFT_LIMIT) {
      truncated = true;
      break;
    }
    picked.push(paragraph);
    length += paragraph.length;
  }
  if (picked.length === 0) return "";
  return truncated ? `${picked.join("\n\n")}\n\n……` : picked.join("\n\n");
}

function blockquote(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** 「违反了这一条」还是「请参考这一条」 */
export type CitationMode = "violation" | "reference";

const CITATION_LEAD: Record<CitationMode, string> = {
  violation: "不符合",
  reference: "请参考",
};

/**
 * 一条引用：一句带链接的引导语，下面跟原文引用块。
 *
 * ```
 * 不符合[准则 2.6.2（打包要求）](https://abox.run/…#26-打包要求)：
 *
 * > **2.6.2** 快应用不接收 Debug 包体。…
 * ```
 */
export function formatCitation(entry: GuidelineEntry, mode: CitationMode): string {
  const lead = `${CITATION_LEAD[mode]}[${guidelineLabel(entry)}](${entry.node.url})`;
  const quote = guidelineQuote(entry);
  return quote ? `${lead}：\n\n${blockquote(quote)}` : `${lead}。`;
}

export function resolveGuidelineRefs(
  index: GuidelineIndex,
  refs: readonly string[],
): { entries: GuidelineEntry[]; missing: string[] } {
  const entries: GuidelineEntry[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const entry = index.get(ref);
    if (entry) entries.push(entry);
    else missing.push(ref);
  }
  return { entries, missing };
}

/**
 * 一条完整的审核回复：先逐条引用准则，再接审核员自己的话。
 * 准则引用在前，创作者先看到「违反了哪一条、原文是什么」，再看具体到他这个资源的说明。
 */
export function composeReviewReply(options: {
  entries: readonly GuidelineEntry[];
  mode: CitationMode;
  body?: string;
}): string {
  const blocks = options.entries.map((entry) => formatCitation(entry, options.mode));
  const body = options.body?.trim();
  if (body) blocks.push(body);
  return blocks.join("\n\n");
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 条款搜索。输入编号（"2.6"、"4.5"）按编号前缀匹配；其余按标题与正文的包含关系匹配，
 * 多个词之间是「且」。结果按文档顺序返回。
 */
export function searchGuidelines(index: GuidelineIndex, query: string): GuidelineEntry[] {
  const normalized = normalizeQuery(query);
  const entries = [...index.values()];
  if (!normalized) return entries;

  if (/^\d+(?:\.\d*)*$/.test(normalized)) {
    const prefix = normalized.replace(/\.$/, "");
    return entries.filter(
      ({ node }) =>
        node.number !== null &&
        (node.number === prefix || node.number.startsWith(`${prefix}.`)),
    );
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = `${entry.node.number ?? ""} ${entry.node.title} ${entry.node.text} ${
      entry.document.title
    }`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** 把新内容接到编辑器已有文字后面，中间空一行；编辑器是空的就直接用新内容。 */
export function appendToDraft(current: string, addition: string): string {
  const base = current.replace(/\s+$/, "");
  const next = addition.trim();
  if (!base) return next;
  if (!next) return current;
  return `${base}\n\n${next}`;
}

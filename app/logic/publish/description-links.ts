/**
 * 资源简介中的链接检测与切分。
 *
 * 简介只用于介绍资源功能，外链通常意味着引流、广告或站外下载。审核自动检查会对
 * 简介中出现的链接给出警告，资源信息里的简介也会把链接高亮出来，方便审核员定位。
 * 发布页、审核详情与自动检查共用这里的判定，避免口径漂移。
 */

/**
 * 常见顶级域名。只检查常见 TLD 而不是任意字母后缀，避免把 `v1.2.0`、`logo.png`
 * 这类普通文本误判成链接；同时保留足够覆盖面，能识别 `example.com`、`t.cn`
 * 这类省略协议的裸域名。
 */
const COMMON_TLDS = [
  "com",
  "cn",
  "net",
  "org",
  "io",
  "co",
  "cc",
  "tv",
  "me",
  "ai",
  "app",
  "dev",
  "xyz",
  "top",
  "info",
  "biz",
  "vip",
  "club",
  "site",
  "online",
  "shop",
  "store",
  "tech",
  "link",
  "live",
  "pro",
  "fun",
  "icu",
  "ws",
  "cloud",
  "space",
  "website",
  "host",
  "press",
  "wiki",
  "blog",
  "page",
  "one",
  "run",
  "life",
  "world",
  "today",
  "news",
  "group",
  "team",
  "design",
  "art",
  "media",
  "studio",
  "email",
  "plus",
  "red",
  "ink",
  "bond",
  "best",
  "bid",
  "bio",
  "buzz",
  "chat",
  "click",
  "date",
  "download",
  "gift",
  "guru",
  "help",
  "hosting",
  "loan",
  "men",
  "mobi",
  "name",
  "party",
  "pics",
  "pink",
  "review",
  "rocks",
  "science",
  "services",
  "social",
  "solutions",
  "support",
  "systems",
  "tools",
  "trade",
  "video",
  "win",
  "work",
  "works",
  "zone",
  "asia",
  "tel",
  "travel",
  "jobs",
  "museum",
  "aero",
  "coop",
  "edu",
  "gov",
  "mil",
  "int",
  "us",
  "uk",
  "jp",
  "kr",
  "de",
  "fr",
  "ru",
  "au",
  "ca",
  "hk",
  "tw",
  "sg",
  "my",
  "id",
  "in",
  "br",
  "nz",
  "ch",
  "se",
  "no",
  "fi",
  "dk",
  "nl",
  "be",
  "es",
  "it",
  "pl",
  "pt",
  "tr",
  "ae",
  "sa",
  "za",
  "mx",
  "ar",
  "cl",
  "th",
  "vn",
  "ph",
  "eu",
  "la",
  "ly",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "pw",
  "su",
  "ua",
  "by",
  "kz",
  "ir",
  "il",
  "eg",
  "ma",
  "ng",
  "ke",
  "gh",
  "ug",
  "tz",
  "zw",
  "pk",
  "bd",
  "lk",
  "np",
  "mm",
  "kh",
  "mn",
  "mo",
];

/**
 * 链接剩余部分的字符集：遇到空白、尖括号、引号、括号或中文标点即结束。
 * 英文句号、逗号等仍允许出现在链接内部，展示前再统一裁掉末尾标点。
 */
const URL_TAIL_PATTERN = String.raw`[^\s<>"'()\[\]{}，。；：！？、]*`;

const DOMAIN_PATTERN = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${COMMON_TLDS.join("|")})(?![a-z0-9-])(?::\d{2,5})?(?:[/?#]${URL_TAIL_PATTERN})?`;

/**
 * 链接判定：
 * 1. 任意 URI 协议（http/https/ftp 等）、`www.` 或 `mailto:` 前缀；
 * 2. 裸域名（`example.com`、`t.cn/abc`）；
 * 3. 裸 IPv4（`1.2.3.4`）。
 */
const LINK_PATTERN = new RegExp(
  String.raw`(?:[a-z][a-z0-9+.-]{1,15}:\/\/|mailto:|www\.)${URL_TAIL_PATTERN}|${DOMAIN_PATTERN}|\b(?:\d{1,3}\.){3}\d{1,3}\b`,
  "gi",
);

/** 链接末尾常见的标点不属于链接本身，用于展示时切掉，避免把整句标点一起高亮。 */
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、）)\]}"'»]+$/;

export interface TextLinkSegment {
  text: string;
  link: boolean;
}

/** 把文本切成交替的普通文本与链接片段，供 React 渲染高亮。 */
export function splitTextByLinks(value: string): TextLinkSegment[] {
  const text = value || "";
  if (!text) return [];
  const segments: TextLinkSegment[] = [];
  let cursor = 0;
  // 重新构造正则，避免共享 lastIndex 在多处调用时互相干扰。
  const pattern = new RegExp(LINK_PATTERN.source, LINK_PATTERN.flags);
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? cursor;
    const raw = match[0];
    const linkText = raw.replace(TRAILING_PUNCTUATION, "");
    if (!linkText) continue;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), link: false });
    segments.push({ text: linkText, link: true });
    cursor = index + linkText.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), link: false });
  return segments;
}

/** 提取文本中的链接（去重并保持出现顺序）。 */
export function findTextLinks(value: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const segment of splitTextByLinks(value)) {
    if (!segment.link || seen.has(segment.text)) continue;
    seen.add(segment.text);
    links.push(segment.text);
  }
  return links;
}

/** 文本中是否出现疑似链接。 */
export function textContainsLink(value: string): boolean {
  return findTextLinks(value).length > 0;
}

/**
 * 把命中的链接转成可点击的 href。
 * 只放行 http/https/ftp/mailto；其他协议（例如 javascript:）返回 null，调用方
 * 应退化为高亮但不带跳转的文本，避免把不可信简介渲染成可执行链接。
 */
export function textLinkHref(value: string): string | null {
  const text = (value || "").trim();
  if (!text) return null;
  if (/^mailto:/i.test(text)) return text;
  if (/^(?:https?|ftp):\/\//i.test(text)) return text;
  // 其他未知协议不转为可点击链接。
  if (/^[a-z][a-z0-9+.-]{1,15}:\/\//i.test(text)) return null;
  if (/^www\./i.test(text)) return `https://${text}`;
  return `https://${text}`;
}

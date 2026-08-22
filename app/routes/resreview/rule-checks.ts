import { invoke } from "@tauri-apps/api/core";
import { PUBLISH_CONFIG } from "~/config/publish";
import { listRepoFileSizesAtCommit, type GithubPullFile } from "~/api/github/pr-review";
import { loadDeviceTokenResolver, type DeviceTokenResolver } from "~/logic/devices/catalog";
import { PHOSPHOR_ICON_NAMES } from "./phosphor-icons";
import {
  resolveAuthorProStatuses,
  hasCreatorPro,
  isVipActive,
  vipTierLabel,
  type AuthorProStatus,
} from "./owner-pro";
import type { PrResourcePreview, RuleCheckItem } from "./types";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { normalizeBundledResources } from "~/logic/publish/manifest";
import { fetchCatalogEntries } from "~/logic/publish/catalog";
import {
  listSellerResourceConfigs,
  listSellerResourceFileKeys,
} from "~/api/astrobox/order";
import {
  checkPaidFreeRatioForAuthor,
  type PaidRatioResult,
} from "./utils/paid-ratio";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type DetectedPackageType =
  | "watchface"
  | "quick_app"
  | "firmware"
  | "abp"
  | "zip"
  | "binary"
  | "unknown";

export interface PackageCheckResult {
  fileName: string;
  devices: string[];
  kind: "正式包" | "试用包";
  url: string;
  sizeBytes?: number;
  detectedType: DetectedPackageType;
  effectiveCategory: "watchface" | "quick_app" | "other";
  typeMatch: "match" | "mismatch" | "inconclusive";
  detectedId?: string;
  idMatch: "match" | "mismatch" | "skipped";
  error?: string;
  skipped?: boolean;
}

export interface ImageSizeInfo {
  label: string;
  path: string;
  url: string;
  sizeBytes?: number;
  overLimit?: "warn" | "fail";
  width?: number;
  height?: number;
  ratio?: number;
  /** icon 应为 1:1，cover 应为 3:2（1.5）；preview 无固定要求故为 undefined。 */
  ratioValid?: boolean;
}

export interface ResourceRuleCheckResult {
  checks: RuleCheckItem[];
  packageChecks: PackageCheckResult[];
  imageSizes: ImageSizeInfo[];
  repoTruncated?: boolean;
  paidRatioChecks?: PaidRatioResult[];
}

// ---------------------------------------------------------------------------
// URL 校验（移植自 AstroBooox）
// ---------------------------------------------------------------------------

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function normalizeUrlLikeText(input: string): string {
  let next = input.trim();
  if (!next) return "";
  next = next
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003f/gi, "?")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\x3a/gi, ":")
    .replace(/\\x2f/gi, "/")
    .replace(/\\x3f/gi, "?")
    .replace(/\\x26/gi, "&")
    .replace(/\\x3d/gi, "=");
  next = next.replace(/\\\//g, "/");
  next = next.replace(/^https?:\\\\\/\\\\\//i, (m) => (m.toLowerCase().startsWith("https") ? "https://" : "http://"));
  next = next.replace(/^https?:\\\/\\\//i, (m) => (m.toLowerCase().startsWith("https") ? "https://" : "http://"));
  next = next.replace(/^https?:\\\\/i, (m) => (m.toLowerCase().startsWith("https") ? "https://" : "http://"));
  next = next.replace(/^\\+['"`<]+/, "");
  next = next.replace(/[>'"`]+\\*$/g, "");
  next = next.replace(/^['"`<]+|[>'"`]+$/g, "");
  next = next.replace(/[),.;]+$/g, "");
  if (/^raw\.githubusercontent\.com\//i.test(next)) next = `https://${next}`;
  return next;
}

function extractUrlCandidate(value: string): string {
  const raw = normalizeUrlLikeText(value);
  if (!raw) return "";
  const markdownMatch = raw.match(/!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/i);
  if (markdownMatch?.[1]) return normalizeUrlLikeText(markdownMatch[1]);
  const angleWrapped = raw.match(/^<\s*([^>\s]+)\s*>$/i);
  if (angleWrapped?.[1]) return normalizeUrlLikeText(angleWrapped[1]);
  const directUrl = raw.match(/(?:https?:\/\/|raw\.githubusercontent\.com\/)[^\s<>"'`]+/i);
  if (directUrl?.[0]) return normalizeUrlLikeText(directUrl[0]);
  return raw;
}

function parseUrlCandidate(raw: string): URL | null {
  const candidate = extractUrlCandidate(raw);
  if (!candidate) return null;
  for (const value of [candidate, encodeURI(candidate), candidate.replace(/\\/g, "")]) {
    try {
      return new URL(value);
    } catch {
      continue;
    }
  }
  return null;
}

function isGithubRawLikeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com" || host === "raw.github.com") return true;
  if (host !== "github.com") return false;
  const parts = url.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
  if (parts.length < 4) return false;
  if (parts[2] === "raw") return true;
  if (parts[2] === "blob" && url.searchParams.get("raw") === "1") return true;
  return false;
}

function checkPublicUrl(raw: string): { ok: boolean; reason: string } {
  const candidate = extractUrlCandidate(raw);
  if (!candidate) return { ok: false, reason: "缺少链接" };
  const url = parseUrlCandidate(candidate);
  if (!url) return { ok: false, reason: "链接格式无效" };
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: "链接协议不是 http/https" };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: "链接使用了私有域名/内网地址" };
  return { ok: true, reason: "链接格式正常" };
}

function checkRawGithubUrl(raw: string): { ok: boolean; reason: string } {
  const base = checkPublicUrl(raw);
  if (!base.ok) return base;
  const url = parseUrlCandidate(raw);
  if (!url) return { ok: false, reason: "链接格式无效" };
  if (!isGithubRawLikeUrl(url)) return { ok: false, reason: "不是 GitHub Raw 链接" };
  return { ok: true, reason: "Raw 链接格式正确" };
}

// ---------------------------------------------------------------------------
// 零宽字符检测
// ---------------------------------------------------------------------------

// U+200B ZERO WIDTH SPACE / U+200C ZWNJ / U+200D ZWJ / U+2060 WORD JOINER / U+FEFF BOM
const ZERO_WIDTH_CHARS = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"];

function containsZeroWidth(value: string): boolean {
  return ZERO_WIDTH_CHARS.some((ch) => value.includes(ch));
}

function isCatalogFile(filename?: string): boolean {
  if (!filename) return false;
  return (
    filename === PUBLISH_CONFIG.catalogFilePath ||
    filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
  );
}

/** 扫描 PR 改动中 index_v2.csv 新增行是否包含零宽字符，返回命中的行内容。 */
export function scanCsvPatchForZeroWidth(files: GithubPullFile[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    if (!file.patch) continue;
    for (const line of file.patch.split(/\r?\n/)) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const row = line.slice(1);
      if (!row.trim() || row.trim().toLowerCase().startsWith("id,")) continue;
      if (containsZeroWidth(row)) hits.push(row);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 乱码检测
// ---------------------------------------------------------------------------

const REPLACEMENT_CHAR = "\uFFFD";

/** 检测字符串是否含乱码特征：替换字符 U+FFFD、连续问号、或 Latin-1 乱码段。 */
function containsGarbledText(value: string): boolean {
  // 1. UTF-8 解码失败产生的替换字符
  if (value.includes(REPLACEMENT_CHAR)) return true;
  // 2. 连续 4+ 个问号（CJK 字符丢失为 ?）
  if (/\?{4,}/.test(value)) return true;
  // 3. UTF-8 字节被按 Latin-1 解码产生的乱码段（连续 4+ 个 0xC0-0xFF 字符）
  if (/[\u00C0-\u00FF]{4,}/.test(value)) return true;
  return false;
}

function isTextFileForGarbledCheck(filename?: string): boolean {
  if (!filename) return false;
  return isCatalogFile(filename) || filename.endsWith(".json") || filename.endsWith(".csv");
}

/** 扫描 PR 改动中 CSV/JSON 新增行是否包含乱码，返回命中的行内容。 */
export function scanPatchForGarbled(files: GithubPullFile[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (!isTextFileForGarbledCheck(file.filename)) continue;
    if (!file.patch) continue;
    for (const line of file.patch.split(/\r?\n/)) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const row = line.slice(1);
      if (!row.trim()) continue;
      if (row.trim().toLowerCase().startsWith("id,")) continue;
      if (containsGarbledText(row)) hits.push(row.slice(0, 80));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 字节获取（Tauri fetch_media / Web 代理，支持 Range 截断）
// ---------------------------------------------------------------------------

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const RAW_ORIGIN = "https://raw.githubusercontent.com";

function toProxiedRawUrl(url: string): string {
  if (inTauri()) return url;
  return url.startsWith(RAW_ORIGIN) ? url.replace(RAW_ORIGIN, "/github-raw") : url;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface FetchMediaResponse {
  status: number;
  content_type?: string;
  body_base64: string;
}

export async function fetchResourceBytes(
  url: string,
  token: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  if (inTauri()) {
    // fetch_media 不支持 Range，拉取完整 body 后按需截断。
    const result = await invoke<FetchMediaResponse>("fetch_media", {
      request: { url, headers: token ? authHeaders : undefined },
    });
    let bytes = base64ToBytes(result.body_base64);
    if (maxBytes != null && bytes.length > maxBytes) bytes = bytes.subarray(0, maxBytes);
    return bytes;
  }

  const reqHeaders: Record<string, string> = { ...authHeaders };
  if (maxBytes != null) reqHeaders.Range = `bytes=0-${maxBytes - 1}`;
  const response = await fetch(toProxiedRawUrl(url), { headers: reqHeaders });
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 通过 Image 元素加载图片获取真实像素尺寸（用于宽高比校验）。
 * Tauri 直接用 raw URL；Web 走 /github-raw 同源代理避免 CORS。
 */
function loadImageDimensions(
  url: string,
  timeoutMs = 12_000,
): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(undefined);
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (val: { width: number; height: number } | undefined) => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve(val);
    };
    img.onload = () =>
      finish(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : undefined,
      );
    img.onerror = () => finish(undefined);
    img.src = url;
    setTimeout(() => finish(undefined), timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// 包体类型检测（移植自 AstroBox-NG core get_file_type）
// ---------------------------------------------------------------------------

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const WATCHFACE_MAGIC = [0x5a, 0xa5, 0x34, 0x12];
const FACTORY_MAGIC = [0x60, 0x5a, 0x5a, 0x7e]; // \x60ZZ~

const MIN_FIRMWARE_SIZE = 1_000_000;

function bytesStartWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/** 在字节流中查找 ASCII 子串（按字节比较），避免整段解码占用内存。 */
function bytesContainAscii(bytes: Uint8Array, needle: string): boolean {
  const n = needle.length;
  if (n === 0) return true;
  if (bytes.length < n) return false;
  const first = needle.charCodeAt(0) & 0xff;
  for (let i = 0; i <= bytes.length - n; i += 1) {
    if (bytes[i] !== first) continue;
    let j = 1;
    while (j < n && bytes[i + j] === (needle.charCodeAt(j) & 0xff)) j += 1;
    if (j === n) return true;
  }
  return false;
}

/** 统计字节流中某子序列出现次数。 */
function countBytesSequence(bytes: Uint8Array, needle: number[]): number {
  const n = needle.length;
  if (n === 0) return bytes.length + 1;
  let count = 0;
  for (let i = 0; i <= bytes.length - n; i += 1) {
    let j = 0;
    while (j < n && bytes[i + j] === needle[j]) j += 1;
    if (j === n) count += 1;
  }
  return count;
}

/** 判断是否为小米可穿戴工厂裸镜像。
 * 匹配规则：以 \x60ZZ~ 开头；紧跟 32 字节版本号仅含数字与 .；含 vela_ap.bin；出现多于一个 PK\x03\x04。 */
function isMiwearFactory(data: Uint8Array): boolean {
  if (data.length < FACTORY_MAGIC.length + 32) return false;
  if (!bytesStartWith(data, FACTORY_MAGIC)) return false;
  const verField = data.subarray(FACTORY_MAGIC.length, FACTORY_MAGIC.length + 32);
  let verLen = 0;
  while (verLen < verField.length && verField[verLen] !== 0) verLen += 1;
  if (verLen === 0) return false;
  for (let i = 0; i < verLen; i += 1) {
    const b = verField[i];
    if (!((b >= 0x30 && b <= 0x39) || b === 0x2e)) return false;
  }
  if (!bytesContainAscii(data, "vela_ap.bin")) return false;
  return countBytesSequence(data, ZIP_MAGIC) > 1;
}

/** 判断是否为小米可穿戴 OTA ZIP/JAR。
 * 匹配规则：以 PK\x03\x04 开头；能作为 ZIP 打开；ZIP 条目中存在 vela_ap.bin。 */
async function isMiwearOta(data: Uint8Array): Promise<boolean> {
  if (!bytesStartWith(data, ZIP_MAGIC)) return false;
  try {
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(data);
    return Object.keys(entries).some((name) => {
      const base = name.split("/").pop() ?? name;
      return base === "vela_ap.bin";
    });
  } catch {
    return false;
  }
}

/** 判断是否为小米可穿戴固件（工厂裸镜像或 OTA JAR）。fullSize 为文件原始大小。 */
async function isXiaomiFirmware(data: Uint8Array, fullSize: number): Promise<boolean> {
  if (fullSize < MIN_FIRMWARE_SIZE) return false;
  if (isMiwearFactory(data)) return true;
  return isMiwearOta(data);
}

export async function detectPackageType(
  bytes: Uint8Array,
  fileName: string,
  fullSize?: number,
): Promise<DetectedPackageType> {
  if (bytes.length === 0) return "unknown";
  const size = fullSize ?? bytes.length;
  // 0. 小米可穿戴固件优先（OTA JAR 也是 PK 开头，必须优先判断）
  if (await isXiaomiFirmware(bytes, size)) return "firmware";
  if (bytesStartWith(bytes, ZIP_MAGIC)) {
    if (
      bytesContainAscii(bytes, "toolkit") ||
      bytesContainAscii(bytes, "manifest-watch.json")
    ) {
      return "quick_app";
    }
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "abp") return "abp";
    if (ext === "mwz") return "watchface";
    if (ext === "rpk") return "quick_app"; // Vivo 快应用 rpk
    return "zip";
  }
  // 1. 小米表盘魔数 5a a5 34 12
  if (bytesStartWith(bytes, WATCHFACE_MAGIC)) return "watchface";
  return "binary";
}

function effectiveCategory(
  detected: DetectedPackageType,
  fileName: string,
): "watchface" | "quick_app" | "other" {
  if (detected === "watchface") return "watchface";
  if (detected === "quick_app") return "quick_app";
  if (detected === "zip") {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (["mwz", "bin", "face"].includes(ext)) return "watchface";
    if (ext === "rpk") return "quick_app";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// 包体内嵌 ID 校验
// ---------------------------------------------------------------------------

const VALID_WATCHFACE_ID_LENGTHS = [9, 12];

/** 扫描字节流中是否包含 ASCII 资源 ID（表盘 id / 快应用包名都会以 ASCII 形式落盘）。 */
function bytesContainId(bytes: Uint8Array, id: string): boolean {
  return bytesContainAscii(bytes, id);
}

/** 从表盘二进制前部提取第一个长度为 9 或 12 的字母数字段，作为检测到的 id（用于展示）。 */
function extractWatchfaceIdHint(bytes: Uint8Array, scanLen = 4096): string | undefined {
  const len = Math.min(bytes.length, scanLen);
  let i = 0;
  while (i < len) {
    const c = bytes[i];
    const isAlnum =
      (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (!isAlnum) {
      i += 1;
      continue;
    }
    const start = i;
    while (
      i < len &&
      ((bytes[i] >= 0x30 && bytes[i] <= 0x39) ||
        (bytes[i] >= 0x41 && bytes[i] <= 0x5a) ||
        (bytes[i] >= 0x61 && bytes[i] <= 0x7a))
    ) {
      i += 1;
    }
    const runLen = i - start;
    if (VALID_WATCHFACE_ID_LENGTHS.includes(runLen)) {
      return Array.from(bytes.subarray(start, i))
        .map((b) => String.fromCharCode(b))
        .join("");
    }
  }
  return undefined;
}

/** 从快应用 rpk 中解析 manifest.json 取 package 字段（尝试解压 ZIP）。 */
async function extractQuickAppPackage(
  bytes: Uint8Array,
  resourceId: string,
): Promise<{ package?: string; idFound: boolean }> {
  let unzipped: Record<string, Uint8Array> | null = null;
  try {
    const { unzipSync } = await import("fflate");
    unzipped = unzipSync(bytes);
  } catch {
    unzipped = null;
  }

  let idFound = false;

  if (unzipped) {
    // 1. 解析 manifest.json -> package
    const manifestEntry = Object.keys(unzipped).find((name) => {
      const base = name.split("/").pop() ?? name;
      return base === "manifest.json" || base === "manifest-watch.json";
    });
    if (manifestEntry) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(unzipped[manifestEntry]);
      if (resourceId && text.includes(resourceId)) idFound = true;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const pkg =
          typeof parsed.package === "string"
            ? parsed.package
            : typeof parsed.appId === "string"
              ? parsed.appId
              : undefined;
        if (pkg && resourceId && pkg === resourceId) idFound = true;
        if (pkg) return { package: pkg, idFound };
      } catch {
        // 不是合法 JSON，继续
      }
    }
    // 2. 任意文本条目中包含资源 id
    if (!idFound && resourceId) {
      for (const name of Object.keys(unzipped)) {
        if (/\.(json|json5?|txt|xml)$/.test(name) || /manifest/i.test(name)) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(unzipped[name]);
          if (text.includes(resourceId)) {
            idFound = true;
            break;
          }
        }
      }
    }
  }

  // 3. 兜底：原始字节扫描（覆盖 Vivo rpk 的 <package>.vru 条目名）
  if (!idFound && resourceId) {
    idFound = bytesContainId(bytes, resourceId);
  }

  return { idFound };
}

// ---------------------------------------------------------------------------
// 外部链接 links 校验
// ---------------------------------------------------------------------------

const phosphorSet = new Set(PHOSPHOR_ICON_NAMES.map((n) => n.toLowerCase()));
const LEGACY_LINK_ALIASES = new Set([
  "globe", "link", "youtube", "github", "twitter", "discord",
  "map", "play", "cart", "file", "cube", "store", "storefront",
]);

function normalizeIconName(value: string): string {
  return value.trim().toLowerCase().replace(/[_\-\s]/g, "");
}

export function isValidPhosphorIcon(raw: string): boolean {
  const n = normalizeIconName(raw);
  if (!n) return false;
  if (phosphorSet.has(n)) return true;
  if (phosphorSet.has(n + "logo")) return true;
  if (phosphorSet.has(n + "icon")) return true;
  if (n.endsWith("logo") && phosphorSet.has(n.slice(0, -"logo".length))) return true;
  if (n.endsWith("icon") && phosphorSet.has(n.slice(0, -"icon".length))) return true;
  if (LEGACY_LINK_ALIASES.has(n)) return true;
  return false;
}

interface LinkIssue {
  index: number;
  reason: string;
}

function validateLinks(links: unknown): { status: RuleCheckItem["status"]; detail: string } {
  if (!Array.isArray(links) || links.length === 0) {
    return { status: "pass", detail: "未配置外部链接（links 可选）" };
  }

  const issues: LinkIssue[] = [];
  links.forEach((link, index) => {
    const row = (link && typeof link === "object" ? link : {}) as {
      title?: unknown;
      url?: unknown;
      icon?: unknown;
    };
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const icon = typeof row.icon === "string" ? row.icon.trim() : "";

    const anyHasValue = Boolean(title) || Boolean(url) || Boolean(icon);
    // links 非空时，每条链接的 icon/title/url 必须都有值
    if (!anyHasValue) {
      issues.push({ index, reason: "title/url/icon 均为空" });
      return;
    }
    if (!title) issues.push({ index, reason: "缺少 title" });
    if (!url) issues.push({ index, reason: "缺少 url" });
    if (!icon) {
      issues.push({ index, reason: "缺少 icon" });
    } else if (!isValidPhosphorIcon(icon)) {
      issues.push({ index, reason: `icon「${icon}」不在 Phosphor 图标库中` });
    }
  });

  if (issues.length === 0) {
    return { status: "pass", detail: `${links.length} 条链接均完整且 icon 合法` };
  }
  return {
    status: "fail",
    detail: issues.map((i) => `#${i.index + 1}：${i.reason}`).join("；"),
  };
}

// ---------------------------------------------------------------------------
// 设备一致性
// ---------------------------------------------------------------------------

function getManifestDownloadKeys(manifest?: ManifestV2): {
  full: string[];
  trial: string[];
} {
  const full = manifest?.downloads ? Object.keys(manifest.downloads) : [];
  const trialDownloads = manifest?.ext?.trialDownloads as
    | Record<string, { file_name?: string }>
    | undefined;
  const trial = trialDownloads ? Object.keys(trialDownloads) : [];
  return { full, trial };
}

function resolveCanonicalSet(
  tokens: string[],
  resolver: DeviceTokenResolver,
): { canonicals: Set<string>; unknowns: string[] } {
  const canonicals = new Set<string>();
  const unknowns: string[] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;
    const canonical = resolver(t);
    if (canonical) {
      canonicals.add(canonical);
    } else {
      unknowns.push(token);
      canonicals.add(t); // 未知令牌按原值参与比较
    }
  }
  return { canonicals, unknowns };
}

// ---------------------------------------------------------------------------
// 体积阈值
// ---------------------------------------------------------------------------

const ICON_WARN = 150 * 1024;
const ICON_FAIL = 500 * 1024;
const COVER_WARN = 400 * 1024;
const COVER_FAIL = 1.5 * 1024 * 1024;
const PREVIEW_WARN = 600 * 1024;
const PREVIEW_FAIL = 2 * 1024 * 1024;

const PACKAGE_FULL_FETCH_LIMIT = 25 * 1024 * 1024; // 超过则不下载完整包做内容校验
const PACKAGE_HEAD_SCAN = 2 * 1024 * 1024; // 超限时仅取头部做魔数识别

export function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function imageSizeOverLimit(label: "icon" | "cover" | "preview", size: number): "warn" | "fail" | undefined {
  if (label === "icon") {
    if (size > ICON_FAIL) return "fail";
    if (size > ICON_WARN) return "warn";
  } else if (label === "cover") {
    if (size > COVER_FAIL) return "fail";
    if (size > COVER_WARN) return "warn";
  } else {
    if (size > PREVIEW_FAIL) return "fail";
    if (size > PREVIEW_WARN) return "warn";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lookupSize(
  sizeMap: Map<string, number>,
  path: string,
): number | undefined {
  const clean = path.replace(/^\/+/, "");
  if (sizeMap.has(clean)) return sizeMap.get(clean);
  const base = clean.split("/").filter(Boolean).pop();
  if (base) {
    if (sizeMap.has(base)) return sizeMap.get(base);
    for (const [p, s] of sizeMap) {
      if (p === clean || p.endsWith(`/${clean}`)) return s;
    }
  }
  return undefined;
}

interface UniquePackage {
  fileName: string;
  devices: string[];
  kind: "正式包" | "试用包";
  url: string;
}

function dedupePackages(preview: PrResourcePreview): UniquePackage[] {
  const map = new Map<string, UniquePackage>();
  for (const pkg of preview.packages) {
    const key = `${pkg.kind}|${pkg.fileName}|${pkg.url}`;
    const existing = map.get(key);
    if (existing) {
      if (pkg.deviceId && !existing.devices.includes(pkg.deviceId)) {
        existing.devices.push(pkg.deviceId);
      }
    } else {
      map.set(key, {
        fileName: pkg.fileName,
        devices: pkg.deviceId ? [pkg.deviceId] : [],
        kind: pkg.kind,
        url: pkg.url,
      });
    }
  }
  return Array.from(map.values());
}

export async function runResourceRuleChecks(options: {
  preview: PrResourcePreview;
  prFiles: GithubPullFile[];
  token: string;
  astroboxToken?: string;
}): Promise<ResourceRuleCheckResult> {
  const { preview, prFiles, token, astroboxToken } = options;
  const checks: RuleCheckItem[] = [];
  const entry = preview.entry;
  const manifest = preview.manifest;
  const manifestItem = manifest?.item;
  const restype = (manifestItem?.restype || entry.restype || "").trim().toLowerCase();

  // 1. 资源树 + 体积
  let sizeMap = new Map<string, number>();
  let repoExists = false;
  let repoError = "";
  let repoTruncated = false;
  try {
    const ref = entry.repo_commit_hash || preview.ref;
    const result = await listRepoFileSizesAtCommit(entry.repo_owner, entry.repo_name, ref);
    sizeMap = new Map(result.files.map((f) => [f.path, f.size]));
    repoExists = result.files.length > 0;
    repoTruncated = result.truncated;
  } catch (err) {
    repoError = err instanceof Error ? err.message : String(err);
  }

  // 2. 设备令牌解析器
  let resolver: DeviceTokenResolver = () => undefined;
  try {
    resolver = await loadDeviceTokenResolver();
  } catch {
    resolver = () => undefined;
  }

  // --- check: CSV 新增资源行 ---
  checks.push({
    title: "index_v2.csv 已新增资源行",
    status: entry.id || entry.name ? "pass" : "fail",
    detail: entry.id || entry.name
      ? `检测到资源行：${entry.id || entry.name}`
      : "未检测到 CSV 新增资源行",
  });

  // --- check: CSV 新增行无零宽字符 ---
  const zwcHits = scanCsvPatchForZeroWidth(prFiles);
  checks.push({
    title: "index_v2.csv 新增行无零宽字符",
    status: zwcHits.length === 0 ? "pass" : "fail",
    detail:
      zwcHits.length === 0
        ? "未检测到零宽字符"
        : `检测到 ${zwcHits.length} 行含零宽字符：${zwcHits
            .map((r) => r.slice(0, 60))
            .join(" | ")}`,
  });

  // --- check: CSV/manifest 新增行无乱码 ---
  const garbledHits = scanPatchForGarbled(prFiles);
  checks.push({
    title: "CSV/manifest 新增行无乱码",
    status: garbledHits.length === 0 ? "pass" : "fail",
    detail:
      garbledHits.length === 0
        ? "未检测到乱码"
        : `检测到 ${garbledHits.length} 行含乱码特征：${garbledHits
            .map((r) => r.slice(0, 60))
            .join(" | ")}`,
  });

  // --- check: icon 链接 ---
  const iconCheck = checkRawGithubUrl(preview.iconUrl);
  checks.push({
    title: "icon 链接可访问且为 Raw，且非私有域名",
    status: iconCheck.ok ? "pass" : "fail",
    detail: iconCheck.reason,
  });

  // --- check: cover 链接 ---
  const coverCheck = checkRawGithubUrl(preview.coverUrl);
  checks.push({
    title: "cover 链接可访问且为 Raw，且非私有域名",
    status: coverCheck.ok ? "pass" : "fail",
    detail: coverCheck.reason,
  });

  // --- check: 资源目标仓库真实存在 ---
  checks.push({
    title: "资源目标仓库真实存在",
    status: repoExists ? "pass" : "fail",
    detail: repoExists ? `已读取仓库文件树（${sizeMap.size} 个文件）` : repoError || "仓库不可访问",
  });

  // --- check: manifest 存在且可解析 ---
  checks.push({
    title: "manifest_v2.json 存在且 JSON 可解析",
    status: manifest ? "pass" : "fail",
    detail: manifest
      ? "manifest 解析成功"
      : preview.manifestError || "仓库缺少 manifest_v2.json 或解析失败",
  });

  // --- check: manifest 名称与 CSV 名称一致 ---
  const manifestName = toNonEmptyString(manifestItem?.name);
  const csvName = toNonEmptyString(entry.name);
  checks.push({
    title: "manifest 名称与 CSV 名称一致",
    status: manifestName && csvName ? (manifestName === csvName ? "pass" : "fail") : "warn",
    detail: manifestName && csvName ? `manifest: ${manifestName} / csv: ${csvName}` : "缺少可比对字段",
  });

  // --- check: manifest 资源 ID 与 CSV ID 一致 ---
  const manifestId = toNonEmptyString(manifestItem?.id);
  const csvId = toNonEmptyString(entry.id);
  checks.push({
    title: "manifest 资源 ID 与 CSV ID 一致",
    status: manifestId && csvId ? (manifestId === csvId ? "pass" : "fail") : "warn",
    detail: manifestId && csvId ? `manifest: ${manifestId} / csv: ${csvId}` : "缺少可比对字段",
  });

  // --- check: manifest restype 与 CSV restype 一致 ---
  const manifestRestype = toNonEmptyString(manifestItem?.restype).toLowerCase();
  const csvRestype = csvRestypeOf(entry).toLowerCase();
  checks.push({
    title: "manifest restype 与 CSV restype 一致",
    status: manifestRestype && csvRestype ? (manifestRestype === csvRestype ? "pass" : "fail") : "warn",
    detail: manifestRestype && csvRestype ? `manifest: ${manifestRestype} / csv: ${csvRestype}` : "缺少可比对字段",
  });

  // --- check: ext.bundledResources 捆绑配置有效性 ---
  const bundledEntries = normalizeBundledResources(manifest?.ext?.bundledResources);
  if (bundledEntries.length > 0) {
    const bundledResourceItems = bundledEntries.filter((r) => r.type === "resource");
    const bundledPluginCount = bundledEntries.length - bundledResourceItems.length;
    const selfResourceId = toNonEmptyString(manifestItem?.id) || toNonEmptyString(entry.id);
    const selfBound = bundledResourceItems.filter((r) => r.id === selfResourceId);
    let catalogIdMap: Map<string, string> | null = null;
    let catalogError = "";
    if (bundledResourceItems.length > 0) {
      try {
        const result = await fetchCatalogEntries({ token });
        catalogIdMap = new Map(
          result.entries
            .filter((e) => e.id)
            .map((e) => [e.id, e.name || e.id]),
        );
      } catch (err) {
        catalogError = err instanceof Error ? err.message : String(err);
      }
    }
    const missingInCatalog =
      catalogIdMap != null
        ? bundledResourceItems.filter((r) => !catalogIdMap!.has(r.id ?? ""))
        : [];
    const requiredCount = bundledEntries.filter((r) => r.mode === "required").length;
    checks.push({
      title: "ext.bundledResources 捆绑配置有效",
      status: (() => {
        if (selfBound.length > 0 || missingInCatalog.length > 0) return "fail";
        if (catalogIdMap == null && bundledResourceItems.length > 0) return "manual";
        return "pass";
      })(),
      detail: (() => {
        const summary = `必需 ${requiredCount} / 推荐 ${bundledEntries.length - requiredCount}${
          bundledPluginCount > 0 ? `（含插件 ${bundledPluginCount}，暂不校验）` : ""
        }`;
        if (selfBound.length > 0)
          return `捆绑项不能绑定自身：${selfBound.map((r) => r.id).join(", ")}`;
        if (missingInCatalog.length > 0)
          return `目录中不存在的捆绑资源：${missingInCatalog.map((r) => r.id).join(", ")}`;
        if (catalogIdMap == null && bundledResourceItems.length > 0)
          return `${summary}；无法加载资源目录进行校验：${catalogError}`;
        return `${summary}；捆绑资源均存在（${bundledResourceItems.map((r) => catalogIdMap!.get(r.id ?? "") || r.name || r.id || "").join("、")}）`;
      })(),
    });
  }

  // --- check: manifest 引用文件路径不含 URL 特殊字符 ---
  const referencedMediaPaths = getManifestReferencedFiles(manifest);
  const urlUnsafeFail: string[] = [];
  const urlUnsafeWarn: string[] = [];
  for (const rawPath of referencedMediaPaths) {
    const path = rawPath.trim();
    if (!path) continue;
    if (/[#?]/.test(path)) {
      urlUnsafeFail.push(path);
    } else if (path.includes("%")) {
      urlUnsafeWarn.push(path);
    }
  }
  checks.push({
    title: "manifest 引用文件名不含 # 等URL特殊字符",
    status:
      urlUnsafeFail.length > 0 ? "fail" : urlUnsafeWarn.length > 0 ? "warn" : "pass",
    detail: (() => {
      if (urlUnsafeFail.length === 0 && urlUnsafeWarn.length === 0)
        return "引用文件名均不含 URL 特殊字符";
      const parts: string[] = [];
      if (urlUnsafeFail.length > 0)
        parts.push(
          `文件名含 # 或 ?，客户端拼接 URL 时会被截断导致无法加载：${urlUnsafeFail.join("、")}`,
        );
      if (urlUnsafeWarn.length > 0)
        parts.push(`文件名含 %，可能存在编码歧义：${urlUnsafeWarn.join("、")}`);
      return parts.join("；");
    })(),
  });

  // --- check: 购买与加密配置就绪 ---
  const creatorFeaturesEnabled = Boolean(manifest?.ext?.enableAstroBoxCreatorFeatures);
  if (creatorFeaturesEnabled || astroboxToken) {
    const cryptoResourceId = toNonEmptyString(manifestItem?.id) || toNonEmptyString(entry.id);
    const fullDownloadDevices = Array.from(
      new Set(Object.keys(manifest?.downloads ?? {}).map((d) => d.trim())),
    ).filter(Boolean);

    let encryptedDeviceSet: Set<string> | null = null;
    let mappedDeviceSet: Set<string> | null = null;
    let cryptoCheckError = "";
    if (astroboxToken && cryptoResourceId) {
      try {
        const [fileKeys, configs] = await Promise.all([
          listSellerResourceFileKeys({ resourceId: cryptoResourceId, limit: 500 }, astroboxToken),
          listSellerResourceConfigs({ resourceId: cryptoResourceId }, astroboxToken),
        ]);
        encryptedDeviceSet = new Set(fileKeys.map((k) => k.deviceId));
        mappedDeviceSet = new Set(
          configs.skus.filter((s) => s.enabled).map((s) => s.deviceId),
        );
      } catch (err) {
        cryptoCheckError = err instanceof Error ? err.message : String(err);
      }
    }

    const missingEncryption =
      creatorFeaturesEnabled && encryptedDeviceSet
        ? fullDownloadDevices.filter((d) => !encryptedDeviceSet!.has(d))
        : [];
    const missingMapping =
      creatorFeaturesEnabled && mappedDeviceSet
        ? fullDownloadDevices.filter((d) => !mappedDeviceSet!.has(d))
        : [];
    const unmappedButEnabledMapping =
      !creatorFeaturesEnabled && mappedDeviceSet
        ? fullDownloadDevices.filter((d) => mappedDeviceSet!.has(d))
        : [];

    if (
      creatorFeaturesEnabled ||
      unmappedButEnabledMapping.length > 0 ||
      cryptoCheckError
    ) {
      checks.push({
        title: creatorFeaturesEnabled
          ? "购买与加密配置就绪（enableAstroBoxCreatorFeatures）"
          : "已存在付费映射但购买功能未开启",
        status: (() => {
          if (!creatorFeaturesEnabled) return "warn";
          if (!astroboxToken) return "manual";
          if (!cryptoResourceId) return "warn";
          if (cryptoCheckError) return "manual";
          if (missingEncryption.length > 0 || missingMapping.length > 0)
            return "fail";
          return "pass";
        })(),
        detail: (() => {
          if (!creatorFeaturesEnabled)
            return `以下设备已完成付费平台映射：${unmappedButEnabledMapping.join(", ")}`;
          if (!astroboxToken) return "未登录 AstroBox，无法校验服务端配置";
          if (cryptoCheckError) return `校验失败：${cryptoCheckError}`;
          if (cryptoResourceId === "")
            return "manifest 缺少资源 ID，无法查询服务端配置";
          const parts: string[] = [];
          if (missingEncryption.length > 0)
            parts.push(`缺少文件加密密钥的设备：${missingEncryption.join(", ")}`);
          if (missingMapping.length > 0)
            parts.push(`缺少付费平台映射的设备：${missingMapping.join(", ")}`);
          if (parts.length === 0)
            parts.push(
              `全部 ${fullDownloadDevices.length} 个正式下载设备均已配置加密密钥与付费映射`,
            );
          return parts.join("；");
        })(),
      });
    }
  }

  // --- check: manifest downloads 设备标识有效性 ---
  const { full: fullDeviceKeys, trial: trialDeviceKeys } = getManifestDownloadKeys(manifest);
  const allDeviceTokens = [...fullDeviceKeys, ...trialDeviceKeys];
  const fullResolved = resolveCanonicalSet(fullDeviceKeys, resolver);
  const trialResolved = resolveCanonicalSet(trialDeviceKeys, resolver);
  const unknownTokens = Array.from(
    new Set([...fullResolved.unknowns, ...trialResolved.unknowns]),
  );
  checks.push({
    title: "manifest downloads 设备标识有效",
    status: allDeviceTokens.length === 0
      ? "warn"
      : unknownTokens.length === 0
        ? "pass"
        : "fail",
    detail:
      allDeviceTokens.length === 0
        ? "未检测到 downloads 字典"
        : unknownTokens.length === 0
          ? "设备标识均可识别（支持机型号 / 规范化 id）"
          : `未知设备标识：${unknownTokens.join(", ")}`,
  });

  // --- check: manifest downloads 文件存在性 ---
  const referencedFiles = getManifestReferencedFiles(manifest);
  const missingFiles = referencedFiles.filter((f) => f && !sizeMap.has(f.replace(/^\/+/, "")));
  checks.push({
    title: "manifest downloads 文件存在性",
    status: allDeviceTokens.length === 0
      ? "warn"
      : missingFiles.length === 0
        ? "pass"
        : "fail",
    detail:
      allDeviceTokens.length === 0
        ? "未检测到 downloads 字典"
        : missingFiles.length === 0
          ? "下载文件均存在"
          : `缺失文件：${missingFiles.join(", ")}`,
  });

  // --- check: manifest 支持设备与 CSV devices 一致 ---
  const csvDevicesRaw = entry.devices
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  const csvResolved = resolveCanonicalSet(csvDevicesRaw, resolver);
  const manifestCanonicals = new Set<string>([
    ...fullResolved.canonicals,
    ...trialResolved.canonicals,
  ]);
  const missingInManifest = Array.from(csvResolved.canonicals).filter(
    (c) => !manifestCanonicals.has(c),
  );
  const extraInManifest = Array.from(manifestCanonicals).filter(
    (c) => !csvResolved.canonicals.has(c),
  );
  const onlyTrial = Array.from(csvResolved.canonicals).filter(
    (c) => !fullResolved.canonicals.has(c) && trialResolved.canonicals.has(c),
  );
  checks.push({
    title: "manifest 支持设备与 CSV devices 一致",
    status: (() => {
      if (csvDevicesRaw.length === 0) return "warn";
      if (missingInManifest.length > 0) return "fail";
      if (extraInManifest.length > 0 || onlyTrial.length > 0) return "warn";
      return "pass";
    })(),
    detail: (() => {
      if (csvDevicesRaw.length === 0) return "CSV 未声明支持设备";
      const parts: string[] = [];
      if (missingInManifest.length > 0)
        parts.push(`CSV 有但 manifest 无：${missingInManifest.join(", ")}`);
      if (onlyTrial.length > 0) parts.push(`仅有试用包无正式包：${onlyTrial.join(", ")}`);
      if (extraInManifest.length > 0)
        parts.push(`manifest 有但 CSV 无：${extraInManifest.join(", ")}`);
      return parts.length === 0 ? "CSV 与 manifest 支持设备一致" : parts.join("；");
    })(),
  });

  // --- check: 图片体积合理 ---
  const imageSizes: ImageSizeInfo[] = [];
  const imageOverLimits: Array<{ label: string; over: "warn" | "fail" }> = [];

  const collectImage = (label: "icon" | "cover" | "preview", path: string, url: string) => {
    if (!path && !url) return;
    const size = lookupSize(sizeMap, path || url);
    const over = size != null ? imageSizeOverLimit(label, size) : undefined;
    imageSizes.push({ label, path, url, sizeBytes: size, overLimit: over });
    if (over) imageOverLimits.push({ label, over });
  };

  collectImage("icon", manifestItem?.icon || entry.icon, preview.iconUrl);
  collectImage("cover", manifestItem?.cover || entry.cover, preview.coverUrl);
  preview.previewUrls.forEach((url, i) => {
    const path = manifestItem?.preview?.[i] ?? "";
    collectImage("preview", path, url);
  });

  const hasFailImage = imageOverLimits.some((i) => i.over === "fail");
  const hasWarnImage = imageOverLimits.some((i) => i.over === "warn");
  const missingImageSize = imageSizes.some((i) => i.sizeBytes == null);
  checks.push({
    title: "图片体积合理（icon ≤ 500KB / cover ≤ 1.5MB / preview ≤ 2MB）",
    status: hasFailImage
      ? "fail"
      : hasWarnImage
        ? "warn"
        : missingImageSize
          ? "warn"
          : "pass",
    detail: imageSizes
      .map(
        (i) =>
          `${i.label}: ${formatBytes(i.sizeBytes)}${
            i.overLimit === "fail" ? "（过大）" : i.overLimit === "warn" ? "（偏大）" : i.sizeBytes == null ? "（未取到体积）" : ""
          }`,
      )
      .join(" · "),
  });

  // --- check: 图片宽高比 ---
  // 加载 icon / cover 真实像素尺寸以校验宽高比（icon 1:1，cover 3:2）。
  await Promise.all(
    imageSizes
      .filter((img) => img.label === "icon" || img.label === "cover")
      .map(async (img) => {
        if (!img.url) return;
        const dims = await loadImageDimensions(toProxiedRawUrl(img.url));
        if (!dims) return;
        img.width = dims.width;
        img.height = dims.height;
        img.ratio = dims.width / dims.height;
        if (img.label === "icon") {
          img.ratioValid = Math.abs(img.ratio - 1) <= 0.01;
        } else if (img.label === "cover") {
          img.ratioValid = Math.abs(img.ratio - 1.5) <= 0.01;
        }
      }),
  );
  const ratioTargets = imageSizes.filter((i) => i.label === "icon" || i.label === "cover");
  const ratioInvalid = ratioTargets.filter((i) => i.ratioValid === false);
  const ratioMissing = ratioTargets.filter((i) => i.width == null);
  checks.push({
    title: "图片宽高比（icon 应为 1:1，cover 应为 3:2）",
    status:
      ratioInvalid.length > 0
        ? "fail"
        : ratioMissing.length > 0
          ? "warn"
          : "pass",
    detail:
      ratioTargets
        .map((i) => {
          const ratioText = i.ratio != null ? i.ratio.toFixed(2) : "-";
          const tag =
            i.ratioValid === false
              ? "（不符）"
              : i.width == null
                ? "（未取到尺寸）"
                : "";
          return `${i.label}: ${ratioText}${tag}`;
        })
        .join(" · ") || "无 icon/cover",
  });

  // --- check: 外部链接 links 完整且 icon 合法 ---
  const linkResult = validateLinks(manifest?.links);
  checks.push({
    title: "外部链接 links 完整且 icon 为合法 Phosphor 图标",
    status: linkResult.status,
    detail: linkResult.detail,
  });

  // --- check: 作者绑定 AstroBox 声明真实有效且具 Creator Pro 权益 ---
  const rawAuthors = manifestItem?.author;
  const authorsList = Array.isArray(rawAuthors) ? rawAuthors : [];
  const boundNames = authorsList
    .filter((a) => a && a.bindABAccount && typeof a.name === "string" && a.name.trim())
    .map((a) => (a as { name: string }).name.trim());

  let paidRatioResults: PaidRatioResult[] = [];
  let resolvedAuthorStatuses: Record<string, AuthorProStatus> | null = null;

  if (boundNames.length === 0) {
    checks.push({
      title: "作者绑定 AstroBox 声明真实有效且具 Creator Pro 权益",
      status: "pass",
      detail: "无声明已绑定 AstroBox 的作者",
    });
  } else if (!astroboxToken) {
    checks.push({
      title: "作者绑定 AstroBox 声明真实有效且具 Creator Pro 权益",
      status: "warn",
      detail: `未登录 AstroBox，无法验证：${boundNames.join("、")}`,
    });
  } else {
    const authorStatuses = await resolveAuthorProStatuses(boundNames, astroboxToken);
    resolvedAuthorStatuses = authorStatuses;
    const detailParts = boundNames.map((n) => {
      const s = authorStatuses[n];
      if (s?.state === "found") {
        const active = isVipActive(s.user.vip, s.user.vipExpireMap);
        const pro = hasCreatorPro(s.user.vip) && active;
        return `${n}: ${
          pro
            ? `有 ${vipTierLabel(s.user.vip)} 权益`
            : `${vipTierLabel(s.user.vip)}${
                !active && s.user.vip !== "None" ? "（已过期）" : ""
              }`
        }`;
      }
      if (s?.state === "not-found") return `${n}: 名称未匹配账户`;
      if (s?.state === "error") return `${n}: 查询失败`;
      if (s?.state === "no-auth") return `${n}: 未登录 AstroBox`;
      return `${n}: 查询中`;
    });
    const notFound = boundNames.filter((n) => authorStatuses[n]?.state === "not-found");
    const noPro = boundNames.filter((n) => {
      const s = authorStatuses[n];
      if (s?.state !== "found") return false;
      return !(hasCreatorPro(s.user.vip) && isVipActive(s.user.vip, s.user.vipExpireMap));
    });
    const hasError = boundNames.some((n) => authorStatuses[n]?.state === "error");
    checks.push({
      title: "作者绑定 AstroBox 声明真实有效且具 Creator Pro 权益",
      status:
        notFound.length > 0 ? "fail" : hasError || noPro.length > 0 ? "warn" : "pass",
      detail: detailParts.join(" · "),
    });
  }

  // --- check: 非 Creator Pro 作者付费/免费资源比例（2 免费 : 1 付费） ---
  const newPaidType = entry.paid_type;
  const newResourceId = manifestItem?.id || entry.id;

  if (boundNames.length > 0 && astroboxToken && resolvedAuthorStatuses) {
    for (const name of boundNames) {
      const status = resolvedAuthorStatuses[name];
      if (!status) continue;
      const result = await checkPaidFreeRatioForAuthor({
        authorName: name,
        authorStatus: status,
        astroboxToken,
        githubToken: token,
        newEntryPaidType: newPaidType,
        newEntryId: newResourceId,
      });
      paidRatioResults.push(result);
    }

    if (paidRatioResults.length > 0) {
      const ratioDetails = paidRatioResults.map((r) => {
        if (r.error) return `${r.authorName}: ${r.error}`;
        if (r.hasPro) return `${r.authorName}: ${r.vipTier ? vipTierLabel(r.vipTier) : "Pro"}，不受比例限制`;
        if (!r.ratio) return `${r.authorName}: 无法判断`;
        if (r.ratio.compliant) {
          return `${r.authorName}: 免费 ${r.ratio.freeCount} / 付费 ${r.ratio.paidCount}，合规`;
        }
        return `${r.authorName}: 免费 ${r.ratio.freeCount} / 付费 ${r.ratio.paidCount}，${r.ratio.reason}`;
      });

      const anyNonCompliant = paidRatioResults.some(
        (r) => r.ratio && !r.ratio.compliant,
      );
      const anyError = paidRatioResults.some((r) => r.error);

      checks.push({
        title: "非 Creator Pro 作者付费/免费资源比例（2 免费 : 1 付费）",
        status: anyNonCompliant ? "fail" : anyError ? "warn" : "pass",
        detail: ratioDetails.join(" · "),
      });
    }
  }

  // --- 包体内容校验（类型匹配 + 内嵌 ID） ---
  const uniquePackages = dedupePackages(preview);
  const packageChecks: PackageCheckResult[] = [];

  if (uniquePackages.length === 0) {
    checks.push({
      title: "包体类型与资源类别匹配",
      status: "warn",
      detail: "未检测到包体（manifest 无 downloads）",
    });
    checks.push({
      title: "包体内嵌 ID 与资源 ID 一致",
      status: "warn",
      detail: "未检测到包体",
    });
  } else {
    const resourceId = manifestId || csvId;

    for (const pkg of uniquePackages) {
      const result: PackageCheckResult = {
        fileName: pkg.fileName,
        devices: pkg.devices,
        kind: pkg.kind,
        url: pkg.url,
        sizeBytes: lookupSize(sizeMap, pkg.fileName),
        detectedType: "unknown",
        effectiveCategory: "other",
        typeMatch: "inconclusive",
        idMatch: "skipped",
      };

      try {
        const expectedSize = result.sizeBytes;
        let bytes: Uint8Array;
        if (expectedSize != null && expectedSize > PACKAGE_FULL_FETCH_LIMIT) {
          // 超大包：仅取头部做魔数识别，跳过 ID 校验
          bytes = await fetchResourceBytes(pkg.url, token, PACKAGE_HEAD_SCAN);
          result.skipped = true;
        } else {
          bytes = await fetchResourceBytes(pkg.url, token);
        }

        result.detectedType = await detectPackageType(bytes, pkg.fileName, result.sizeBytes);
        result.effectiveCategory = effectiveCategory(result.detectedType, pkg.fileName);

        // 类型匹配
        if (result.effectiveCategory === "other") {
          result.typeMatch = "inconclusive";
        } else if (
          (restype === "watchface" && result.effectiveCategory === "watchface") ||
          (restype === "quick_app" && result.effectiveCategory === "quick_app")
        ) {
          result.typeMatch = "match";
        } else {
          result.typeMatch = "mismatch";
        }

        // 内嵌 ID 校验
        if (result.skipped) {
          result.idMatch = "skipped";
        } else if (!resourceId) {
          result.idMatch = "skipped";
        } else if (restype === "watchface") {
          // 安装时会强制修改表盘 ID 文件为 CSV/manifest 的 ID，无需校验包体内嵌 ID
          result.idMatch = "skipped";
          result.detectedId = extractWatchfaceIdHint(bytes);
        } else if (restype === "quick_app") {
          if (result.effectiveCategory === "quick_app" || bytesStartWith(bytes, ZIP_MAGIC)) {
            const { package: pkg2, idFound } = await extractQuickAppPackage(bytes, resourceId);
            result.detectedId = pkg2;
            result.idMatch = idFound ? "match" : "mismatch";
          } else {
            // 非 zip 的快应用包：兜底扫描
            result.idMatch = bytesContainId(bytes, resourceId) ? "match" : "mismatch";
          }
        } else {
          result.idMatch = "skipped";
        }
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        result.typeMatch = "inconclusive";
        result.idMatch = "skipped";
      }

      packageChecks.push(result);
    }

    // 聚合：类型匹配
    const typeMismatch = packageChecks.filter((p) => p.typeMatch === "mismatch");
    const typeInconclusive = packageChecks.filter((p) => p.typeMatch === "inconclusive");
    const packageDetail =
      packageChecks
        .map(
          (p) =>
            `${p.fileName}: ${resultTypeLabel(p.detectedType)}${
              p.typeMatch === "mismatch" ? "（不匹配）" : p.typeMatch === "inconclusive" ? "（无法确认）" : "（匹配）"
            }${p.error ? ` [${p.error}]` : ""}`,
        )
        .join(" · ") || "无包体";
    checks.push({
      title: "包体类型与资源类别匹配",
      status:
        restype === "canopus"
          ? "pass"
          : typeMismatch.length > 0
            ? "fail"
            : typeInconclusive.length > 0
              ? "manual"
              : "pass",
      detail:
        restype === "canopus"
          ? `模块（canopus）包体不做类型强校验 · ${packageDetail}`
          : (typeInconclusive.length > 0 ? "可能有问题，需要人工复核。" : "") +
            packageDetail,
    });

    // 聚合：内嵌 ID
    const idMismatch = packageChecks.filter((p) => p.idMatch === "mismatch");
    const idSkipped = packageChecks.filter((p) => p.idMatch === "skipped");
    checks.push({
      title: "包体内嵌 ID 与资源 ID 一致",
      status:
        idMismatch.length > 0
          ? "fail"
          : restype === "watchface" || restype === "canopus"
            ? "pass"
            : idSkipped.length === packageChecks.length
              ? "warn"
              : "pass",
      detail:
        restype === "watchface"
          ? "表盘包体内嵌 ID 不再强制校验（安装时会强制修改为 CSV/manifest 的 ID）"
          : restype === "canopus"
            ? "模块包体内嵌 ID 不做强制校验"
            : (resourceId ? `资源 ID: ${resourceId} · ` : "") +
              packageChecks
                .map((p) => {
                  const detected = p.detectedId ? `检测到 ${p.detectedId}` : "未检测到";
                  return `${p.fileName}: ${
                    p.idMatch === "match" ? "匹配" : p.idMatch === "mismatch" ? `不匹配（${detected}）` : "跳过"
                  }${p.error ? ` [${p.error}]` : ""}`;
                })
                .join(" · "),
    });
  }

  return { checks, packageChecks, imageSizes, repoTruncated, paidRatioChecks: paidRatioResults };
}

function csvRestypeOf(entry: PrResourcePreview["entry"]): string {
  return entry.restype || "";
}

function resultTypeLabel(t: DetectedPackageType): string {
  switch (t) {
    case "watchface":
      return "表盘";
    case "quick_app":
      return "快应用";
    case "firmware":
      return "固件";
    case "abp":
      return "ABP 插件";
    case "zip":
      return "ZIP（未确定）";
    case "binary":
      return "未知二进制";
    default:
      return "未知";
  }
}

function getManifestReferencedFiles(manifest?: ManifestV2): string[] {
  if (!manifest?.item) return [];
  const files = new Set<string>();
  if (manifest.item.icon) files.add(manifest.item.icon);
  if (manifest.item.cover) files.add(manifest.item.cover);
  for (const p of manifest.item.preview ?? []) {
    if (p) files.add(p);
  }
  for (const info of Object.values(manifest.downloads ?? {})) {
    const fileName = (info as { file_name?: string })?.file_name;
    if (fileName) files.add(fileName);
  }
  const trialDownloads = manifest.ext?.trialDownloads as
    | Record<string, { file_name?: string }>
    | undefined;
  for (const info of Object.values(trialDownloads ?? {})) {
    if (info.file_name) files.add(info.file_name);
  }
  return Array.from(files);
}

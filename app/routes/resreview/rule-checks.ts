import { invoke } from "@tauri-apps/api/core";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
  GITHUB_RAW_ACCEPT,
  isTauriRuntime,
  rawGithubUrlToApiUrl,
  toProxiedApiUrl,
} from "~/logic/github-raw";
import { fetchProxiedMediaUrl } from "~/logic/media-proxy";
import { listRepoFileSizesAtCommit, type GithubPullFile } from "~/api/github/pr-review";
import {
  loadDeviceOptions,
  loadDeviceTokenResolver,
  type DeviceTokenResolver,
} from "~/logic/devices/catalog";
import {
  isLinkIconUrl,
  resolveAstroboxPhosphorIcon,
} from "~/logic/publish/phosphor-link-icon";
import {
  resolveAuthorProStatuses,
  hasCreatorPro,
  isVipActive,
  vipTierLabel,
  type AuthorProStatus,
} from "./owner-pro";
import type { PrResourcePreview, RuleCheckItem } from "./types";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { fetchManifestForCatalogEntry } from "~/logic/publish/manifest-loader";
import { normalizeBundledResources } from "~/logic/publish/manifest";
import {
  COVER_MAX_BYTES,
  ICON_COMPRESS_TARGET_BYTES,
  PREVIEW_COMPRESS_TARGET_BYTES,
} from "~/logic/publish/pre-publish-checks";
import {
  WATCHFACE_MAGIC,
  ZIP_MAGIC,
  computePackageHash,
  xiaomiVersionCodeFromVersion,
} from "~/logic/publish/package-version";
import {
  describeRpkDebug,
  detectRpkDebug,
  type RpkDebugVerdict,
} from "~/logic/publish/rpk-signature";
import { fetchCatalogEntries } from "~/logic/publish/catalog";
import {
  fetchNgPluginIndex,
  ngPluginDisplayName,
} from "~/logic/publish/plugin-repo";
import { AdminApi } from "~/api/astrobox/admin";
import {
  checkPaidFreeRatioForAuthor,
  isPaidEntry,
  pickRatioAuthorName,
  type PaidRatioResult,
} from "./utils/paid-ratio";
import {
  describeLockedDevice,
  evaluateDeviceGates,
  findUnpaidSkuDevices,
  partitionPendingManifestSkus,
} from "./utils/purchase-gate";
import { inspectResPack } from "~/logic/publish/crpack-validate";
import {
  judgePackageDisplayName,
  summarizeDisplayNameCheck,
  type DisplayNameKind,
  type DisplayNameObservation,
} from "~/logic/publish/package-display-name";

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
  | "encrypted"
  | "unknown";

export interface PackageCheckResult {
  fileName: string;
  devices: string[];
  kind: "正式包" | "试用包";
  url: string;
  sizeBytes?: number;
  /** manifest downloads 声明的版本号，多设备不一致时以「、」并列。 */
  version?: string;
  /** manifest downloads 声明的 versionCode，多设备不一致时以「、」并列。 */
  versionCode?: string;
  /** 「更新包体 versionCode 已递增」检查按设备给出的问题清单，逐条展示供人工核对。 */
  versionCodeNotes?: string[];
  detectedType: DetectedPackageType;
  effectiveCategory: "watchface" | "quick_app" | "other";
  typeMatch: "match" | "mismatch" | "inconclusive";
  detectedId?: string;
  idMatch: "match" | "mismatch" | "skipped";
  error?: string;
  skipped?: boolean;
  /** 命中服务端加密文件密钥，内容为密文，跳过类型/内嵌 ID 校验。 */
  encrypted?: boolean;
  /** 加密判定依据是完整内容哈希精确匹配（true）还是「头部非已知包体」兜底（false）。 */
  encryptedByHash?: boolean;
  /** 快应用 rpk 的 debug 调试包判定结论；非快应用包体不产出。 */
  debugVerdict?: RpkDebugVerdict;
  /** 包内实际展示名（快应用 name / 表盘名 / 资源包 name）。 */
  contentName?: string;
  /** 展示名的读取位置，例如「表盘文件头」「manifest.json」。 */
  contentNameSource?: string;
  /** 包内名称与资源名是否一致。对不上只警告，不作为不通过。 */
  nameMatch?: "match" | "mismatch" | "skipped";
  /** 读不到包内名称时的原因。 */
  nameNote?: string;
  /** CRPack 校验未通过的明细，逐条展示供人工核对。 */
  resPackErrors?: string[];
  /** CRPack 结构摘要（清单名 / 规则数 / TSV 实算字节 / 版本），仅展示不单独判不通过。 */
  resPackSummary?: string[];
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
// 字节获取（GitHub Contents API 鉴权拉取，规避 raw CDN 限流）
// ---------------------------------------------------------------------------

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

async function fetchBytes(
  url: string,
  headers: Record<string, string>,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (isTauriRuntime()) {
    // fetch_media 不支持 Range，拉取完整 body 后按需截断。
    const result = await invoke<FetchMediaResponse>("fetch_media", {
      request: { url, headers },
    });
    let bytes = base64ToBytes(result.body_base64);
    if (maxBytes != null && bytes.length > maxBytes) bytes = bytes.subarray(0, maxBytes);
    return bytes;
  }

  const response = await fetch(toProxiedApiUrl(url), { headers });
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  let bytes = new Uint8Array(buffer);
  if (maxBytes != null && bytes.length > maxBytes) bytes = bytes.subarray(0, maxBytes);
  return bytes;
}

export async function fetchResourceBytes(
  url: string,
  token: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  // 审核入口已强制 GitHub 登录：一律走带鉴权的 Contents API
  // （Accept: application/vnd.github.raw），不再回退到匿名 raw CDN。
  if (!token) throw new Error("未登录 GitHub，无法获取资源内容。");
  const apiUrl = rawGithubUrlToApiUrl(url);
  if (!apiUrl) throw new Error(`不是 GitHub 资源链接，无法鉴权获取：${url}`);
  return fetchBytes(
    apiUrl,
    { Accept: GITHUB_RAW_ACCEPT, Authorization: `Bearer ${token}` },
    maxBytes,
  );
}

/**
 * 通过 Image 元素加载图片获取真实像素尺寸（用于宽高比校验）。
 * 先经 media-proxy 带鉴权取回 blob（走 Contents API），再交给 Image 读取尺寸，
 * 避免直接请求 raw CDN 被限流。
 */
async function loadImageDimensions(
  rawUrl: string,
  timeoutMs = 12_000,
): Promise<{ width: number; height: number } | undefined> {
  let displayUrl: string;
  try {
    displayUrl = await fetchProxiedMediaUrl(rawUrl);
  } catch {
    // 鉴权取回失败（未登录/超限）时不再回退 raw CDN，直接放弃尺寸探测。
    return undefined;
  }
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
    img.src = displayUrl;
    setTimeout(() => finish(undefined), timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// 包体类型检测（移植自 AstroBox-NG core get_file_type）
// ---------------------------------------------------------------------------

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

/** icon 是否为 AstroBox 能渲染的链接图标（kebab-case Phosphor 名或 http(s) 图片 URL）。 */
export function isValidLinkIcon(raw: string): boolean {
  const icon = (raw || "").trim();
  if (!icon) return false;
  if (isLinkIconUrl(icon)) return /^https?:\/\//i.test(icon);
  return resolveAstroboxPhosphorIcon(icon) !== null;
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
    } else if (!isValidLinkIcon(icon)) {
      issues.push({
        index,
        reason: `icon「${icon}」AstroBox 无法渲染（请用 kebab-case Phosphor 名，如 github-logo）`,
      });
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
//
// 与发布流程（app/logic/publish/pre-publish-checks.ts + new.tsx 的
// compressImageFile 调用）保持一致，避免「创作者按发布页提示压到刚好达标、
// 审核页却判过大」这种自相矛盾：
//   - warn 阈值 = 发布流程的压缩目标字节数，超过即说明没走压缩或压不动；
//   - fail 阈值 = 发布流程的硬性上限（封面 COVER_MAX_BYTES 会直接拒绝上传），
//     其余两类取压缩目标的 2 倍作为「明显异常」线。
// ---------------------------------------------------------------------------

/** 封面没有独立的压缩目标（压缩目标即硬上限），留出 80% 作为「偏大」提示带。 */
const COVER_WARN = Math.floor(COVER_MAX_BYTES * 0.8);

const ICON_WARN = ICON_COMPRESS_TARGET_BYTES; // 100KB
const COVER_FAIL = COVER_MAX_BYTES; // 600KB，发布页超此值直接拒绝
const PREVIEW_WARN = PREVIEW_COMPRESS_TARGET_BYTES; // 500KB
const ICON_FAIL = ICON_COMPRESS_TARGET_BYTES * 2; // 200KB
const PREVIEW_FAIL = PREVIEW_COMPRESS_TARGET_BYTES * 2; // 1000KB

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
  /** manifest downloads 里声明的版本号，同一文件被多设备共用时可能并列多个。 */
  versions: string[];
  /** manifest downloads 里声明的 versionCode，同一文件被多设备共用时可能并列多个。 */
  versionCodes: number[];
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
        versions: [],
        versionCodes: [],
      });
    }
    const target = map.get(key)!;
    const version = (pkg.version ?? "").trim();
    if (version && !target.versions.includes(version)) target.versions.push(version);
    if (
      typeof pkg.versionCode === "number" &&
      Number.isFinite(pkg.versionCode) &&
      !target.versionCodes.includes(pkg.versionCode)
    ) {
      target.versionCodes.push(pkg.versionCode);
    }
  }
  return Array.from(map.values());
}

function isDisplayNameRestype(restype: string): restype is DisplayNameKind {
  return restype === "watchface" || restype === "quick_app" || restype === "res_pack";
}

/** 快应用 / 表盘 / 资源包才有设备上的展示名。读不到或对不上都记在包体结果上。 */
function attachDisplayName(
  result: PackageCheckResult,
  restype: string,
  resourceName: string,
  bytes?: Uint8Array,
) {
  if (!isDisplayNameRestype(restype) || result.nameMatch) return;
  const verdict = judgePackageDisplayName({
    bytes,
    kind: restype,
    resourceName,
    skipped: result.skipped,
    encrypted: result.encrypted,
    error: result.error,
  });
  result.contentName = verdict.contentName;
  result.contentNameSource = verdict.contentNameSource;
  result.nameMatch = verdict.nameMatch;
  result.nameNote = verdict.nameNote;
}

function pushDisplayNameCheck(
  checks: RuleCheckItem[],
  restype: string,
  resourceName: string,
  packageChecks: PackageCheckResult[],
) {
  if (!isDisplayNameRestype(restype)) return;
  const observations: DisplayNameObservation[] = packageChecks.map((pkg) => ({
    fileName: pkg.fileName,
    status: pkg.nameMatch ?? "skipped",
    contentName: pkg.contentName,
    source: pkg.contentNameSource,
    note: pkg.nameNote,
  }));
  const summary = summarizeDisplayNameCheck(resourceName, observations);
  checks.push({
    title: "包内名称与资源名一致",
    status: summary.status,
    detail: summary.detail,
    anchor: "packages",
  });
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

  // 2b. 规范化设备 ID -> vendor 映射，用于按厂商细化 versionCode 规则。
  let vendorByCanonicalId = new Map<string, string>();
  try {
    const options = await loadDeviceOptions();
    vendorByCanonicalId = new Map(
      options.map((opt) => [opt.id, (opt.vendor ?? "").toLowerCase()]),
    );
  } catch {
    vendorByCanonicalId = new Map();
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

  // --- check: ext.bundledResources 采用 AstroBox-NG 规范字段 ---
  // NG 只读 id 与 recommended：历史提交若把插件标识写进 name、或用 recommend 键，
  // 前置资源在 NG 端会被静默丢弃，这里在合入前拦下。
  const rawBundles = manifest?.ext?.bundledResources as
    | { required?: unknown; recommended?: unknown; recommend?: unknown }
    | undefined;
  if (rawBundles && typeof rawBundles === "object" && !Array.isArray(rawBundles)) {
    const formatProblems: string[] = [];
    if (rawBundles.recommend !== undefined) {
      formatProblems.push(
        "推荐组键名应为 recommended，当前为 recommend（AstroBox-NG 会忽略）",
      );
    }
    const inspectGroup = (value: unknown, label: string) => {
      if (!Array.isArray(value)) return;
      value.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const raw = item as { id?: unknown; name?: unknown };
        if (String(raw.id ?? "").trim()) return;
        const name = String(raw.name ?? "").trim();
        formatProblems.push(
          name
            ? `${label}[${index}] 的标识写在 name，应为 id: "${name}"`
            : `${label}[${index}] 缺少 id`,
        );
      });
    };
    inspectGroup(rawBundles.required, "required");
    inspectGroup(rawBundles.recommended, "recommended");
    inspectGroup(rawBundles.recommend, "recommend");
    const shown = formatProblems.slice(0, 3);
    if (formatProblems.length > shown.length) {
      shown.push(`等共 ${formatProblems.length} 处`);
    }
    checks.push({
      title: "资源绑定字段符合规范",
      status: formatProblems.length > 0 ? "fail" : "pass",
      detail:
        formatProblems.length > 0
          ? `错误：${shown.join("；")}；AstroBox-NG 仅读取 id 与 recommended`
          : "分组键名与 id 字段均符合规范",
    });
  }

  // --- check: ext.bundledResources 捆绑配置有效性 ---
  const bundledEntries = normalizeBundledResources(manifest?.ext?.bundledResources);
  if (bundledEntries.length > 0) {
    const bundledResourceItems = bundledEntries.filter((r) => r.type === "resource");
    const bundledPluginItems = bundledEntries.filter((r) => r.type === "plugin");
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
    // 插件同样校验存在性，避免绑到插件仓库里已删除的名称。
    let pluginNameSet: Set<string> | null = null;
    let pluginError = "";
    if (bundledPluginItems.length > 0) {
      try {
        pluginNameSet = new Set((await fetchNgPluginIndex()).map(ngPluginDisplayName));
      } catch (err) {
        pluginError = err instanceof Error ? err.message : String(err);
      }
    }
    const missingInCatalog =
      catalogIdMap != null
        ? bundledResourceItems.filter((r) => !catalogIdMap!.has(r.id ?? ""))
        : [];
    const missingPlugins =
      pluginNameSet != null
        ? bundledPluginItems.filter((r) => !pluginNameSet!.has(r.name || r.id || ""))
        : [];
    const requiredCount = bundledEntries.filter((r) => r.mode === "required").length;
    const lookupUnavailable =
      (catalogIdMap == null && bundledResourceItems.length > 0) ||
      (pluginNameSet == null && bundledPluginItems.length > 0);
    checks.push({
      title: "ext.bundledResources 捆绑配置有效",
      status: (() => {
        if (
          selfBound.length > 0 ||
          missingInCatalog.length > 0 ||
          missingPlugins.length > 0
        )
          return "fail";
        if (lookupUnavailable) return "manual";
        return "pass";
      })(),
      detail: (() => {
        const summary = `必需 ${requiredCount} / 推荐 ${bundledEntries.length - requiredCount}`;
        // 具体是哪些捆绑项有问题，在「资源信息」Tab 的「捆绑资源」区块里
        // 已逐条标红展示，这里只给数量结论。
        if (selfBound.length > 0)
          return `${summary}；${selfBound.length} 个捆绑项绑定了资源自身`;
        if (missingInCatalog.length > 0)
          return `${summary}；${missingInCatalog.length} 个捆绑资源已不在资源目录中`;
        if (missingPlugins.length > 0)
          return `${summary}；${missingPlugins.length} 个捆绑插件已不在插件索引中`;
        if (lookupUnavailable) {
          const reasons = [
            catalogIdMap == null && bundledResourceItems.length > 0
              ? `无法加载资源目录：${catalogError}`
              : "",
            pluginNameSet == null && bundledPluginItems.length > 0
              ? `无法加载插件索引：${pluginError}`
              : "",
          ].filter(Boolean);
          return `${summary}；${reasons.join("；")}`;
        }
        return `${summary}；全部捆绑项均存在于目录或插件索引中`;
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

  // --- 加密与付费配置（查询始终执行，判定按开关分流） ---
  // 服务端加密文件密钥有两处用途：判定「是否加密上传却没开启
  // ext.enableAstroBoxCreatorFeatures」，以及供下方「包体内容校验」识别密文。
  // 两者都与开关状态无关，因此查询无条件执行。
  //
  // 付费侧（skus / products / externalAuthorizations）只在该开关开启时消费：
  // 未开启购买功能的资源在服务端可能残留历史映射，与本次提交无关。
  let encryptedDeviceSet: Set<string> | null = null;
  let encryptedHashSet = new Set<string>();
  let cryptoCheckError = "";
  const creatorFeaturesEnabled = Boolean(manifest?.ext?.enableAstroBoxCreatorFeatures);
  const cryptoResourceId = toNonEmptyString(manifestItem?.id) || toNonEmptyString(entry.id);
  const fullDownloadDevices = Array.from(
    new Set(Object.keys(manifest?.downloads ?? {}).map((d) => d.trim())),
  ).filter(Boolean);
  // 待合入 manifest 声明的设备（规范化 id）。提前算好，供下面两处使用：
  //   1) 给服务端的 pending_manifest_device 分级——设备已在本 PR 声明时，
  //      那只是服务端还没看到本 PR 的索引行，合入后必然生效；
  //   2) 下方「manifest downloads 设备标识有效」「支持设备与 CSV 一致」两项检查。
  // resolver 在上方已就绪，getManifestDownloadKeys / resolveCanonicalSet 均为纯同步函数，
  // 上移无副作用。下载行判定仍用 manifest 原始 key（fullDownloadDevices），
  // 规范化只用于设备存在性比对，避免与 SKU / fileKey 的规范化 id 空间混淆。
  const { full: fullDeviceKeys, trial: trialDeviceKeys } = getManifestDownloadKeys(manifest);
  const fullResolved = resolveCanonicalSet(fullDeviceKeys, resolver);
  const trialResolved = resolveCanonicalSet(trialDeviceKeys, resolver);
  const declaredDeviceIds = new Set([
    ...fullResolved.canonicals,
    ...trialResolved.canonicals,
  ]);

  if (astroboxToken && cryptoResourceId) {
    try {
      // 审核人不是资源作者，卖家专属接口会因所有权校验返回
      // “Resource is not owned by seller”。此处改用管理员接口按资源 ID 查询，
      // 该接口返回该资源的 fileKeys / skus / products / externalAuthorizations。
      const configs = await AdminApi.orders.resourceConfigs({
        resourceId: cryptoResourceId,
        limit: 500,
      });
      encryptedDeviceSet = new Set(configs.fileKeys.map((k) => k.deviceId));
      encryptedHashSet = new Set(
        configs.fileKeys.map((k) => k.encryptedFileHash).filter(Boolean),
      );

      if (creatorFeaturesEnabled) {
        // 资源作者账户 id：用于校验配置归属（服务端 checkConfigUsable 的判定之一）。
        const authorName = (Array.isArray(manifestItem?.author) ? manifestItem?.author : [])
          .map((a: unknown) =>
            a && typeof (a as { name?: unknown }).name === "string"
              ? (a as { name: string }).name.trim()
              : "",
          )
          .find(Boolean);
        const authorStatus = authorName
          ? (await resolveAuthorProStatuses([authorName], astroboxToken))[authorName]
          : undefined;
        const sellerUserId =
          authorStatus?.state === "found" ? authorStatus.user.userId : undefined;

        const { reasons, stale } = evaluateDeviceGates({
          devices: fullDownloadDevices,
          skus: configs.skus,
          products: configs.products,
          externalAuthorizations: configs.externalAuthorizations ?? [],
          fileKeys: configs.fileKeys,
          sellerUserId,
          manifestDeviceIds: declaredDeviceIds,
        });

        const locked = reasons.filter((r) => r.verdict === "locked");
        const freeDevices = reasons.filter((r) => r.verdict === "free");
        const paidDevices = reasons.filter((r) => r.verdict !== "free");
        const missingEncryption = encryptedDeviceSet
          ? fullDownloadDevices.filter((d) => !encryptedDeviceSet!.has(d))
          : [];
        // pending_manifest_device 分两档：manifest 已声明的只是服务端快照滞后，
        // 合入后必然生效，不报警告；manifest 未声明的才是真的指向不存在的设备。
        const pendingSkus = partitionPendingManifestSkus(stale);

        // 只有「付费却无任何解锁路径」会让用户既不能下载也不能购买，是唯一的硬错误。
        checks.push({
          title: "设备付费门槛与解锁路径自洽（enableAstroBoxCreatorFeatures）",
          status: (() => {
            if (locked.length > 0) return "fail";
            if (missingEncryption.length > 0) return "fail";
            if (stale.rejectedOwnerDevices.length > 0) return "warn";
            if (pendingSkus.missing.length > 0) return "warn";
            return "pass";
          })(),
          detail: (() => {
            const parts: string[] = [];
            for (const r of locked) parts.push(`${r.deviceId}：${describeLockedDevice(r)}`);
            if (missingEncryption.length > 0)
              parts.push(`缺少文件加密密钥的设备：${missingEncryption.join(", ")}`);
            if (stale.rejectedOwnerDevices.length > 0)
              parts.push(
                `以下设备的配置卖家不是资源作者，服务端已永久忽略，不影响用户下载，建议联系作者清理：${stale.rejectedOwnerDevices.join(", ")}`,
              );
            for (const item of pendingSkus.declared)
              parts.push(
                `${item.label}：设备已写入本次 manifest，合入后自动生效（服务端尚未看到本 PR 的索引行，无需处理）`,
              );
            if (pendingSkus.missing.length > 0)
              parts.push(
                `以下 SKU 指向本次 manifest 未声明的设备，合入后不会生效，请让创作者补包体或删除该配置：${pendingSkus.missing.map((item) => item.label).join("，")}`,
              );
            if (parts.length > 0) return parts.join("；");
            if (freeDevices.length > 0 && paidDevices.length === 0)
              return `${freeDevices.length} 个设备均为「仅加密、不售卖」，无需付费映射：${freeDevices.map((r) => r.deviceId).join(", ")}`;
            if (freeDevices.length > 0)
              return `${freeDevices.length} 个设备仅加密不售卖（${freeDevices.map((r) => r.deviceId).join(", ")}），${paidDevices.length} 个设备付费且解锁路径可用`;
            return `${paidDevices.length} 个设备付费，解锁路径均可用（自有购买入口或自有网站授权）`;
          })(),
        });

        // 收了钱却没开「付费」开关：用户不必购买即可下载。
        const unpaidSkuDevices = findUnpaidSkuDevices({
          devices: fullDownloadDevices,
          skus: configs.skus,
        });
        if (unpaidSkuDevices.length > 0) {
          checks.push({
            title: "已配置付费映射但未标记为付费",
            status: "warn",
            detail: `以下设备存在启用中的 SKU，但「付费」开关未打开，服务端视为免费，用户无需购买即可下载：${unpaidSkuDevices.join(", ")}。若确实不收费可忽略；否则请在「配置付费平台映射」中打开「付费」。`,
          });
        }
      }
    } catch (err) {
      cryptoCheckError = err instanceof Error ? err.message : String(err);
    }
  }

  if (creatorFeaturesEnabled && (encryptedDeviceSet === null || cryptoCheckError)) {
    checks.push({
      title: "设备付费门槛与解锁路径自洽（enableAstroBoxCreatorFeatures）",
      status: "manual",
      detail: cryptoCheckError
        ? `校验失败：${cryptoCheckError}`
        : "未登录 AstroBox，无法校验服务端配置",
    });
  }

  if (creatorFeaturesEnabled) {
    // --- check: 启用购买与加密功能但未使用 CC 加密 ---
    // 该开关只应在确实使用 CC 加密（服务端存在加密文件密钥）时开启。
    // 未加密时客户端仍可正常下载，判定降级为 warn 提示明文分发。
    const noEncryptionUsed =
      !cryptoCheckError &&
      encryptedDeviceSet !== null &&
      encryptedDeviceSet.size === 0;
    checks.push({
      title: "启用购买与加密功能但未登记加密文件密钥",
      status: (() => {
        if (!astroboxToken) return "manual";
        if (!cryptoResourceId) return "warn";
        if (cryptoCheckError) return "manual";
        return noEncryptionUsed ? "warn" : "pass";
      })(),
      detail: (() => {
        if (!astroboxToken) return "未登录 AstroBox，无法校验服务端配置";
        if (cryptoCheckError) return `校验失败：${cryptoCheckError}`;
        if (!cryptoResourceId) return "manifest 缺少资源 ID，无法查询服务端配置";
        if (noEncryptionUsed)
          return "未登记任何加密文件密钥，包体将以明文形式存放在公开仓库中。若这是有意为之（仅启用购买校验、不加密包体）可忽略。";
        return "已登记加密文件密钥，加密配置正常";
      })(),
    });
  }

  // --- check: manifest downloads 设备标识有效性 ---
  // fullDeviceKeys / fullResolved / trialResolved 已在付费检查之前算好，此处直接复用。
  const allDeviceTokens = [...fullDeviceKeys, ...trialDeviceKeys];
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

  // --- check: versionCode 随包体更新（warn，非强制） ---
  // 逐设备的结论不塞进 detail：设备一多 detail 会长到没法看，只给「几个包体有问题
  // + 首条」，完整清单挂到「包体内容校验」容器里由右侧明细按钮跳转查看。
  const versionCodeIssuesByDevice = new Map<string, string[]>();
  /** 检查项 detail 只放得下一条原因，过长的报错（如 GitHub API 原文）截断展示。 */
  const truncateForDetail = (text: string, max = 60) =>
    text.length > max ? `${text.slice(0, max)}…` : text;
  {
    const nextDownloads = manifest?.downloads ?? {};
    const nextDeviceIds = Object.keys(nextDownloads);
    const baseEntry = preview.baseEntry;
    let checkStatus: RuleCheckItem["status"] = "pass";
    let checkDetail = "未检测到 downloads 字典，跳过 versionCode 比对";
    if (nextDeviceIds.length > 0) {
      let baseDownloads: Record<
        string,
        { file_name?: string; version?: string; versionCode?: number }
      > = {};
      let baseError = "";
      if (baseEntry) {
        try {
          const fetched = await fetchManifestForCatalogEntry({
            entry: baseEntry,
            token,
            ref: baseEntry.repo_commit_hash,
          });
          baseDownloads = fetched.manifest?.downloads ?? {};
        } catch (err) {
          baseError = err instanceof Error ? err.message : String(err);
        }
      }
      if (baseEntry && baseError && Object.keys(baseDownloads).length === 0) {
        checkStatus = "manual";
        checkDetail = `无法读取旧版本 manifest，跳过 versionCode 比对${
          baseError ? `：${truncateForDetail(baseError)}` : ""
        }`;
      } else {
        // 结论带上设备前缀：包体明细按文件聚合，一行可能对应多个设备。
        const addIssue = (deviceId: string, text: string) => {
          const note = `${deviceId}：${text}`;
          const list = versionCodeIssuesByDevice.get(deviceId);
          if (list) list.push(note);
          else versionCodeIssuesByDevice.set(deviceId, [note]);
        };
        for (const deviceId of nextDeviceIds) {
          const next = nextDownloads[deviceId] ?? {};
          const hasPackage = Boolean((next.file_name ?? "").trim());
          if (!hasPackage) continue;
          const nextCode = next.versionCode;
          const base = baseDownloads[deviceId];
          if (nextCode === undefined || nextCode === null) {
            if (base) {
              const packageChanged =
                (base.file_name ?? "") !== (next.file_name ?? "") ||
                (base.version ?? "") !== (next.version ?? "");
              if (packageChanged) {
                addIssue(
                  deviceId,
                  `versionCode 缺失：包体已更新但未填写（旧 ${base.versionCode ?? "无"}）`,
                );
                continue;
              }
            }
            addIssue(deviceId, "versionCode 缺失：用户将无法自动检测更新");
            continue;
          }
          if (
            base &&
            ((base.file_name ?? "") !== (next.file_name ?? "") ||
              (base.version ?? "") !== (next.version ?? "")) &&
            nextCode === base.versionCode
          ) {
            addIssue(
              deviceId,
              `versionCode 未递增：包体已更新但仍是 ${base.versionCode ?? "无"}`,
            );
          }
        }
        const issueCount = Array.from(versionCodeIssuesByDevice.values()).reduce(
          (n, list) => n + list.length,
          0,
        );
        if (issueCount > 0) {
          checkStatus = "warn";
          checkDetail = `${issueCount} 个包体的 versionCode 有问题：${
            versionCodeIssuesByDevice.values().next().value?.[0] ?? ""
          }${issueCount > 1 ? "（完整清单见右侧明细）" : ""}`;
        } else if (!baseEntry) {
          checkStatus = "pass";
          checkDetail = "所有正式包体均已填写 versionCode";
        } else {
          checkStatus = "pass";
          checkDetail = "更新包体的 versionCode 均已递增或未涉及包体变更";
        }
      }
    }
    checks.push({
      title: "更新包体 versionCode 已递增",
      status: checkStatus,
      detail: checkDetail,
      anchor: "packages",
    });
  }

  // --- check: 小米表盘 version 与 versionCode 一致（versionCode 由 major.minor.patch 派生） ---
  if (entry.restype === "watchface") {
    const mismatches: string[] = [];
    const isKnownNonXiaomi = (deviceId: string) => {
      const vendor = vendorByCanonicalId.get(resolver(deviceId) ?? deviceId);
      return Boolean(vendor) && vendor !== "xiaomi";
    };
    const inspect = (
      downloadsObj:
        | Record<string, { version?: string; versionCode?: number }>
        | undefined,
      label: string,
    ) => {
      for (const [deviceId, info] of Object.entries(downloadsObj ?? {})) {
        if (isKnownNonXiaomi(deviceId)) continue;
        const code = info.versionCode;
        if (code === undefined || code === null) continue;
        const expected = xiaomiVersionCodeFromVersion(info.version ?? "");
        if (expected !== undefined && expected !== code) {
          mismatches.push(
            `${label}${deviceId}：${info.version} 的 versionCode 应为 ${expected}，实为 ${code}`,
          );
        }
      }
    };
    inspect(
      manifest?.downloads as
        | Record<string, { version?: string; versionCode?: number }>
        | undefined,
      "",
    );
    inspect(
      manifest?.ext?.trialDownloads as
        | Record<string, { version?: string; versionCode?: number }>
        | undefined,
      "试用 ",
    );
    checks.push({
      title: "表盘 version 与 versionCode 一致",
      status: mismatches.length === 0 ? "pass" : "warn",
      detail:
        mismatches.length === 0
          ? "表盘 versionCode 与 major.minor.patch 一致"
          : mismatches.join("；"),
    });
  }

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
  const overFailed = imageSizes.filter((i) => i.overLimit === "fail");
  const overWarned = imageSizes.filter((i) => i.overLimit === "warn");
  checks.push({
    title: `图片体积合理（icon ≤ ${formatBytes(ICON_WARN)} / cover ≤ ${formatBytes(COVER_WARN)} / preview ≤ ${formatBytes(PREVIEW_WARN)}）`,
    status: hasFailImage
      ? "fail"
      : hasWarnImage
        ? "warn"
        : missingImageSize
          ? "warn"
          : "pass",
    // 逐张图片的体积见面板底部「图片体积与宽高比」容器，这里只给汇总结论。
    detail: (() => {
      const parts: string[] = [];
      if (overFailed.length > 0)
        parts.push(
          `${overFailed.length} 张超出上限（${Array.from(new Set(overFailed.map((i) => i.label))).join("、")}）`,
        );
      if (overWarned.length > 0)
        parts.push(
          `${overWarned.length} 张偏大（${Array.from(new Set(overWarned.map((i) => i.label))).join("、")}）`,
        );
      if (missingImageSize) parts.push("部分图片未取到体积");
      return parts.length > 0 ? parts.join("；") : "所有图片体积均在发布流程上限内";
    })(),
    anchor: overFailed[0]?.label ? "images" : undefined,
    anchorLabel: overFailed[0]?.label,
  });

  // --- check: 图片宽高比 ---
  // 加载 icon / cover 真实像素尺寸以校验宽高比（icon 1:1，cover 3:2）。
  await Promise.all(
    imageSizes
      .filter((img) => img.label === "icon" || img.label === "cover")
      .map(async (img) => {
        if (!img.url) return;
        const dims = await loadImageDimensions(img.url);
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
    detail: (() => {
      if (ratioInvalid.length > 0)
        return `${ratioInvalid.length} 张宽高比不符（${ratioInvalid
          .map((i) => `${i.label} ${i.ratio?.toFixed(2) ?? "-"}`)
          .join("、")}）`;
      if (ratioMissing.length > 0)
        return `${ratioMissing.map((i) => i.label).join("、")} 未取到尺寸，需人工确认`;
      return "icon 与 cover 宽高比均符合要求";
    })(),
    anchor: ratioInvalid[0]?.label ? "images" : undefined,
    anchorLabel: ratioInvalid[0]?.label,
  });

  // --- check: 外部链接 links 完整且 icon 合法 ---
  const linkResult = validateLinks(manifest?.links);
  checks.push({
    title: "外部链接 links 完整且 icon 可被 AstroBox 渲染",
    status: linkResult.status,
    detail: linkResult.detail,
  });

  // --- check: 作者绑定 AstroBox 声明有效 ---
  // 只校验「声明已绑定 AstroBox」的作者能否匹配到真实账户，与 Creator Pro 权益分开。
  const rawAuthors = manifestItem?.author;
  const authorsList = Array.isArray(rawAuthors) ? rawAuthors : [];
  const declaredBoundNames = authorsList
    .filter((a) => a && a.bindABAccount && typeof a.name === "string" && a.name.trim())
    .map((a) => (a as { name: string }).name.trim());
  const declaredUnboundNames = authorsList
    .filter((a) => a && !a.bindABAccount && typeof a.name === "string" && a.name.trim())
    .map((a) => (a as { name: string }).name.trim());

  let paidRatioResults: PaidRatioResult[] = [];
  let resolvedAuthorStatuses: Record<string, AuthorProStatus> | null = null;

  if (declaredBoundNames.length === 0) {
    checks.push({
      title: "作者绑定 AstroBox 声明有效",
      status: "pass",
      detail:
        declaredUnboundNames.length > 0
          ? `无作者声明绑定 AstroBox；未声明绑定：${declaredUnboundNames.join("、")}`
          : "无作者声明绑定 AstroBox",
    });
  } else if (!astroboxToken) {
    checks.push({
      title: "作者绑定 AstroBox 声明有效",
      status: "warn",
      detail: `未登录 AstroBox，无法验证绑定声明：${declaredBoundNames.join("、")}`,
    });
  } else {
    const authorStatuses = await resolveAuthorProStatuses(declaredBoundNames, astroboxToken);
    resolvedAuthorStatuses = authorStatuses;
    const notFound = declaredBoundNames.filter(
      (n) => authorStatuses[n]?.state === "not-found",
    );
    const errored = declaredBoundNames.filter(
      (n) => authorStatuses[n]?.state === "error",
    );
    // 逐个作者的匹配状态在「资源信息」Tab 的作者列表里已有徽章展示，
    // 这里只给汇总结论，不重复罗列每个作者。
    const parts: string[] = [];
    if (notFound.length > 0) parts.push(`${notFound.length} 个作者未匹配到 AstroBox 账户`);
    if (errored.length > 0) parts.push(`${errored.length} 个作者查询失败`);
    if (declaredUnboundNames.length > 0)
      parts.push(`${declaredUnboundNames.length} 个作者未声明绑定`);
    checks.push({
      title: "作者绑定 AstroBox 声明有效",
      status: notFound.length > 0 ? "fail" : errored.length > 0 ? "warn" : "pass",
      detail: parts.length > 0 ? parts.join("；") : "声明绑定的作者均已匹配到 AstroBox 账户",
    });
  }

  // --- check: 作者 Creator Pro 权益 ---
  // 与绑定声明分离：账户未匹配属于绑定问题，此处只报告已匹配账户的真实权益状态。
  // 免费资源不受 Creator Pro 权益约束（Pro 只是免受 2 免费 : 1 比例限制），
  // 因此本次提交为免费资源时直接判定通过，不再拿作者权益说事。
  const newPaidType = entry.paid_type;
  const newResourceId = manifestItem?.id || entry.id;
  const originalResourceId = preview.originalId;
  const ratioAuthorName = pickRatioAuthorName(authorsList);
  const ratioSubjectIsPaid = isPaidEntry(newPaidType);
  // paid_type 缺省（历史行未写）时无法确定是免费还是付费，仍按原逻辑校验权益。
  const isFreeSubmission = newPaidType != null && !ratioSubjectIsPaid;

  if (isFreeSubmission) {
    checks.push({
      title: "作者 Creator Pro 权益",
      status: "pass",
      detail: "本次提交为免费资源，不受 Creator Pro 权益与付费/免费比例限制，无需校验权益",
    });
  } else if (declaredBoundNames.length === 0) {
    checks.push({
      title: "作者 Creator Pro 权益",
      status: "pass",
      detail: "无声明绑定的作者，无需校验 Creator Pro 权益",
    });
  } else if (!astroboxToken || !resolvedAuthorStatuses) {
    checks.push({
      title: "作者 Creator Pro 权益",
      status: "warn",
      detail: "未登录 AstroBox，无法查询作者 Creator Pro 权益",
    });
  } else {
    const statuses = resolvedAuthorStatuses;
    const foundStatuses = declaredBoundNames
      .map((n) => statuses[n])
      .filter(
        (s): s is Extract<AuthorProStatus, { state: "found" }> => s?.state === "found",
      );
    const allHavePro =
      foundStatuses.length === declaredBoundNames.length &&
      foundStatuses.every(
        (s) => hasCreatorPro(s.user.vip) && isVipActive(s.user.vip, s.user.vipExpireMap),
      );
    checks.push({
      title: "作者 Creator Pro 权益",
      status: allHavePro ? "pass" : "warn",
      // 逐个作者的权益在「资源信息」Tab 的作者列表里已有徽章展示，
      // 这里只给结论，不重复罗列。
      detail: allHavePro
        ? "绑定作者均持有有效 Creator Pro 权益，不受付费/免费比例限制"
        : "存在无有效 Creator Pro 权益的绑定作者，其已发布资源需遵循免费与付费比例规则",
    });
  }

  // --- check: 非 Creator Pro 作者付费/免费资源比例（2 免费 : 1 付费） ---
  // 资源只归属「第一位声明绑定 AstroBox 的作者」，只判他一个人的名下资源。
  if (ratioAuthorName && astroboxToken && resolvedAuthorStatuses) {
    const status = resolvedAuthorStatuses[ratioAuthorName];
    if (status) {
      const result = await checkPaidFreeRatioForAuthor({
        authorName: ratioAuthorName,
        authorStatus: status,
        astroboxToken,
        githubToken: token,
        newEntryPaidType: newPaidType,
        newEntryId: newResourceId,
        originalEntryId: originalResourceId,
      });
      paidRatioResults.push(result);
    }
  }

  if (paidRatioResults.length > 0) {
    const nonCompliant = paidRatioResults.filter(
      (r) => r.status === "checked" && !r.ratio.compliant,
    );
    const errored = paidRatioResults.filter((r) => r.status === "unresolved");
    const pro = paidRatioResults.filter((r) => r.status === "pro");

    checks.push({
      title: "非 Creator Pro 作者付费/免费资源比例（2 免费 : 1 付费）",
      status:
        nonCompliant.length > 0
          ? "fail"
          : errored.length > 0
            ? "warn"
            : "pass",
      // 逐个作者的比例明细由面板底部的「作者已发布资源及付费/免费比例」
      // 容器结构化展示，这里只给结论。
      detail: (() => {
        if (nonCompliant.length > 0)
          return `${ratioAuthorName} 不满足 2 免费 : 1 付费比例`;
        if (errored.length > 0) return `${ratioAuthorName} 的比例无法判断（${errored[0].reason}）`;
        if (pro.length > 0) return `${ratioAuthorName} 持有有效 Creator Pro 权益，不受付费/免费比例限制`;
        return ratioSubjectIsPaid
          ? `${ratioAuthorName} 满足 2 免费 : 1 付费比例`
          : "本次提交为免费资源，不改变付费/免费比例";
      })(),
      anchor: paidRatioResults.some((r) => r.status === "checked" || r.status === "pro")
        ? "paidRatio"
        : undefined,
    });
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
    // 「包体内嵌 ID 与资源 ID 一致」在此分支不输出：没有包体时该结论无意义，
    // 具体明细统一交给下方「包体内容校验」区块。
    pushDisplayNameCheck(checks, restype, manifestName || csvName, []);
  } else {
    const resourceId = manifestId || csvId;

    for (const pkg of uniquePackages) {
      const result: PackageCheckResult = {
        fileName: pkg.fileName,
        devices: pkg.devices,
        kind: pkg.kind,
        url: pkg.url,
        sizeBytes: lookupSize(sizeMap, pkg.fileName),
        version: pkg.versions.length > 0 ? pkg.versions.join("、") : undefined,
        versionCode: pkg.versionCodes.length > 0 ? pkg.versionCodes.join("、") : undefined,
        versionCodeNotes: pkg.devices.flatMap((d) => versionCodeIssuesByDevice.get(d) ?? []),
        detectedType: "unknown",
        effectiveCategory: "other",
        typeMatch: "inconclusive",
        idMatch: "skipped",
      };

      let fetchedBytes: Uint8Array | undefined;
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
        fetchedBytes = bytes;

        result.detectedType = await detectPackageType(bytes, pkg.fileName, result.sizeBytes);

        // 加密包识别：密文不含包体魔数，会被 detectPackageType 误判为 binary。
        // 优先用完整内容哈希精确匹配服务端登记的加密文件密钥；超大包仅取头部
        // 无法算全量哈希时，再按“该设备已登记加密密钥且头部非已知包体”兜底。
        let encrypted = false;
        let encryptedByHash = false;
        if (encryptedHashSet.size > 0 && !result.skipped) {
          const hash = await computePackageHash(new Blob([bytes as BlobPart]));
          encrypted = encryptedHashSet.has(hash);
          encryptedByHash = encrypted;
        }
        if (
          !encrypted &&
          result.detectedType === "binary" &&
          encryptedDeviceSet &&
          pkg.devices.some((device) => encryptedDeviceSet!.has(device))
        ) {
          encrypted = true;
        }
        if (encrypted) {
          result.encrypted = true;
          result.encryptedByHash = encryptedByHash;
          result.skipped = true;
          result.detectedType = "encrypted";
          result.effectiveCategory = "other";
          result.typeMatch = "inconclusive";
          result.idMatch = "skipped";
          attachDisplayName(result, restype, manifestName || csvName);
          packageChecks.push(result);
          continue;
        }

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

        // 资源包（CRPack）走专用解析：按内容识别，不看后缀。
        // 审核侧只读不改写包体，包内 themeId 与 CSV id 不一致直接判不通过。
        if (restype === "res_pack") {
          if (result.skipped) {
            result.typeMatch = "inconclusive";
            result.idMatch = "skipped";
          } else {
            const inspection = inspectResPack(bytes, resourceId || undefined);
            result.detectedType = inspection.ok ? "zip" : "unknown";
            result.effectiveCategory = "other";
            result.typeMatch = inspection.ok ? "match" : "mismatch";
            const themeId = inspection.contents?.themeId;
            result.detectedId = themeId;
            result.idMatch = !resourceId
              ? "skipped"
              : inspection.errors.some((e) => e.includes("与资源 ID"))
                ? "mismatch"
                : "match";
            if (inspection.errors.length > 0) result.resPackErrors = inspection.errors;

            const summary: string[] = [];
            if (inspection.contents) {
              summary.push(`清单 ${inspection.contents.manifestName}`);
              summary.push(
                `规则 ${inspection.ruleCount} 条（mappings ${inspection.contents.mappings.length} + quickappIcons ${inspection.contents.quickappIcons.length}）`,
              );
              // 实算字节只展示；仅当真超 32768 / 256 条才在上面的 errors 里判不通过。
              summary.push(`派生 mappings.tsv 约 ${inspection.tsvBytes} 字节`);
              summary.push(
                `包内版本 ${inspection.contents.version ?? "-"}（versionCode ${inspection.contents.versionCode ?? "-"}）`,
              );
              for (const mapping of inspection.contents.mappings) {
                summary.push(`映射 ${mapping.source} → ${mapping.destination}`);
              }
              for (const icon of inspection.contents.quickappIcons) {
                summary.push(`图标 @quickapp-icon/${icon.package} → ${icon.destination}`);
              }
            }
            if (summary.length > 0) result.resPackSummary = summary;
          }
        }

        // 快应用 rpk 的 debug 调试包判定。
        // - result.skipped（超大包只取头部）时字节被截断，zip 中央目录与签名块
        //   都不在手上，无法判定。
        // - 加密包已在上面 continue，签名块已被密文破坏。
        // - 只对确认为快应用类别的包体执行，表盘/固件/canopus 不适用。
        if (
          !result.skipped &&
          !result.encrypted &&
          restype !== "canopus" &&
          result.effectiveCategory === "quick_app"
        ) {
          result.debugVerdict = await detectRpkDebug(bytes);
        }
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        result.typeMatch = "inconclusive";
        result.idMatch = "skipped";
      }

      attachDisplayName(result, restype, manifestName || csvName, fetchedBytes);
      packageChecks.push(result);
    }

    // 聚合：类型匹配
    const typeMismatch = packageChecks.filter((p) => p.typeMatch === "mismatch");
    const typeInconclusive = packageChecks.filter(
      (p) => p.typeMatch === "inconclusive" && !p.encrypted,
    );
    const encryptedCount = packageChecks.filter((p) => p.encrypted).length;
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
          ? "模块（canopus）包体不做类型强校验"
          : (typeInconclusive.length > 0 ? "部分包体类型无法确认，需要人工复核。" : "") +
            (encryptedCount > 0 ? `${encryptedCount} 个包体已加密，跳过内容校验。` : "") +
            (typeMismatch.length > 0
              ? `${typeMismatch.length} 个包体类型与资源类别不匹配。`
              : "包体类型与资源类别一致。"),
      anchor: "packages",
    });

    // 内嵌 ID 聚合结论：明细不重复罗列（下方「包体内容校验」已逐包体结构化展示
    // 匹配结果与检测到的 ID），这里只作为标记项保留，保证该项异常时列表顶部
    // 就有醒目条目，不会因为「只有这一个问题」而被漏看。
    const idMismatch = packageChecks.filter((p) => p.idMatch === "mismatch");
    const idSkippedAll = packageChecks.every((p) => p.idMatch === "skipped");
    checks.push({
      title: "包体内嵌 ID 与资源 ID 一致",
      status:
        idMismatch.length > 0
          ? "fail"
          : restype === "watchface" || restype === "canopus"
            ? "pass"
            : idSkippedAll
              ? "warn"
              : "pass",
      detail: (() => {
        if (restype === "watchface")
          return "表盘安装时会强制改写 ID 文件，无需校验包体内嵌 ID";
        if (restype === "canopus") return "模块包体内嵌 ID 不做强制校验";
        if (idMismatch.length > 0)
          return `${idMismatch.length} 个包体内嵌 ID 与资源 ID 不一致`;
        if (idSkippedAll) return "所有包体均跳过内嵌 ID 校验";
        return `全部 ${packageChecks.length} 个包体内嵌 ID 与资源 ID 一致`;
      })(),
      anchor: "packages",
    });

    // 包内展示名和资源名对不上只警告：设备上看到的名字和商店标题可以人工放行。
    pushDisplayNameCheck(checks, restype, manifestName || csvName, packageChecks);

    // 资源包（CRPack）专项：结构合法性、预算实算与改名痕迹。
    if (restype === "res_pack") {
      const withSummary = packageChecks.filter((p) => p.resPackSummary?.length);
      const broken = packageChecks.filter((p) => p.resPackErrors?.length);
      checks.push({
        title: "CRPack 结构合法性与清单文件名",
        status: broken.length > 0 ? "fail" : withSummary.length > 0 ? "pass" : "manual",
        detail:
          broken.length > 0
            ? `${broken.length} 个资源包未通过 CRPack 校验：${broken
                .flatMap((p) => p.resPackErrors ?? [])
                .slice(0, 3)
                .join("；")}`
            : withSummary.length > 0
              ? `${withSummary.length} 个资源包解析通过，清单名为 corona.json`
              : "未能解析到资源包内容，需人工确认上传的包体",
        anchor: "packages",
      });

      // 规则数与 TSV 预算只展示实算值：仅当真超 32768 字节 / 256 条才判不通过，
      // 接近上限不告警，也不计算跨包聚合（发布时无从得知用户装了哪些包）。
      const overBudget = broken.filter((p) =>
        p.resPackErrors?.some(
          (e) => e.includes("32 KiB") || e.includes(`超过设备上限 256 条`),
        ),
      );
      checks.push({
        title: "映射规则数与派生 mappings.tsv 预算",
        status: overBudget.length > 0 ? "fail" : "pass",
        detail: overBudget.length > 0
          ? `${overBudget.length} 个资源包超出设备 32 KiB / 256 条预算`
          : withSummary.length > 0
            ? "规则数与派生 mappings.tsv 均在设备预算内"
            : "无可核算的资源包",
        anchor: "packages",
      });

      // themeId 就是设备上的主题目录名，改 id 等于换目录，旧目录会残留。
      const renamed =
        preview.originalId &&
        preview.originalId !== preview.entry.id &&
        preview.originalId.trim() !== "";
      checks.push({
        title: "资源 ID 未改名（设备主题目录唯一）",
        status: renamed ? "warn" : "pass",
        detail: renamed
          ? `本次将资源 ID 从「${preview.originalId}」改为「${preview.entry.id}」，包内 themeId 随之改写。改名等于换设备主题目录，旧目录会残留在设备上，用户会看到两个主题。`
          : "资源 ID 未变更，设备主题目录保持稳定。",
      });
    }

    // 工具链只有 `aiot release`（PRODUCTION）才要求开发者私钥，PRODUCTION 的证书
    // 候选里没有内置证书，因此命中内置调试证书即等价于「这是调试构建产物」。
    // 明细逐包展示在下方「包体内容校验」中，这里与上面两项一致，只给结论标记。
    const debugChecked = packageChecks.filter((p) => p.debugVerdict);
    if (debugChecked.length > 0) {
      const debugFail = debugChecked.filter((p) => p.debugVerdict?.level === "fail");
      const debugWarn = debugChecked.filter((p) => p.debugVerdict?.level === "warn");
      const debugSkip = debugChecked.filter((p) => p.debugVerdict?.level === "skip");
      const debugPass = debugChecked.filter((p) => p.debugVerdict?.level === "pass");
      checks.push({
        title: "快应用包体为正式发布包（非 debug 调试包）",
        status:
          debugFail.length > 0
            ? "fail"
            : debugWarn.length > 0
              ? "warn"
              : debugSkip.length === debugChecked.length
                ? "manual"
                : "pass",
        detail: (() => {
          const parts: string[] = [];
          if (debugFail.length > 0) {
            const names = debugFail
              .map((p) => p.fileName)
              .slice(0, 3)
              .join("、");
            parts.push(
              `${debugFail.length} 个包体是调试包（${names}${debugFail.length > 3 ? " 等" : ""}），需要求创作者用 \`aiot release\` 重新打包。`,
            );
          }
          if (debugWarn.length > 0) {
            const ids = [
              ...new Set(debugWarn.flatMap((p) => p.debugVerdict?.soft ?? [])),
            ];
            parts.push(
              `${debugWarn.length} 个包体命中软证据（${ids.join("、")}），建议人工确认。`,
            );
          }
          if (debugSkip.length > 0) {
            parts.push(`${debugSkip.length} 个包体无法验签，需人工确认。`);
          }
          if (parts.length === 0) {
            parts.push(`全部 ${debugPass.length} 个快应用包体均为正式发布包。`);
          }
          return parts.join("");
        })(),
        anchor: "packages",
      });
    }
  }

  // --- check: 已加密上传但未开启 enableAstroBoxCreatorFeatures ---
  // 客户端依据 ext.enableAstroBoxCreatorFeatures 决定是否请求加密文件密钥并解密；
  // 开关关闭时密文直接进入包体类型嗅探必然失败（AES-256-ECB 密文不含已知魔数），
  // 最终在设备上安装时报未知资源类型。
  //
  // encryptOnUpload 不写入 manifest，审核侧无法直接读取，因此以「包体是否确为密文」
  // 为准：完整内容哈希精确命中才是 fail；仅由「头部非已知包体」兜底判定的，
  // 以及因超大包只取头部或拉取失败而无法确认的，都只提示人工复核，避免误伤
  // 曾经加密过、后来改为明文的资源（服务端密钥会残留）。
  if (!creatorFeaturesEnabled) {
    const encryptedPackages = packageChecks.filter((p) => p.encrypted);
    const confirmedEncrypted = encryptedPackages.filter((p) => p.encryptedByHash);
    const heuristicEncrypted = encryptedPackages.filter((p) => !p.encryptedByHash);
    const unverifiableEncryptedDevices = Array.from(
      new Set(
        packageChecks
          .filter(
            (p) =>
              !p.encrypted &&
              (p.skipped || p.error) &&
              p.kind === "正式包" &&
              p.devices.some((d) => encryptedDeviceSet?.has(d)),
          )
          .flatMap((p) => p.devices),
      ),
    );
    checks.push({
      title: "已加密上传但未开启 enableAstroBoxCreatorFeatures",
      status: (() => {
        if (!astroboxToken) return "manual";
        if (!cryptoResourceId) return "warn";
        if (cryptoCheckError) return "manual";
        if (confirmedEncrypted.length > 0) return "fail";
        if (heuristicEncrypted.length > 0 || unverifiableEncryptedDevices.length > 0)
          return "manual";
        return "pass";
      })(),
      detail: (() => {
        if (!astroboxToken) return "未登录 AstroBox，无法校验服务端加密配置";
        if (cryptoCheckError) return `校验失败：${cryptoCheckError}`;
        if (!cryptoResourceId) return "manifest 缺少资源 ID，无法查询服务端加密配置";
        const parts: string[] = [];
        if (confirmedEncrypted.length > 0)
          parts.push(
            `以下包体内容与已登记的加密文件密钥完全一致，确认仍为密文：${confirmedEncrypted
              .map((p) => p.fileName)
              .join(", ")}。客户端不会请求加密密钥、不解密包体，安装必然失败；请要求创作者开启 ext.enableAstroBoxCreatorFeatures 后重新提交。`,
          );
        if (heuristicEncrypted.length > 0)
          parts.push(
            `以下包体疑似密文（内容哈希与已登记密钥不一致，仅能按头部判定）：${heuristicEncrypted
              .map((p) => p.fileName)
              .join(", ")}，请人工确认。`,
          );
        if (unverifiableEncryptedDevices.length > 0)
          parts.push(
            `以下设备登记过加密文件密钥，但对应包体内容无法确认（超大包仅取头部或拉取失败）：${unverifiableEncryptedDevices.join(
              ", ",
            )}，请人工核对是否仍为密文。`,
          );
        if (parts.length === 0) return "未检测到密文包体，与未开启该开关一致";
        return parts.join("；");
      })(),
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
    case "encrypted":
      return "已加密";
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

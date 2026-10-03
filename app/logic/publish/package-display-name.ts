import { unzipSync, type Unzipped } from "fflate";
import { parseCrpack } from "./crpack-validate";
import {
  findInnerBinName,
  pickManifestName,
  WATCHFACE_MAGIC,
  ZIP_MAGIC,
} from "./package-version";

/**
 * 从包体里读出设备上实际展示的名字，供审核时和资源名对比。
 *
 * 读法对齐 AstroBox-NG：
 * - 快应用 rpk：`manifest.json` 的 `name`（Vivo 为字符串；小米还可能是语言表或
 *   `${message.xxx}`，后者到 `i18n/zh-CN.json` 里取）。见
 *   `device/vivo/quickapp_manifest.rs`。
 * - 表盘：`.bin` 文件头 offset 104 的名称；`0xffffffff` 时按译文表取 zh_CN
 *   （`watchface_edit/bin_decompiler/parse.rs`）。`.mwz` 没有可用文件头时回退
 *   `description.xml` 的 `<name>`。Vivo 表盘 rpk 用 `manifest.json` 的 `name`。
 * - 资源包：`corona.json` / `canora.json` 的 `name`（`device/crpack.rs`）。
 *
 * 对不上只警告，不作为不通过。
 */

export type DisplayNameKind = "watchface" | "quick_app" | "res_pack";

export interface PackageDisplayName {
  name?: string;
  /** 名字从包内哪个位置读到，写进审核明细。 */
  source?: string;
  reason?: string;
}

export interface PackageNameVerdict {
  contentName?: string;
  contentNameSource?: string;
  nameMatch: "match" | "mismatch" | "skipped";
  nameNote?: string;
}

export interface DisplayNameObservation {
  fileName: string;
  status: "match" | "mismatch" | "skipped";
  contentName?: string;
  source?: string;
  note?: string;
}

const HEADER_BASE_LEN = 168;
const THEME_TABLE_PRE_LEN = 8;
const THEME_TABLE_ROW_LEN = 8;
const THEME_EXTENDED_LEN = 72;
const RECORD_LEN = 16;
const TYPE_TRANSLATION = 0x06;
const NAME_OFFSET = 104;
const NAME_FIELD_LEN = 64;

/** 与 NG `dict.rs` 的 `language_name` 顺序一致，下标 1 是 zh_CN。 */
const WATCHFACE_LANGS = [
  "en_US", "zh_CN", "zh_TW", "ja_JP", "es_ES", "fr_FR", "de_DE", "ru_RU", "pt_BR", "pt_PT",
  "it_IT", "ko_KR", "tr_TR", "nl_NL", "th_TH", "sv_SE", "da_DK", "vi_VN", "nb_NO", "pl_PL",
  "fi_FI", "in_ID", "el_GR", "ro_RO", "cs_CZ", "uk_UA", "hu_HU", "sk_SK", "zh_HK", "iw_IL",
  "ar_EG", "lt_LT", "bg_BG",
];

const LOCALE_KEYS = ["zh-CN", "zh_CN", "zh-Hans-CN", "zh-Hans", "zh"];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function readU32(data: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > data.length) return undefined;
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function readCstr(data: Uint8Array, offset: number, maxLen: number): string {
  if (offset >= data.length || maxLen <= 0) return "";
  const end = Math.min(offset + maxLen, data.length);
  let len = 0;
  while (offset + len < end && data[offset + len] !== 0) len += 1;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(offset, offset + len))
    .trim();
}

function languageName(index: number): string {
  return WATCHFACE_LANGS[index] ?? "unknown";
}

export function normalizeDisplayName(value: string): string {
  return value.normalize("NFC").trim();
}

export function displayNamesMatch(resourceName: string, contentName: string): boolean {
  const expected = normalizeDisplayName(resourceName);
  const actual = normalizeDisplayName(contentName);
  return expected !== "" && expected === actual;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function unzipEntries(bytes: Uint8Array): Unzipped | undefined {
  if (!startsWith(bytes, ZIP_MAGIC)) return undefined;
  try {
    return unzipSync(bytes);
  } catch {
    return undefined;
  }
}

function findEntry(entries: Unzipped, baseName: string): string | undefined {
  const target = baseName.toLowerCase();
  const names = Object.keys(entries);
  return (
    names.find((name) => name.toLowerCase() === target) ??
    names.find((name) => name.split(/[\\/]/).pop()?.toLowerCase() === target)
  );
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
  const text = pattern.exec(xml)?.[1];
  if (!text) return undefined;
  const decoded = decodeXmlText(text);
  return decoded || undefined;
}

function readLocalizedName(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of LOCALE_KEYS) {
    const hit = record[key];
    if (typeof hit === "string" && hit.trim()) return hit.trim();
  }
  for (const hit of Object.values(record)) {
    if (typeof hit === "string" && hit.trim()) return hit.trim();
  }
  return undefined;
}

function lookupI18n(entries: Unzipped, key: string): string | undefined {
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  const preferred = ["i18n/zh-CN.json", "i18n/zh_CN.json", "i18n/zh-Hans.json", "i18n/zh.json"];
  const files = [
    ...preferred.filter((name) => entries[name]),
    ...Object.keys(entries).filter(
      (name) => /(?:^|\/)i18n\/[^/]+\.json$/i.test(name) && !preferred.includes(name),
    ),
  ];
  for (const file of files) {
    const json = parseJsonObject(entries[file]);
    if (!json) continue;
    let cursor: unknown = json;
    for (const part of parts) {
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
    const last = parts[parts.length - 1];
    const message = json.message;
    if (message && typeof message === "object" && !Array.isArray(message)) {
      const hit = (message as Record<string, unknown>)[last];
      if (typeof hit === "string" && hit.trim()) return hit.trim();
    }
  }
  return undefined;
}

function resolveNameValue(value: unknown, entries: Unzipped): string | undefined {
  const raw = readLocalizedName(value);
  if (!raw) return undefined;
  const placeholder =
    raw.match(/^\$\{(.+)\}$/)?.[1]?.trim() ||
    raw.match(/^\$t\(['"](.+)['"]\)$/)?.[1]?.trim();
  if (!placeholder) return raw;
  return lookupI18n(entries, placeholder);
}

function readManifestDisplayName(entries: Unzipped): PackageDisplayName | undefined {
  const manifestName = pickManifestName(entries);
  const watchName = Object.keys(entries).find(
    (name) => name.split(/[\\/]/).pop() === "manifest-watch.json",
  );
  for (const [file, source] of [
    [manifestName, "manifest.json"],
    [watchName, "manifest-watch.json"],
  ] as const) {
    if (!file) continue;
    const manifest = parseJsonObject(entries[file]);
    if (!manifest) continue;
    const direct = resolveNameValue(manifest.name, entries);
    if (direct) return { name: direct, source };
    const router = manifest.router;
    const watchfaces =
      router && typeof router === "object" && !Array.isArray(router)
        ? (router as Record<string, unknown>).watchfaces
        : undefined;
    if (watchfaces && typeof watchfaces === "object" && !Array.isArray(watchfaces)) {
      for (const item of Object.values(watchfaces as Record<string, unknown>)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const named = resolveNameValue((item as Record<string, unknown>).name, entries);
        if (named) return { name: named, source };
      }
    }
  }
  return undefined;
}

function readHeaderName(data: Uint8Array): string {
  if (readU32(data, NAME_OFFSET) === 0xffffffff) {
    const uid = readU32(data, NAME_OFFSET + 4) ?? (TYPE_TRANSLATION << 24);
    return `@translation_${uid.toString(16).padStart(8, "0")}`;
  }
  return readCstr(data, NAME_OFFSET, NAME_FIELD_LEN);
}

function translationUid(name: string): number | undefined {
  const hex = name.startsWith("@translation_") ? name.slice("@translation_".length) : "";
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value >>> 0 : undefined;
}

interface ThemeTable {
  rtype: number;
  count: number;
  addr: number;
}

function readThemeRows(data: Uint8Array, headerLen: number, themeCount: number, tableCount: number, extended: boolean): ThemeTable[][] | undefined {
  const baseLen = THEME_TABLE_PRE_LEN + tableCount * THEME_TABLE_ROW_LEN;
  let offset = headerLen;
  const rows: ThemeTable[][] = [];
  for (let index = 0; index < themeCount; index += 1) {
    if (offset + baseLen > data.length) return undefined;
    const tables: ThemeTable[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const tableOff = offset + THEME_TABLE_PRE_LEN + i * THEME_TABLE_ROW_LEN;
      const count = readU32(data, tableOff);
      const addr = readU32(data, tableOff + 4);
      if (count === undefined || addr === undefined) return undefined;
      tables.push({ rtype: i, count, addr });
    }
    let rowLen = baseLen;
    if (extended) {
      if (offset + baseLen + THEME_EXTENDED_LEN > data.length) return undefined;
      const typeAndCount = readU32(data, offset + baseLen + 68) ?? 0;
      const colorCount = typeAndCount >>> 2;
      rowLen += THEME_EXTENDED_LEN + colorCount * 4;
      if (offset + rowLen > data.length) return undefined;
    }
    rows.push(tables);
    offset += rowLen;
  }
  return rows;
}

function scoreThemeRows(data: Uint8Array, rows: ThemeTable[][]): number {
  let score = 0;
  for (const tables of rows) {
    for (const table of tables) {
      if (table.count === 0) {
        score += 1;
        continue;
      }
      const start = table.addr;
      const end = start + table.count * RECORD_LEN;
      if (end > data.length) continue;
      score += 4;
      const sample = Math.min(table.count, 8);
      for (let i = 0; i < sample; i += 1) {
        const off = start + i * RECORD_LEN;
        const uid = readU32(data, off) ?? 0;
        const dataAddr = readU32(data, off + 8) ?? 0;
        const dataLen = readU32(data, off + 12) ?? 0;
        const uidType = (uid >>> 24) & 0xff;
        if (uidType === table.rtype && dataLen > 0 && dataAddr + dataLen <= data.length) {
          score += 8;
        }
      }
    }
  }
  return score;
}

function collectTranslationRecords(data: Uint8Array): Map<number, Uint8Array> {
  const records = new Map<number, Uint8Array>();
  if (data.length < HEADER_BASE_LEN) return records;
  const protocolWord = readU32(data, 16) ?? 0x800;
  const protocol = (protocolWord >>> 8) & 0xff;
  const tableCount = protocol > 8 ? 12 : 10;
  const colorGroupCount = data[24] ?? 0;
  const themeCount = data[28] ?? 0;
  const recolorCount = data[29] ?? 0;
  const colorCount = Math.max(recolorCount, colorGroupCount);
  const headerLen = HEADER_BASE_LEN + colorCount * 4;
  if (themeCount === 0) return records;

  let best: { score: number; extended: boolean; rows: ThemeTable[][] } | undefined;
  for (const extended of [false, true]) {
    const rows = readThemeRows(data, headerLen, themeCount, tableCount, extended);
    if (!rows) continue;
    const score = scoreThemeRows(data, rows);
    if (
      !best ||
      score > best.score ||
      (score === best.score && extended && !best.extended)
    ) {
      best = { score, extended, rows };
    }
  }
  if (!best) return records;

  for (const tables of best.rows) {
    for (const table of tables) {
      if (table.rtype !== TYPE_TRANSLATION || table.count === 0 || table.addr === 0) continue;
      for (let i = 0; i < table.count; i += 1) {
        const off = table.addr + i * RECORD_LEN;
        const uid = readU32(data, off);
        const dataAddr = readU32(data, off + 8);
        const dataLen = readU32(data, off + 12);
        if (uid === undefined || !dataAddr || !dataLen) continue;
        if (dataAddr + dataLen > data.length) continue;
        if (!records.has(uid)) {
          records.set(uid, data.subarray(dataAddr, dataAddr + dataLen));
        }
      }
    }
  }
  return records;
}

function firstTranslationString(record: Uint8Array): string | undefined {
  if (record.length < 12) return undefined;
  const flags = readU32(record, 0);
  const reserved = readU32(record, 4) ?? 0;
  if (flags === undefined) return undefined;
  const languages: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    if (((flags >>> i) & 1) === 1) languages.push(i);
  }
  for (let i = 0; i < 32; i += 1) {
    if (((reserved >>> i) & 1) === 1) languages.push(i + 32);
  }
  if (languages.length === 0) return undefined;
  let offset = 8;
  const lengths: number[] = [];
  for (let i = 0; i < languages.length; i += 1) {
    const len = readU32(record, offset);
    if (len === undefined) return undefined;
    lengths.push(len);
    offset += 4;
  }
  let fallback: string | undefined;
  for (let i = 0; i < languages.length; i += 1) {
    const len = lengths[i] ?? 0;
    if (len === 0 || offset + len > record.length) continue;
    const text = new TextDecoder("utf-8", { fatal: false })
      .decode(record.subarray(offset, offset + len))
      .trim();
    if (text) {
      if (languageName(languages[i] ?? -1) === "zh_CN") return text;
      fallback ??= text;
    }
    offset += len;
  }
  return fallback;
}

function resolveTranslationName(data: Uint8Array, headerName: string): string | undefined {
  const uid = translationUid(headerName) ?? (TYPE_TRANSLATION << 24);
  const record = collectTranslationRecords(data).get(uid);
  if (!record) return undefined;
  return firstTranslationString(record);
}

/** 小米表盘二进制里的展示名。魔数不对时返回 undefined，调用方再试别的容器。 */
function readWatchfaceBinName(bytes: Uint8Array): PackageDisplayName | undefined {
  if (!startsWith(bytes, WATCHFACE_MAGIC)) return undefined;
  if (bytes.length < HEADER_BASE_LEN) {
    return { reason: "表盘文件过短，读不到名称字段" };
  }
  const header = readHeaderName(bytes);
  const resolved =
    !header || header.startsWith("@") ? resolveTranslationName(bytes, header) : header;
  if (!resolved || resolved.startsWith("@")) {
    return {
      reason: header.startsWith("@")
        ? "表盘名是翻译引用，未能解析出文本"
        : "表盘文件头没有名称",
    };
  }
  return { name: resolved, source: "表盘文件头" };
}

function readDescriptionName(entries: Unzipped): string | undefined {
  const file = findEntry(entries, "description.xml");
  if (!file) return undefined;
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(entries[file]);
  return extractXmlTag(xml, "name");
}

function readWatchfaceName(bytes: Uint8Array): PackageDisplayName {
  const direct = readWatchfaceBinName(bytes);
  if (direct?.name) return direct;
  if (!startsWith(bytes, ZIP_MAGIC)) {
    return direct ?? { reason: "不是可解析的表盘文件" };
  }
  const entries = unzipEntries(bytes);
  if (!entries) return { reason: "无法解压表盘包" };
  const binName = findInnerBinName(entries);
  if (binName) {
    const fromBin = readWatchfaceBinName(entries[binName]);
    if (fromBin?.name) return fromBin;
  }
  const description = readDescriptionName(entries);
  if (description) return { name: description, source: "description.xml" };
  const manifest = readManifestDisplayName(entries);
  if (manifest?.name) return manifest;
  return direct ?? { reason: "未找到表盘名（文件头、description.xml、manifest.json 都没有）" };
}

function readQuickAppName(bytes: Uint8Array): PackageDisplayName {
  const entries = unzipEntries(bytes);
  if (!entries) return { reason: "无法解压快应用包，读不到 manifest.json" };
  const named = readManifestDisplayName(entries);
  if (named?.name) return named;
  return { reason: "manifest.json 没有可用的 name" };
}

function readResPackName(bytes: Uint8Array): PackageDisplayName {
  try {
    const contents = parseCrpack(bytes);
    const name = contents.manifest.name;
    if (typeof name === "string" && name.trim()) {
      return { name: name.trim(), source: contents.manifestName };
    }
    return { reason: `${contents.manifestName} 没有可用的 name` };
  } catch (error) {
    const entries = unzipEntries(bytes);
    if (entries) {
      for (const file of ["corona.json", "canora.json"]) {
        const raw = entries[file];
        if (!raw) continue;
        const manifest = parseJsonObject(raw);
        const name = manifest && typeof manifest.name === "string" ? manifest.name.trim() : "";
        if (name) return { name, source: file };
      }
    }
    return {
      reason: error instanceof Error ? error.message : "无法解析资源包清单",
    };
  }
}

export function readPackageDisplayName(
  bytes: Uint8Array,
  kind: DisplayNameKind,
): PackageDisplayName {
  if (kind === "watchface") return readWatchfaceName(bytes);
  if (kind === "quick_app") return readQuickAppName(bytes);
  return readResPackName(bytes);
}

export function judgePackageDisplayName(input: {
  bytes?: Uint8Array;
  kind: DisplayNameKind;
  resourceName: string;
  skipped?: boolean;
  encrypted?: boolean;
  error?: string;
}): PackageNameVerdict {
  if (input.encrypted) {
    return { nameMatch: "skipped", nameNote: "包体已加密" };
  }
  if (input.skipped) {
    return { nameMatch: "skipped", nameNote: "包体过大，仅读取了头部" };
  }
  if (!input.bytes) {
    return { nameMatch: "skipped", nameNote: input.error || "未能读取包体" };
  }
  if (!normalizeDisplayName(input.resourceName)) {
    return { nameMatch: "skipped", nameNote: "缺少资源名" };
  }
  const found = readPackageDisplayName(input.bytes, input.kind);
  if (!found.name) {
    return { nameMatch: "skipped", nameNote: found.reason || "未能读取包内名称" };
  }
  const matched = displayNamesMatch(input.resourceName, found.name);
  return {
    contentName: found.name,
    contentNameSource: found.source,
    nameMatch: matched ? "match" : "mismatch",
  };
}

function listLimited(items: string[], limit = 4): string {
  if (items.length <= limit) return items.join("；");
  return `${items.slice(0, limit).join("；")} 等`;
}

function formatContent(item: DisplayNameObservation): string {
  const source = item.source ? `（${item.source}）` : "";
  return `${item.fileName} 为「${item.contentName ?? ""}」${source}`;
}

/** 汇总成审核条目。不一致或读不到名字都是 warn，不会是 fail。 */
export function summarizeDisplayNameCheck(
  resourceName: string,
  observations: DisplayNameObservation[],
): { status: "pass" | "warn"; detail: string } {
  const expected = normalizeDisplayName(resourceName);
  if (!expected) {
    return { status: "warn", detail: "缺少资源名，无法与包内名称比对" };
  }
  if (observations.length === 0) {
    return { status: "warn", detail: "未检测到包体，无法比对包内名称" };
  }
  const mismatches = observations.filter((item) => item.status === "mismatch");
  const skipped = observations.filter((item) => item.status === "skipped");
  const matched = observations.filter((item) => item.status === "match");
  if (mismatches.length === 0 && skipped.length === 0) {
    return {
      status: "pass",
      detail: `全部 ${matched.length} 个包体内名称与资源名「${expected}」一致`,
    };
  }
  const parts: string[] = [];
  if (mismatches.length > 0) {
    const extra = matched.length > 0 ? `。另有 ${matched.length} 个包体一致` : "";
    parts.push(
      `资源名「${expected}」与包内名称不一致：${listLimited(mismatches.map(formatContent))}${extra}`,
    );
  } else if (matched.length > 0) {
    parts.push(`已读取的包体内名称与资源名「${expected}」一致`);
  }
  if (skipped.length > 0) {
    parts.push(
      `未能读取包内名称：${listLimited(
        skipped.map((item) => `${item.fileName}${item.note ? `（${item.note}）` : ""}`),
      )}`,
    );
  }
  return { status: "warn", detail: parts.join("。") };
}

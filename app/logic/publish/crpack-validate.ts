import { inflateSync, zipSync, type Zippable } from "fflate";

/**
 * CRPack（Canopus 资源包）解析与校验。
 *
 * 规范是「按内容识别，从不看扩展名」：ZIP magic + 根目录唯一清单 + 清单里的
 * format 标记三者齐备才算 CRPack。校验规则移植自 Corona CRPack Builder 的
 * `corona-core/src/crpack.rs`，目的是在包体进入仓库前拦住「必然失败」的包——
 * 设备端 themeId 校验发生在下载完成之后，届时无法挽回。
 */

export const CORONA_MANIFEST_NAME = "corona.json";
export const LEGACY_CORONA_MANIFEST_NAME = "canora.json";
export const CRPACK_FORMAT = "canopus-resource-pack";
export const CRPACK_FORMAT_VERSION = 1;

/** 清单大小上限（含），设备端 MAX_MANIFEST_BYTES。 */
export const MAX_MANIFEST_BYTES = 64 * 1024;
/** 总解压字节上限（含清单）。 */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** ZIP 中央目录 sanity 边界。 */
export const MAX_ARCHIVE_ENTRIES = 16384;
/** 手表端 native 模块的派生 mappings.tsv 字节预算。 */
export const MAX_TSV_BYTES = 32 * 1024;
/** 手表端 native 模块的活动映射条数上限（mappings + quickappIcons 合并计数）。 */
export const MAX_RULES = 256;
/** 映射路径字段上限（UTF-8 字节）。 */
export const MAX_PATH_BYTES = 255;
/** versionCode 取 32 位上限，与客户端解析能力一致（corona-core 允许 2^53−1）。 */
export const MAX_VERSION_CODE = 2147483647;
/** 设备端绝对路径固定前缀的字节数。 */
const DEVICE_PATH_PREFIX_BYTES = 48;
const DEVICE_PATH_LIMIT = 256;

const LEGACY_MANIFEST_HINT =
  "该包使用旧清单名 canora.json，请用 Corona CRPack Builder 1.0.6 或更高版本重新导出后再发布";

export interface CrpackEntry {
  path: string;
  bytes: Uint8Array;
  /** ZIP 压缩方法：0 = Stored，8 = Deflated。 */
  compression: number;
}

export interface CrpackMapping {
  source: string;
  destination: string;
}

export interface CrpackQuickappIcon {
  package: string;
  destination: string;
}

export interface CrpackContents {
  entries: CrpackEntry[];
  manifestName: string;
  manifestRaw: Uint8Array;
  manifest: Record<string, unknown>;
  /** manifest.themeId 存在且为字符串时的原值。 */
  themeId: string;
  version?: string;
  versionCode?: number;
  mappings: CrpackMapping[];
  quickappIcons: CrpackQuickappIcon[];
  /** 实际解压后的总字节数（含清单）。 */
  totalBytes: number;
}

export interface ResPackInspection {
  ok: boolean;
  errors: string[];
  contents?: CrpackContents;
  tsvBytes: number;
  ruleCount: number;
}

const utf8 = new TextEncoder();

/** UTF-8 字节数，不是 JS 的 UTF-16 码元数。TSV 预算与路径预算都按字节算。 */
export function byteLengthUtf8(value: string): number {
  return utf8.encode(value).length;
}

// ---------------------------------------------------------------------------
// ZIP 容器解析
// ---------------------------------------------------------------------------

interface RawZipEntry {
  path: string;
  method: number;
  flags: number;
  versionMadeBy: number;
  externalAttrs: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const ZIP64_MARKER = 0xffffffff;

const decoder = new TextDecoder("utf-8", { fatal: false });

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function u64(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) + u32(bytes, offset + 4) * 0x100000000;
}

function findEocdOffset(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (u32(bytes, i) === SIG_EOCD) return i;
  }
  throw new Error("不是有效的 CRPack：zip 结构损坏，找不到中央目录");
}

/** 解析中央目录条目列表。全部字段以中央目录为准（数据描述符场景同样可靠）。 */
function readCentralDirectory(bytes: Uint8Array): RawZipEntry[] {
  const eocd = findEocdOffset(bytes);
  let entryCount = u16(bytes, eocd + 10);
  let centralOffset = u32(bytes, eocd + 16);

  if (entryCount === ZIP64_MARKER || centralOffset === ZIP64_MARKER) {
    const locator = eocd - 20;
    if (locator < 0 || u32(bytes, locator) !== SIG_ZIP64_LOCATOR) {
      throw new Error("不是有效的 CRPack：zip64 结构不完整");
    }
    const zip64 = Number(u64(bytes, locator + 8));
    if (!Number.isFinite(zip64) || zip64 < 0 || u32(bytes, zip64) !== SIG_ZIP64_EOCD) {
      throw new Error("不是有效的 CRPack：zip64 中央目录缺失");
    }
    entryCount = Number(u64(bytes, zip64 + 32));
    centralOffset = Number(u64(bytes, zip64 + 48));
  }

  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      `不是有效的 CRPack：包内条目数 ${entryCount} 超过上限 ${MAX_ARCHIVE_ENTRIES}`,
    );
  }

  const entries: RawZipEntry[] = [];
  let offset = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== SIG_CENTRAL) {
      throw new Error("不是有效的 CRPack：中央目录条目损坏");
    }
    const versionMadeBy = u16(bytes, offset + 4);
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const crc = u32(bytes, offset + 16);
    let compressedSize = u32(bytes, offset + 20);
    let uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    let localOffset = u32(bytes, offset + 42);
    const nameStart = offset + 46;
    const extraStart = nameStart + nameLength;
    const path = decoder.decode(bytes.subarray(nameStart, extraStart));

    // ZIP64 扩展字段按需回填真实尺寸。
    if (
      uncompressedSize === ZIP64_MARKER ||
      compressedSize === ZIP64_MARKER ||
      localOffset === ZIP64_MARKER
    ) {
      let cursor = extraStart;
      let filled = false;
      while (cursor + 4 <= extraStart + extraLength) {
        const headerId = u16(bytes, cursor);
        const size = u16(bytes, cursor + 2);
        if (headerId === 0x0001) {
          let field = cursor + 4;
          if (uncompressedSize === ZIP64_MARKER) {
            uncompressedSize = Number(u64(bytes, field));
            field += 8;
          }
          if (compressedSize === ZIP64_MARKER) {
            compressedSize = Number(u64(bytes, field));
            field += 8;
          }
          if (localOffset === ZIP64_MARKER) {
            localOffset = Number(u64(bytes, field));
          }
          filled = true;
          break;
        }
        cursor += 4 + size;
      }
      if (!filled) throw new Error(`不是有效的 CRPack：条目 ${path} 缺少 zip64 扩展字段`);
    }

    entries.push({
      path,
      method,
      flags,
      versionMadeBy,
      externalAttrs: u32(bytes, offset + 38),
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = extraStart + extraLength + commentLength;
  }
  return entries;
}

/** 条目在文件中的数据起始位置：本地头固定 30 字节 + 名称 + 扩展。 */
function dataStartOf(bytes: Uint8Array, entry: RawZipEntry): number {
  if (u32(bytes, entry.localOffset) !== SIG_LOCAL) {
    throw new Error(`不是有效的 CRPack：条目 ${entry.path} 的本地头损坏`);
  }
  const nameLength = u16(bytes, entry.localOffset + 26);
  const extraLength = u16(bytes, entry.localOffset + 28);
  return entry.localOffset + 30 + nameLength + extraLength;
}

/** Unix 高 16 位存放文件类型；未标 Unix 时按 DOS 目录位处理。 */
function unixFileType(entry: RawZipEntry): number {
  const hostSystem = entry.versionMadeBy >>> 8;
  if (hostSystem !== 3) return entry.externalAttrs & 0x10 ? 0o040000 : 0o100000;
  return (entry.externalAttrs >>> 16) & 0xffff;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 容器级检查
// ---------------------------------------------------------------------------

const SAFE_SEGMENT = /^[A-Za-z0-9_./@-]+$/;

/**
 * 路径安全：无绝对路径、无反斜杠、无空段、无 `.`/`..`。
 * 上游明确**不做规范化修复**，出现即拒绝。
 */
function validateArchivePath(path: string): string | null {
  if (!path) return "包内存在空路径条目";
  if (path.includes("\\")) return `包内条目路径不能含反斜杠：${path}`;
  if (path.startsWith("/")) return `包内条目不能是绝对路径：${path}`;
  if (/^[A-Za-z]:/.test(path)) return `包内条目不能是绝对路径：${path}`;
  const isDirectory = path.endsWith("/");
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" && !isDirectory) return `包内条目路径不能有空段：${path}`;
    if (segment === ".." || segment === ".") return `包内条目路径不能包含 . 或 ..：${path}`;
    if (!SAFE_SEGMENT.test(segment)) return `包内条目路径含非法字符：${path}`;
  }
  return null;
}

function isMappingsTsv(path: string): boolean {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized === "mappings.tsv" || normalized.endsWith("/mappings.tsv");
}

interface RawContents {
  entries: RawZipEntry[];
  files: CrpackEntry[];
  manifestName: string;
  manifestRaw: Uint8Array;
  totalBytes: number;
}

/** 解出全部条目并执行容器级校验。清单名在此确定（legacy 与歧义都在这里拦）。 */
function readArchive(bytes: Uint8Array): RawContents {
  if (bytes.length < 4 || u32(bytes, 0) !== SIG_LOCAL) {
    throw new Error("不是有效的 CRPack：文件不是 zip（缺少 PK\\x03\\x04）");
  }
  const raw = readCentralDirectory(bytes);
  const seen = new Set<string>();
  const files: CrpackEntry[] = [];
  const dirs = new Set<string>();
  let totalBytes = 0;

  for (const entry of raw) {
    const pathError = validateArchivePath(entry.path);
    if (pathError) throw new Error(pathError);
    if (seen.has(entry.path)) throw new Error(`包内存在重复条目：${entry.path}`);
    seen.add(entry.path);

    const fileType = unixFileType(entry);
    if (fileType === 0o120000) throw new Error(`包内不允许符号链接：${entry.path}`);
    const isDirectory = fileType === 0o040000 || entry.path.endsWith("/");
    if (
      !isDirectory &&
      fileType !== 0o100000 &&
      fileType !== 0o0 &&
      fileType !== 0o040000
    ) {
      throw new Error(`包内不允许特殊文件：${entry.path}`);
    }

    if (entry.flags & 0x01) throw new Error(`包内不允许加密条目：${entry.path}`);
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(
        `包内条目压缩方式不受支持：${entry.path}（method ${entry.method}，仅支持 Stored/Deflated）`,
      );
    }

    if (isDirectory) {
      dirs.add(entry.path);
      continue;
    }

    if (isMappingsTsv(entry.path)) {
      throw new Error(
        `包内不能携带 ${entry.path}：mappings.tsv 由设备端从 corona.json 派生，禁止随包分发`,
      );
    }

    const start = dataStartOf(bytes, entry);
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new Error(`不是有效的 CRPack：条目 ${entry.path} 数据截断`);
    const payload = bytes.subarray(start, end);

    // 按实际解压后字节计费，不信中央目录声明值。
    let content: Uint8Array;
    if (entry.method === 0) {
      content = payload.slice();
    } else {
      try {
        content = inflateSync(payload);
      } catch {
        throw new Error(`不是有效的 CRPack：条目 ${entry.path} 解压失败`);
      }
    }

    if (crc32(content) !== entry.crc) {
      throw new Error(`不是有效的 CRPack：条目 ${entry.path} CRC 校验失败`);
    }

    totalBytes += content.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `包内解压后共 ${totalBytes} 字节，超过 ${MAX_TOTAL_BYTES} 字节上限`,
      );
    }
    files.push({ path: entry.path, bytes: content, compression: entry.method });
  }

  const hasLegacy = dirs.has(`${LEGACY_CORONA_MANIFEST_NAME}/`);
  const legacyFiles = files.filter((f) => f.path === LEGACY_CORONA_MANIFEST_NAME);
  const modernFiles = files.filter((f) => f.path === CORONA_MANIFEST_NAME);
  const modernDirs = dirs.has(`${CORONA_MANIFEST_NAME}/`);
  const modernCount = modernFiles.length + (modernDirs ? 1 : 0);

  if (modernCount > 0 && (legacyFiles.length > 0 || hasLegacy)) {
    throw new Error(
      `包内同时存在 ${CORONA_MANIFEST_NAME} 与 ${LEGACY_CORONA_MANIFEST_NAME}，无法判定使用哪个清单`,
    );
  }
  if (modernDirs) {
    throw new Error(`包内 ${CORONA_MANIFEST_NAME} 必须是文件，不能是目录`);
  }
  if (legacyFiles.length > 1 || (legacyFiles.length > 0 && hasLegacy)) {
    throw new Error(`包内存在多个 ${LEGACY_CORONA_MANIFEST_NAME} 清单`);
  }
  if (hasLegacy && legacyFiles.length === 0) {
    throw new Error(LEGACY_MANIFEST_HINT);
  }
  if (legacyFiles.length === 1) {
    throw new Error(LEGACY_MANIFEST_HINT);
  }
  if (modernFiles.length === 0) {
    throw new Error(`不是有效的 CRPack：包内未找到根目录清单 ${CORONA_MANIFEST_NAME}`);
  }

  const manifestEntry = modernFiles[0];
  if (manifestEntry.bytes.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `包内 ${CORONA_MANIFEST_NAME} 为 ${manifestEntry.bytes.length} 字节，超过 ${MAX_MANIFEST_BYTES} 字节上限`,
    );
  }
  if (
    manifestEntry.bytes.length >= 3 &&
    manifestEntry.bytes[0] === 0xef &&
    manifestEntry.bytes[1] === 0xbb &&
    manifestEntry.bytes[2] === 0xbf
  ) {
    throw new Error(`包内 ${CORONA_MANIFEST_NAME} 不能带 UTF-8 BOM`);
  }

  return {
    entries: raw,
    files,
    manifestName: CORONA_MANIFEST_NAME,
    manifestRaw: manifestEntry.bytes,
    totalBytes,
  };
}

function decodeManifest(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(`包内 ${CORONA_MANIFEST_NAME} 不是合法 JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`包内 ${CORONA_MANIFEST_NAME} 必须是 JSON 根对象`);
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 清单字段解析
// ---------------------------------------------------------------------------

const THEME_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

function hasControl(value: string, allowed?: ReadonlySet<number>): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) continue;
    if (code === 0x7f || (code <= 0x1f && !allowed?.has(code))) return true;
  }
  return false;
}

const DESCRIPTION_ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function readVersionCode(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function readMappings(value: unknown): CrpackMapping[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const out: CrpackMapping[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.source !== "string" || typeof record.destination !== "string") continue;
    out.push({ source: record.source, destination: record.destination });
  }
  return out;
}

function readQuickappIcons(value: unknown): CrpackQuickappIcon[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const out: CrpackQuickappIcon[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.package !== "string" || typeof record.destination !== "string") continue;
    out.push({ package: record.package, destination: record.destination });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 解析入口
// ---------------------------------------------------------------------------

/** 解析 CRPack。容器级问题直接抛错（中文文案）；字段级问题留给 validateCrpack。 */
export function parseCrpack(bytes: Uint8Array): CrpackContents {
  const archive = readArchive(bytes);
  const manifest = decodeManifest(archive.manifestRaw);
  const themeId =
    typeof manifest.themeId === "string" && manifest.themeId ? manifest.themeId : "";
  if (!themeId) throw new Error(`包内 ${CORONA_MANIFEST_NAME} 缺少 themeId`);
  const version = typeof manifest.version === "string" ? manifest.version : undefined;
  const versionCode = readVersionCode(manifest.versionCode);
  return {
    entries: archive.files,
    manifestName: archive.manifestName,
    manifestRaw: archive.manifestRaw,
    manifest,
    themeId,
    ...(version !== undefined ? { version } : {}),
    ...(versionCode !== undefined ? { versionCode } : {}),
    mappings: readMappings(manifest.mappings),
    quickappIcons: readQuickappIcons(manifest.quickappIcons),
    totalBytes: archive.totalBytes,
  };
}

/** 读取包内原 themeId，供改写前 toast 用。解析失败返回 undefined。 */
export function readCrpackThemeId(bytes: Uint8Array): string | undefined {
  try {
    return parseCrpack(bytes).themeId;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// TSV 预算
// ---------------------------------------------------------------------------

/**
 * 派生 mappings.tsv 的字节数，与 corona-core 的 validate_mappings 逐字等价。
 * 每行形如 `source<TAB>themes/<themeId>/<destination><LF>`。
 */
export function estimateTsvBytes(
  themeId: string,
  mappings: readonly CrpackMapping[],
  quickappIcons: readonly CrpackQuickappIcon[],
): number {
  const relativeRoot = `themes/${themeId}/`;
  const rootBytes = byteLengthUtf8(relativeRoot);
  let total = 0;
  for (const mapping of mappings) {
    total +=
      byteLengthUtf8(mapping.source) + 1 + rootBytes + byteLengthUtf8(mapping.destination) + 1;
  }
  for (const icon of quickappIcons) {
    total +=
      byteLengthUtf8(`@quickapp-icon/${icon.package}`) +
      1 +
      rootBytes +
      byteLengthUtf8(icon.destination) +
      1;
  }
  return total;
}

function ruleBudgetErrors(themeId: string, contents: CrpackContents): string[] {
  const errors: string[] = [];
  const ruleCount = contents.mappings.length + contents.quickappIcons.length;
  if (ruleCount > MAX_RULES) {
    errors.push(
      `映射规则共 ${ruleCount} 条，超过设备上限 ${MAX_RULES} 条。请合并目录规则：一条 /resource/app/ 目录规则即可覆盖包内全部同前缀资源。`,
    );
  }
  const tsvBytes = estimateTsvBytes(themeId, contents.mappings, contents.quickappIcons);
  if (tsvBytes > MAX_TSV_BYTES) {
    const perRow = Math.ceil(tsvBytes / Math.max(1, ruleCount));
    errors.push(
      `派生 mappings.tsv 预计 ${tsvBytes} 字节，超过设备 32 KiB 预算（上限 ${MAX_TSV_BYTES} 字节）。可缩短包标识（当前 ${themeId.length} 字符，每条规则约占 ${perRow} 字节），或减少规则条数——一条 /resource/app/ 目录规则即可覆盖包内全部同前缀资源。`,
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 字段校验
// ---------------------------------------------------------------------------

function devicePathError(themeId: string, path: string): string | null {
  const length =
    DEVICE_PATH_PREFIX_BYTES + byteLengthUtf8(themeId) + 1 + byteLengthUtf8(path);
  if (length >= DEVICE_PATH_LIMIT) {
    return `包内条目 ${path} 的设备端路径为 ${length} 字节，超过 ${DEVICE_PATH_LIMIT} 字节上限（请缩短包标识或条目路径）`;
  }
  return null;
}

/** 校验映射字段。themeId 为空表示按包内原值做预算计算之外的检查。 */
function mappingErrors(
  contents: CrpackContents,
  filePaths: Set<string>,
): string[] {
  const errors: string[] = [];
  const seenSources = new Set<string>();
  const hasPrefix = (target: string) => {
    for (const path of filePaths) if (path.startsWith(target)) return true;
    return false;
  };

  contents.mappings.forEach((mapping, index) => {
    const at = `mappings[${index}]`;
    const { source, destination } = mapping;
    if (!source || !destination) {
      errors.push(`${at} 的 source / destination 不能为空`);
      return;
    }
    if (byteLengthUtf8(source) > MAX_PATH_BYTES) {
      errors.push(`${at} 的 source 超过 ${MAX_PATH_BYTES} 字节上限`);
    }
    if (hasControl(source)) {
      errors.push(`${at} 的 source 含控制字符（映射字段不允许 ASCII 控制字节）`);
    }
    if (source.startsWith("@quickapp-icon/")) {
      if (byteLengthUtf8(source) > MAX_PATH_BYTES) {
        errors.push(`${at} 的 quickapp 语义键超过 ${MAX_PATH_BYTES} 字节上限`);
      }
    } else if (!source.startsWith("/")) {
      errors.push(`${at} 的 source 必须是固件绝对路径，或 @quickapp-icon/<package> 语义键`);
    }
    if (seenSources.has(source)) {
      errors.push(`${at} 的 source「${source}」重复：同一包内重复源会让设备拒绝整份映射配置`);
    }
    seenSources.add(source);

    if (!destination) return;
    if (byteLengthUtf8(destination) > MAX_PATH_BYTES) {
      errors.push(`${at} 的 destination 超过 ${MAX_PATH_BYTES} 字节上限`);
    }
    if (hasControl(destination)) {
      errors.push(`${at} 的 destination 含控制字符（映射字段不允许 ASCII 控制字节）`);
    }
    if (destination.startsWith("/") || destination.includes("\\")) {
      errors.push(`${at} 的 destination 必须是包内相对路径，不能是绝对路径`);
    }
    if (source.endsWith("/") !== destination.endsWith("/")) {
      errors.push(`${at} 的 source 与 destination 尾部斜杠必须一致（目录规则对目录规则）`);
    }
    const exists = destination.endsWith("/")
      ? hasPrefix(destination)
      : filePaths.has(destination);
    if (!exists) {
      errors.push(`${at} 的 destination「${destination}」在包内不存在`);
    }
  });

  contents.quickappIcons.forEach((icon, index) => {
    const at = `quickappIcons[${index}]`;
    const key = `@quickapp-icon/${icon.package}`;
    if (!icon.package) {
      errors.push(`${at} 的 package 不能为空`);
      return;
    }
    if (byteLengthUtf8(key) > MAX_PATH_BYTES) {
      errors.push(`${at} 的 @quickapp-icon 语义键超过 ${MAX_PATH_BYTES} 字节上限`);
    }
    if (hasControl(icon.package)) {
      errors.push(`${at} 的 package 含控制字符`);
    }
    if (seenSources.has(key)) {
      errors.push(`${at} 的 source「${key}」与其它映射规则重复`);
    }
    seenSources.add(key);

    const { destination } = icon;
    if (!destination) {
      errors.push(`${at} 的 destination 不能为空`);
      return;
    }
    if (hasControl(destination)) {
      errors.push(`${at} 的 destination 含控制字符`);
    }
    if (!destination.endsWith(".bin") || destination !== destination.toLowerCase()) {
      errors.push(`${at} 的 destination 必须是真实存在的小写 .bin 文件`);
    } else if (!filePaths.has(destination)) {
      errors.push(`${at} 的 destination「${destination}」在包内不存在`);
    }
  });

  return errors;
}

function optionalFieldErrors(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];

  const name = manifest.name;
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      errors.push("corona.json 的 name 必须是非空字符串");
    } else {
      if (byteLengthUtf8(name) > 128) errors.push("corona.json 的 name 超过 128 字节上限");
      if (hasControl(name)) errors.push("corona.json 的 name 含控制字符");
    }
  } else {
    errors.push("corona.json 缺少必填字段 name");
  }

  if (manifest.version !== undefined) {
    if (typeof manifest.version !== "string") {
      errors.push("corona.json 的 version 必须是字符串");
    } else {
      if (byteLengthUtf8(manifest.version) > 64) {
        errors.push("corona.json 的 version 超过 64 字节上限");
      }
      if (hasControl(manifest.version)) errors.push("corona.json 的 version 含控制字符");
    }
  }

  if (manifest.versionCode !== undefined) {
    const code = manifest.versionCode;
    if (typeof code !== "number" || !Number.isInteger(code)) {
      errors.push("corona.json 的 versionCode 必须是 JSON 数字（非字符串）");
    } else if (code < 0) {
      errors.push("corona.json 的 versionCode 必须是非负整数");
    } else if (code > MAX_VERSION_CODE) {
      errors.push(`corona.json 的 versionCode 不能超过 ${MAX_VERSION_CODE}`);
    }
  }

  if (manifest.author !== undefined) {
    if (typeof manifest.author !== "string") {
      errors.push("corona.json 的 author 必须是字符串");
    } else {
      if (byteLengthUtf8(manifest.author) > 128) {
        errors.push("corona.json 的 author 超过 128 字节上限");
      }
      if (hasControl(manifest.author)) errors.push("corona.json 的 author 含控制字符");
    }
  }

  if (manifest.description !== undefined) {
    if (typeof manifest.description !== "string") {
      errors.push("corona.json 的 description 必须是字符串");
    } else {
      if (byteLengthUtf8(manifest.description) > 1024) {
        errors.push("corona.json 的 description 超过 1024 字节上限");
      }
      if (hasControl(manifest.description, DESCRIPTION_ALLOWED)) {
        errors.push("corona.json 的 description 含控制字符（制表符/换行除外）");
      }
    }
  }

  if (manifest.targets !== undefined) {
    if (!Array.isArray(manifest.targets)) {
      errors.push("corona.json 的 targets 必须是数组");
    } else {
      if (manifest.targets.length > 16) errors.push("corona.json 的 targets 超过 16 条上限");
      manifest.targets.forEach((target, index) => {
        if (typeof target !== "string") {
          errors.push(`targets[${index}] 必须是字符串`);
          return;
        }
        if (byteLengthUtf8(target) > 128) {
          errors.push(`targets[${index}] 超过 128 字节上限`);
        }
        if (hasControl(target)) errors.push(`targets[${index}] 含控制字符`);
      });
    }
  }

  return errors;
}

/**
 * 全量校验。返回错误列表（空数组 = 通过）。
 * `expectedThemeId` 用于核对包内 themeId 是否与商店资源 id 逐字一致。
 */
export function validateCrpack(
  bytes: Uint8Array,
  expectedThemeId?: string,
): string[] {
  let contents: CrpackContents;
  try {
    contents = parseCrpack(bytes);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return validateContents(contents, expectedThemeId);
}

/** 对已解析的包做字段级校验。审核端与发布前校验共用。 */
export function validateContents(
  contents: CrpackContents,
  expectedThemeId?: string,
): string[] {
  const errors: string[] = [];
  const { manifest, themeId } = contents;

  if (manifest.format !== CRPACK_FORMAT) {
    errors.push(`corona.json 的 format 必须是「${CRPACK_FORMAT}」`);
  }
  if (manifest.formatVersion !== CRPACK_FORMAT_VERSION) {
    errors.push(`corona.json 的 formatVersion 必须是 ${CRPACK_FORMAT_VERSION}`);
  }
  if (!THEME_ID_PATTERN.test(themeId)) {
    errors.push(
      `corona.json 的 themeId「${themeId}」非法：只允许 1–64 个小写字母、数字、下划线或连字符`,
    );
  }
  if (expectedThemeId !== undefined && themeId !== expectedThemeId) {
    errors.push(
      `包内 themeId「${themeId}」与资源 ID「${expectedThemeId}」不一致：themeId 必须与资源 ID 逐字一致`,
    );
  }

  errors.push(...optionalFieldErrors(manifest));

  if (manifest.mappings !== undefined && !Array.isArray(manifest.mappings)) {
    errors.push("corona.json 的 mappings 必须是数组");
  }
  if (manifest.quickappIcons !== undefined && !Array.isArray(manifest.quickappIcons)) {
    errors.push("corona.json 的 quickappIcons 必须是数组");
  }

  const filePaths = new Set(contents.entries.map((entry) => entry.path));
  errors.push(...mappingErrors(contents, filePaths));

  for (const entry of contents.entries) {
    const pathError = devicePathError(themeId, entry.path);
    if (pathError) errors.push(pathError);
  }

  errors.push(...ruleBudgetErrors(themeId, contents));
  return errors;
}

/** 审核端只读检查：解析 + 全量校验 + 预算实算，供人工核对。 */
export function inspectResPack(
  bytes: Uint8Array,
  expectedThemeId?: string,
): ResPackInspection {
  let contents: CrpackContents;
  try {
    contents = parseCrpack(bytes);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      tsvBytes: 0,
      ruleCount: 0,
    };
  }
  const errors = validateContents(contents, expectedThemeId);
  return {
    ok: errors.length === 0,
    errors,
    contents,
    tsvBytes: estimateTsvBytes(contents.themeId, contents.mappings, contents.quickappIcons),
    ruleCount: contents.mappings.length + contents.quickappIcons.length,
  };
}

// ---------------------------------------------------------------------------
// 清单改写
// ---------------------------------------------------------------------------

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortJsonValue(source[key]);
    return out;
  }
  return value;
}

/** 2 空格缩进 + 键按字典序，与 Builder 产出的样本包形态一致，保证逐字节可复现。 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

export interface CrpackCoronaPatch {
  themeId?: string;
  version?: string;
  versionCode?: number;
}

/**
 * 改写包内 corona.json 并重打包。
 *
 * 走「读原始 JSON 对象 → 只改目标字段 → 序列化」，绝不按白名单重建，否则
 * 作者自带的未知字段会被丢弃。重打包必须发生在加密与 sha256 计算之前。
 */
export function rewriteCrpackCorona(
  bytes: Uint8Array,
  patch: CrpackCoronaPatch,
): Uint8Array {
  const archive = readArchive(bytes);
  const manifest = decodeManifest(archive.manifestRaw);

  if (patch.themeId !== undefined) manifest.themeId = patch.themeId;
  if (patch.version !== undefined) manifest.version = patch.version;
  if (patch.versionCode !== undefined) manifest.versionCode = patch.versionCode;

  const manifestText = stableStringify(manifest);
  const manifestBytes = utf8.encode(manifestText);
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `改写后 ${CORONA_MANIFEST_NAME} 为 ${manifestBytes.length} 字节，超过 ${MAX_MANIFEST_BYTES} 字节上限`,
    );
  }

  const zippable: Zippable = {};
  const put = (path: string, content: Uint8Array) => {
    zippable[path] = [content, { level: 6, mtime: new Date(0) }];
  };
  for (const entry of archive.files) {
    put(entry.path, entry.path === CORONA_MANIFEST_NAME ? manifestBytes : entry.bytes);
  }
  // 目录条目原样保留（用 Stored，避免引入新的 mtime/压缩差异）。
  for (const entry of archive.entries) {
    if (entry.path.endsWith("/")) {
      zippable[entry.path] = [new Uint8Array(0), { level: 0, mtime: new Date(0) }];
    }
  }
  return zipSync(zippable);
}
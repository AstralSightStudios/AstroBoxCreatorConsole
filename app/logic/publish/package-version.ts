import { unzipSync, zipSync, type Unzipped, type Zippable } from "fflate";

/**
 * 资源包体版本读取与改写。
 *
 * 覆盖三类包体（版本一律以包体内部为准）：
 * - 小米表盘 `.bin` / `.face`：offset 4..6 三字节，`versionCode = major<<16|minor<<8|patch`。
 * - 小米表盘 `.mwz`：zip 工程包，内层 `.bin` 才是设备要的包体。
 * - rpk / zip（小米快应用、Vivo 快应用、Vivo 表盘）：`manifest.json` 里的
 *   `versionName` / `versionCode`（小米另有 `manifest-watch.json`）。
 */

export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
export const WATCHFACE_MAGIC = [0x5a, 0xa5, 0x34, 0x12];

/** 小米表盘文件内表盘 ID 的位置（12 字节，与 watchface-id.ts 保持一致）。 */
export const XIAOMI_WATCHFACE_ID_OFFSET = 40;
export const XIAOMI_WATCHFACE_ID_LENGTH = 12;

/** 小米表盘文件内版本三字节的位置。 */
export const XIAOMI_VERSION_OFFSET = 4;
export const XIAOMI_VERSION_LENGTH = 3;

export type PackageVersionSource =
  | "zip-manifest"
  | "xiaomi-bin"
  | "xiaomi-mwz"
  | "unknown";

export type PackageIdentityKind = "package" | "watchface-id" | "dial-id";

export interface PackageVersionInfo {
  /** 展示版本：小米表盘 major.minor.patch；rpk 用 versionName。 */
  version?: string;
  /** 整数版本号，客户端用于更新检测。 */
  versionCode?: number;
  /** 包体标识：快应用/表盘 rpk 的 package，Vivo 表盘的 dial id，小米表盘的 12 位 ID。 */
  identity?: string;
  identityKind?: PackageIdentityKind;
  source: PackageVersionSource;
  readable: boolean;
  writable: boolean;
  /** 解析失败原因，用于 toast / 行内提示。 */
  reason?: string;
  /** 包内承载版本的条目路径（zip 型用于诊断）。 */
  entry?: string;
}

export interface PackageVersionTarget {
  version: string;
  versionCode: number;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function isAsciiAlphanumeric(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a)
  );
}

function decodeAscii(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function unknown(reason: string): PackageVersionInfo {
  return { source: "unknown", readable: false, writable: false, reason };
}

function parseVersionCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Math.trunc(Number(value));
  }
  return undefined;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

/** 读取小米表盘 offset 40 处的 12 位表盘 ID（扫描 9/12 位字母数字连续段）。 */
function readWatchfaceId(bytes: Uint8Array): string | undefined {
  if (bytes.length < XIAOMI_WATCHFACE_ID_OFFSET + XIAOMI_WATCHFACE_ID_LENGTH) {
    return undefined;
  }
  const field = bytes.subarray(
    XIAOMI_WATCHFACE_ID_OFFSET,
    XIAOMI_WATCHFACE_ID_OFFSET + XIAOMI_WATCHFACE_ID_LENGTH,
  );
  let i = 0;
  while (i < field.length) {
    if (!isAsciiAlphanumeric(field[i])) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < field.length && isAsciiAlphanumeric(field[i])) i += 1;
    const length = i - start;
    if (length === 9 || length === 12) {
      return decodeAscii(field.subarray(start, i));
    }
  }
  return undefined;
}

function readXiaomiBin(bytes: Uint8Array): PackageVersionInfo {
  if (bytes.length < XIAOMI_VERSION_OFFSET + XIAOMI_VERSION_LENGTH) {
    return {
      source: "xiaomi-bin",
      readable: false,
      writable: false,
      reason: "表盘文件过小，无法读取版本",
    };
  }
  const patch = bytes[XIAOMI_VERSION_OFFSET];
  const minor = bytes[XIAOMI_VERSION_OFFSET + 1];
  const major = bytes[XIAOMI_VERSION_OFFSET + 2];
  return {
    version: `${major}.${minor}.${patch}`,
    versionCode: (major << 16) | (minor << 8) | patch,
    identity: readWatchfaceId(bytes),
    identityKind: "watchface-id",
    source: "xiaomi-bin",
    readable: true,
    writable: true,
  };
}

function pickManifestName(entries: Unzipped): string | undefined {
  const names = Object.keys(entries);
  return (
    names.find((name) => name === "manifest.json") ??
    names.find((name) => name.split(/[\\/]/).pop() === "manifest.json")
  );
}

function findInnerBinName(entries: Unzipped): string | undefined {
  const bins = Object.keys(entries).filter((name) =>
    name.toLowerCase().endsWith(".bin"),
  );
  return bins.find((name) => !name.includes("/")) ?? bins[0];
}

interface ManifestVersion {
  version?: string;
  versionCode?: number;
}

function readManifestVersion(manifest: Record<string, unknown>): ManifestVersion {
  const rawName = manifest.versionName ?? manifest.version_name;
  const version =
    typeof rawName === "string" && rawName.trim() ? rawName.trim() : undefined;
  return { version, versionCode: parseVersionCode(manifest.versionCode ?? manifest.version_code) };
}

function readZipIdentity(manifest: Record<string, unknown>): {
  identity?: string;
  identityKind?: PackageIdentityKind;
} {
  const router = manifest.router;
  const watchfaces =
    router && typeof router === "object" && !Array.isArray(router)
      ? (router as Record<string, unknown>).watchfaces
      : undefined;
  if (watchfaces && typeof watchfaces === "object" && !Array.isArray(watchfaces)) {
    const first = Object.values(watchfaces as Record<string, unknown>)[0];
    const id =
      first && typeof first === "object"
        ? (first as Record<string, unknown>).id
        : undefined;
    if (typeof id === "string" && id.trim()) {
      return { identity: id.trim(), identityKind: "dial-id" };
    }
    if (typeof id === "number" && Number.isFinite(id)) {
      return { identity: String(Math.trunc(id)), identityKind: "dial-id" };
    }
  }
  const pkg = manifest.package;
  if (typeof pkg === "string" && pkg.trim()) {
    return { identity: pkg.trim(), identityKind: "package" };
  }
  return {};
}

function readZipManifest(
  entries: Unzipped,
  manifestName: string,
): PackageVersionInfo {
  const manifest = parseJsonObject(entries[manifestName]);
  if (!manifest) {
    return {
      source: "zip-manifest",
      readable: false,
      writable: false,
      reason: "manifest.json 不是有效 JSON",
      entry: manifestName,
    };
  }
  const watchName = Object.keys(entries).find(
    (name) => name.split(/[\\/]/).pop() === "manifest-watch.json",
  );
  const watchManifest = watchName ? parseJsonObject(entries[watchName]) : null;

  const mainVersion = readManifestVersion(manifest);
  const watchVersion = watchManifest ? readManifestVersion(watchManifest) : undefined;
  const chosen =
    watchVersion && (watchVersion.version || watchVersion.versionCode !== undefined)
      ? watchVersion
      : mainVersion;
  const identity = readZipIdentity(manifest);

  const readable = Boolean(chosen.version) || chosen.versionCode !== undefined;
  return {
    version: chosen.version,
    versionCode: chosen.versionCode,
    ...identity,
    source: "zip-manifest",
    readable,
    writable: true,
    entry: watchVersion && watchVersion.version ? (watchName ?? manifestName) : manifestName,
    ...(readable
      ? {}
      : { reason: "manifest.json 中未找到 versionName / versionCode" }),
  };
}

function readMwz(entries: Unzipped, binName: string): PackageVersionInfo {
  const info = readXiaomiBin(entries[binName]);
  return { ...info, source: "xiaomi-mwz", entry: binName };
}

/** 读取包体版本、标识与可改写能力。解析失败不抛错，返回 readable=false。 */
export async function readPackageVersion(input: Blob): Promise<PackageVersionInfo> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await input.arrayBuffer());
  } catch {
    return unknown("无法读取文件内容");
  }
  if (bytes.length === 0) return unknown("文件内容为空");
  if (startsWith(bytes, WATCHFACE_MAGIC)) return readXiaomiBin(bytes);
  if (!startsWith(bytes, ZIP_MAGIC)) {
    return unknown("不支持的包体格式（仅支持小米表盘与 rpk/zip）");
  }
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes);
  } catch {
    return unknown("zip 解压失败");
  }
  const manifestName = pickManifestName(entries);
  if (manifestName) return readZipManifest(entries, manifestName);
  const binName = findInnerBinName(entries);
  if (binName) return readMwz(entries, binName);
  return unknown("zip 内未找到 manifest.json 或表盘 .bin");
}

function resolveXiaomiTriple(target: PackageVersionTarget): {
  major: number;
  minor: number;
  patch: number;
} {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(target.version.trim());
  let triple: { major: number; minor: number; patch: number };
  if (match) {
    triple = {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    };
  } else if (Number.isFinite(target.versionCode) && target.versionCode >= 0) {
    triple = {
      major: (target.versionCode >>> 16) & 0xff,
      minor: (target.versionCode >>> 8) & 0xff,
      patch: target.versionCode & 0xff,
    };
  } else {
    throw new Error(`无法解析小米表盘版本：${target.version || "(空)"}`);
  }
  for (const value of [triple.major, triple.minor, triple.patch]) {
    if (value < 0 || value > 255) {
      throw new Error("小米表盘版本每个字段必须在 0-255 之间");
    }
  }
  return triple;
}

function writeXiaomiBin(
  bytes: Uint8Array,
  target: PackageVersionTarget,
): Uint8Array {
  if (bytes.length < XIAOMI_VERSION_OFFSET + XIAOMI_VERSION_LENGTH) {
    throw new Error("表盘文件过小，无法写入版本");
  }
  const { major, minor, patch } = resolveXiaomiTriple(target);
  const out = new Uint8Array(bytes);
  out[XIAOMI_VERSION_OFFSET] = patch;
  out[XIAOMI_VERSION_OFFSET + 1] = minor;
  out[XIAOMI_VERSION_OFFSET + 2] = major;
  return out;
}

/**
 * 改写 rpk/zip 内所有顶层含 versionName/versionCode 的 JSON（manifest.json、
 * manifest-watch.json 等），保证包内版本统一。
 */
function writeZipManifest(
  entries: Unzipped,
  target: PackageVersionTarget,
): Uint8Array {
  const out: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    if (!name.toLowerCase().endsWith(".json")) {
      out[name] = data;
      continue;
    }
    const manifest = parseJsonObject(data);
    if (!manifest) {
      out[name] = data;
      continue;
    }
    let changed = false;
    if (typeof manifest.versionName === "string") {
      manifest.versionName = target.version;
      changed = true;
    } else if (typeof manifest.version_name === "string") {
      manifest.version_name = target.version;
      changed = true;
    }
    if (typeof manifest.versionCode === "number") {
      manifest.versionCode = target.versionCode;
      changed = true;
    } else if (typeof manifest.version_code === "number") {
      manifest.version_code = target.versionCode;
      changed = true;
    }
    out[name] = changed
      ? new TextEncoder().encode(JSON.stringify(manifest, null, 2))
      : data;
  }
  return zipSync(out);
}

function wrapFile(bytes: Uint8Array, source: File): File {
  return new File([bytes as BlobPart], source.name, {
    type: source.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

/** 改写包体版本，返回新的 File（不改动原文件）。不支持改写的格式抛错。 */
export async function writePackageVersion(
  file: File,
  target: PackageVersionTarget,
): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWith(bytes, WATCHFACE_MAGIC)) {
    return wrapFile(writeXiaomiBin(bytes, target), file);
  }
  if (startsWith(bytes, ZIP_MAGIC)) {
    let entries: Unzipped;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new Error("包体不是有效的 zip，无法写入版本");
    }
    const manifestName = pickManifestName(entries);
    if (manifestName) {
      return wrapFile(writeZipManifest(entries, target), file);
    }
    const binName = findInnerBinName(entries);
    if (binName) {
      entries[binName] = writeXiaomiBin(entries[binName], target);
      return wrapFile(zipSync(entries), file);
    }
  }
  throw new Error("不支持的包体格式，无法写入版本");
}

/** 版本展示：`1.2.3（versionCode 66052）`。 */
export function formatPackageVersion(info: PackageVersionInfo): string {
  const version = info.version?.trim();
  if (version && info.versionCode !== undefined) {
    return `${version}（versionCode ${info.versionCode}）`;
  }
  if (version) return version;
  if (info.versionCode !== undefined) return `versionCode ${info.versionCode}`;
  return "未知版本";
}

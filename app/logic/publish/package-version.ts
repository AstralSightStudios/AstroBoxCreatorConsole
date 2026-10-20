import { unzipSync, zipSync, type Unzipped } from "fflate";
import {
  isTarArchive,
  readCanopusPackage,
  type ManifestCanopusMeta,
} from "./canopus-package";
import {
  CORONA_MANIFEST_NAME,
  LEGACY_CORONA_MANIFEST_NAME,
  parseCrpack,
  rewriteCrpackCorona,
} from "./crpack-validate";

/**
 * 资源包体版本读取与改写。
 *
 * 覆盖四类包体（版本一律以包体内部为准）：
 * - 小米表盘 `.bin` / `.face`：offset 4..6 三字节，`versionCode = major<<16|minor<<8|patch`。
 * - 小米表盘 `.mwz`：zip 工程包，内层 `.bin` 才是设备要的包体。
 * - rpk（小米快应用、Vivo 快应用、Vivo 表盘）：**只读，禁止改写**。版本取
 *   `manifest.json` 里的 `versionName` / `versionCode`（小米另有
 *   `manifest-watch.json`），原因见下方「为什么 rpk 不能改版本」。
 * - CRPack（资源包 `.crpack`）：`corona.json` 里的 `version` / `versionCode`，
 *   包体标识取 `themeId`。
 * - 原生 Canopus 模块（`.canopus`，未压缩 tar）：`manifest.json` 的 `version` /
 *   `version_code`，包体标识取 `module_id`；同时给出商店条目的 `canopus` 元数据。
 *   不可改写：回执里绑定了产物哈希与 `module_version`。
 *
 * ## 为什么 rpk 不能改版本
 *
 * rpk 表面是 zip，但工具链在「最后一个 local file header」与「中央目录」之间
 * 插了一段**签名块**（尾魔数 `RPK Sig Block 42`，布局见 rpk-signature.ts）。
 * 这段字节不在中央目录里，任何 zip 库都看不到它。
 *
 * 关键在于签名块里的 `0x01000201` 条目——**文件摘要列表**：实测 14 个真实官方
 * 包（小到 7 个文件、大到 435 个文件），该列表的记录数与包内非目录条目数
 * **逐一相等**，即包内每一个文件（含 `manifest.json` /
 * `manifest-watch.json`）都有一条摘要。
 *
 * 于是改 versionCode 必然同时做两件互相矛盾的事：改了 manifest 的字节，签名块
 * 里的摘要却仍然描述改之前的 manifest。手环侧验签时重算出的摘要与签名块对不上，
 * 直接判签名失败拒装——表现为「CC 里改完版本就装不上」。
 *
 * 搬回签名块救不了这一点：块是原样搬回的，正因原样，它记的还是旧摘要。而且摘要
 * 算法在工具链内部（不是裸 MD5/SHA），没有开发者私钥就无法重签。
 *
 * 结论：rpk 只能整体重新导出后重新导入，不能在控制台里就地改版本。
 * 要涨版本号，请回到 rpk 构建工具链改 `manifest.json` 后重新打包。
 */

export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
export const WATCHFACE_MAGIC = [0x5a, 0xa5, 0x34, 0x12];

/** 小米表盘文件内表盘 ID 的位置（12 字节，与 watchface-id.ts 保持一致）。 */
export const XIAOMI_WATCHFACE_ID_OFFSET = 40;
export const XIAOMI_WATCHFACE_ID_LENGTH = 12;

/** 小米表盘文件内版本三字节的位置。 */
export const XIAOMI_VERSION_OFFSET = 4;
export const XIAOMI_VERSION_LENGTH = 3;

/**
 * rpk 不可改写的原因文案。读路径当 `reason` 展示，写路径当异常抛出，共用一份，
 * 免得两处说法不一致让创作者以为是两个问题。
 */
const RPK_UNWRITABLE_REASON =
  "快应用 rpk 带签名，改动包内任一字节都会导致手环验签失败、无法安装。" +
  "请在 rpk 构建工具链中改好 manifest.json 的 versionName / versionCode，用 aiot release 重新打包后再重新导入包体。";

const CANOPUS_UNWRITABLE_REASON =
  ".canopus 包的安装回执绑定了产物哈希与 module_version，不能在控制台里改版本。" +
  "请用 canopus package 重新打包后再导入。";

export type PackageVersionSource =
  | "zip-manifest"
  | "xiaomi-bin"
  | "xiaomi-mwz"
  | "crpack-corona"
  | "canopus-manifest"
  | "unknown";

export type PackageIdentityKind = "package" | "watchface-id" | "dial-id" | "theme-id";

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
  /** 解析失败原因，或 `writable === false` 的原因，用于 toast / 行内提示。 */
  reason?: string;
  /** 包内承载版本的条目路径（zip 型用于诊断）。 */
  entry?: string;
  /** 原生 Canopus 包体的商店元数据（ABI 与目标固件）。 */
  canopus?: ManifestCanopusMeta;
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

export function pickManifestName(entries: Unzipped): string | undefined {
  const names = Object.keys(entries);
  return (
    names.find((name) => name === "manifest.json") ??
    names.find((name) => name.split(/[\\/]/).pop() === "manifest.json")
  );
}

/**
 * 包内是否带快应用清单——`manifest.json` **或** `manifest-watch.json` 任一存在即为。
 *
 * 写路径拦截 rpk 必须用它，不能只用 `pickManifestName`：后者只认 `manifest.json`，
 * 于是「只有 manifest-watch.json、且带 .bin」的签名 zip 会被漏过，被当成 .mwz
 * 表盘工程包走进 `writeXiaomiBin` + `zipSync` 分支——照样改写成功，签名块照样丢。
 * 读路径本来也优先看 manifest-watch.json（`readZipManifest`），说明这种布局是
 * 预期存在的，用只认一半的口径去守写路径是漏洞。
 *
 * 语料（504 个真实 rpk）里没有这种实例，属防御性加固而非修现网 bug。
 */
export function hasQuickAppManifest(entries: Unzipped): boolean {
  return Object.keys(entries).some((name) => {
    const base = name.split(/[\\/]/).pop();
    return base === "manifest.json" || base === "manifest-watch.json";
  });
}

export function findInnerBinName(entries: Unzipped): string | undefined {
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
    // rpk 带签名块且块内含全包文件摘要，改任何一个字节都会让手环验签失败。
    // 见文件头「为什么 rpk 不能改版本」。reason 无论是否读出版本都要给，
    // 否则 readable=true 时调用方拿不到任何「为什么不能改」的线索。
    writable: false,
    entry: watchVersion && watchVersion.version ? (watchName ?? manifestName) : manifestName,
    reason: readable ? RPK_UNWRITABLE_REASON : "manifest.json 中未找到 versionName / versionCode",
  };
}

function readMwz(entries: Unzipped, binName: string): PackageVersionInfo {
  const info = readXiaomiBin(entries[binName]);
  return { ...info, source: "xiaomi-mwz", entry: binName };
}

/** 读取 CRPack 内的 `corona.json` 版本信息。解析失败不抛错，返回 readable=false。 */
function readCrpackCorona(bytes: Uint8Array): PackageVersionInfo {
  let contents;
  try {
    contents = parseCrpack(bytes);
  } catch (error) {
    return {
      source: "crpack-corona",
      readable: false,
      writable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const readable =
    Boolean(contents.version) || contents.versionCode !== undefined;
  return {
    ...(contents.version !== undefined ? { version: contents.version } : {}),
    ...(contents.versionCode !== undefined ? { versionCode: contents.versionCode } : {}),
    identity: contents.themeId,
    identityKind: "theme-id",
    source: "crpack-corona",
    readable,
    writable: true,
    entry: contents.manifestName,
    ...(readable
      ? {}
      : { reason: `${contents.manifestName} 中未找到 version / versionCode` }),
  };
}

/** 包内是否带 CRPack 清单。放在 manifest.json 之前判断，避免同类包误判分支。 */
function findCrpackManifestName(entries: Unzipped): string | undefined {
  if (entries[CORONA_MANIFEST_NAME]) return CORONA_MANIFEST_NAME;
  if (entries[LEGACY_CORONA_MANIFEST_NAME]) return LEGACY_CORONA_MANIFEST_NAME;
  return undefined;
}

/** 读取 `.canopus` 清单。解析失败不抛错，返回 readable=false。 */
function readCanopusManifest(bytes: Uint8Array): PackageVersionInfo {
  try {
    const info = readCanopusPackage(bytes);
    return {
      version: info.version,
      versionCode: info.versionCode,
      identity: info.moduleId,
      identityKind: "package",
      source: "canopus-manifest",
      readable: true,
      writable: false,
      entry: "manifest.json",
      reason: CANOPUS_UNWRITABLE_REASON,
      canopus: info.canopus,
    };
  } catch (error) {
    return {
      source: "canopus-manifest",
      readable: false,
      writable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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
  if (isTarArchive(bytes)) return readCanopusManifest(bytes);
  if (!startsWith(bytes, ZIP_MAGIC)) {
    return unknown("不支持的包体格式（仅支持小米表盘、rpk/zip、CRPack 资源包与 .canopus 模块包）");
  }
  // CRPack 判定放在 unzipSync 之后、manifest.json 之前：包内不会有 manifest.json，
  // 但放前面能保证 crpack 一定走对分支，避免未来某个包同时含两种清单时误判。
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes);
  } catch {
    // 加密或结构特殊的包 fflate 解不开，仍按原始字节尝试 CRPack 解析。
    return readCrpackCorona(bytes);
  }
  if (findCrpackManifestName(entries)) return readCrpackCorona(bytes);
  const manifestName = pickManifestName(entries);
  if (manifestName) return readZipManifest(entries, manifestName);
  const binName = findInnerBinName(entries);
  if (binName) return readMwz(entries, binName);
  return unknown(
    `zip 内未找到 manifest.json、${CORONA_MANIFEST_NAME} 或表盘 .bin`,
  );
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

function wrapFile(bytes: Uint8Array, source: File): File {
  return new File([bytes as BlobPart], source.name, {
    type: source.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

/**
 * 改写包体版本，返回新的 File（不改动原文件）。不支持改写的格式抛错。
 *
 * rpk（`source === "zip-manifest"`）**故意不支持**，而且必须显式拦下，不能靠
 * 「后面没分支了」兜底：调用方只认抛错与否，一旦漏写分支就会静默产出一个
 * 装不上的包，而装不上要到用户手环上才暴露。理由见文件头「为什么 rpk 不能改版本」。
 */
export async function writePackageVersion(
  file: File,
  target: PackageVersionTarget,
): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isTarArchive(bytes)) throw new Error(CANOPUS_UNWRITABLE_REASON);
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
    if (findCrpackManifestName(entries)) {
      // 只改 version / versionCode，绝不碰 themeId —— 那是发布链路改写阶段的事。
      return wrapFile(
        rewriteCrpackCorona(bytes, {
          version: target.version,
          versionCode: target.versionCode,
        }),
        file,
      );
    }
    if (hasQuickAppManifest(entries)) throw new Error(RPK_UNWRITABLE_REASON);
    const binName = findInnerBinName(entries);
    if (binName) {
      entries[binName] = writeXiaomiBin(entries[binName], target);
      return wrapFile(zipSync(entries), file);
    }
  }
  throw new Error("不支持的包体格式，无法写入版本");
}

/** 计算包体内容哈希（SHA-256，非安全上下文回退 FNV-1a）。 */
export async function computePackageHash(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${bytes.length}`;
}

/**
 * 小米表盘 `major.minor.patch` 版本对应的 versionCode。
 * 非 `a.b.c` 形式返回 undefined（例如 Vivo 表盘的 `1.0.0.2`）。
 */
export function xiaomiVersionCodeFromVersion(version: string): number | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(version.trim());
  if (!match) return undefined;
  return (Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3]);
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

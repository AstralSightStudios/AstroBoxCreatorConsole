import { unzipSync, zipSync, type Unzipped } from "fflate";
import { fetchCatalogEntries } from "./catalog";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
  WATCHFACE_MAGIC,
  ZIP_MAGIC,
  findInnerBinName,
  pickManifestName,
} from "./package-version";

export const WATCHFACE_ID_LENGTH = 12;
export const WATCHFACE_ID_PREFIX = "9798";

const WATCHFACE_ID_PATTERN = /^\d{12}$/;
const WATCHFACE_ID_OFFSET = 40;

export function generateWatchfaceId(): string {
  const randomLength = WATCHFACE_ID_LENGTH - WATCHFACE_ID_PREFIX.length;
  const random = new Uint32Array(randomLength);
  crypto.getRandomValues(random);
  return `${WATCHFACE_ID_PREFIX}${Array.from(random, (v) => String(v % 10)).join("")}`;
}

export function validateWatchfaceIdFormat(id: string): string | null {
  const normalized = id.trim();
  if (!normalized) return "请填写资源 ID";
  if (!/^\d+$/.test(normalized)) return "表盘 ID 必须为纯数字";
  if (normalized.length !== WATCHFACE_ID_LENGTH)
    return `表盘 ID 长度必须是 ${WATCHFACE_ID_LENGTH} 位`;
  if (!normalized.startsWith(WATCHFACE_ID_PREFIX))
    return `表盘 ID 必须以 ${WATCHFACE_ID_PREFIX} 开头`;
  if (!WATCHFACE_ID_PATTERN.test(normalized))
    return `表盘 ID 必须是 ${WATCHFACE_ID_LENGTH} 位纯数字`;
  return null;
}

export function normalizeWatchfaceIdInput(value: string): string {
  return value.replace(/\D+/g, "").slice(0, WATCHFACE_ID_LENGTH);
}

export async function replaceWatchfaceIdInFile(
  file: File,
  id: string,
): Promise<File> {
  const error = validateWatchfaceIdFormat(id);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < WATCHFACE_ID_OFFSET + WATCHFACE_ID_LENGTH) {
    throw new Error(`表盘文件 ${file.name} 太小，无法写入 ID`);
  }
  for (let i = 0; i < WATCHFACE_ID_LENGTH; i++) {
    bytes[WATCHFACE_ID_OFFSET + i] = id.charCodeAt(i);
  }
  return new File([bytes], file.name, {
    type: file.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

/**
 * 按包体类型改写表盘 ID：`.bin/.face` 写 offset 40；`.mwz` 解压内层 bin 后重压；
 * rpk 与未知格式原样返回。禁止对 `.mwz` 容器本身写字节。
 */
export async function replaceWatchfaceIdInPackage(
  file: File,
  id: string,
): Promise<File> {
  const error = validateWatchfaceIdFormat(id);
  if (error) throw new Error(error);
  return writeWatchfaceId(file, id);
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function writeIdToBinBytes(bytes: Uint8Array, id: string): Uint8Array {
  if (bytes.length < WATCHFACE_ID_OFFSET + WATCHFACE_ID_LENGTH) {
    throw new Error("表盘文件太小，无法写入 ID");
  }
  const out = new Uint8Array(bytes);
  for (let i = 0; i < WATCHFACE_ID_LENGTH; i += 1) {
    out[WATCHFACE_ID_OFFSET + i] = id.charCodeAt(i);
  }
  return out;
}

function wrapFile(bytes: Uint8Array, source: File): File {
  return new File([bytes as BlobPart], source.name, {
    type: source.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

async function writeWatchfaceId(file: File, id: string): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWith(bytes, WATCHFACE_MAGIC)) {
    return wrapFile(writeIdToBinBytes(bytes, id), file);
  }
  if (startsWith(bytes, ZIP_MAGIC)) {
    let entries: Unzipped;
    try {
      entries = unzipSync(bytes);
    } catch {
      return file;
    }
    if (pickManifestName(entries)) return file;
    const binName = findInnerBinName(entries);
    if (!binName) return file;
    entries[binName] = writeIdToBinBytes(entries[binName], id);
    return wrapFile(zipSync(entries), file);
  }
  return file;
}

export async function fetchExistingCatalogIds(
  token: string,
): Promise<Map<string, string>> {
  const { entries } = await fetchCatalogEntries({
    token,
    owner: "AstralSightStudios",
    repo: "AstroBox-Repo",
    ref: "main",
    path: PUBLISH_CONFIG.catalogFilePath,
  });
  const map = new Map<string, string>();
  for (const e of entries) {
    const id = e.id.trim();
    if (id) map.set(id, e.name.trim() || id);
  }
  return map;
}

export function generateUniqueWatchfaceId(existingIds: Map<string, string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = generateWatchfaceId();
    if (!existingIds.has(id)) return id;
  }
  throw new Error("无法生成未占用的表盘 ID，请稍后重试");
}

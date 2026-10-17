import { sendApiRequest } from "./request";

export type HotUpdatePlatform =
  | "all"
  | "ios"
  | "android"
  | "macos"
  | "windows"
  | "linux";

export const HOTUPDATE_PLATFORMS: HotUpdatePlatform[] = [
  "all",
  "ios",
  "android",
  "macos",
  "windows",
  "linux",
];

export interface HotUpdateBlob {
  sha256: string;
  size: number;
}

/** 二进制差分：客户端本地有 from 那份旧文件时只需下载这一小段。 */
export interface HotUpdateFilePatch extends HotUpdateBlob {
  from: string;
  fromPath: string;
  /** 差分算法：缺省 zstd --patch-from；bsdiff 只用于逻辑层文件。 */
  kind?: "zstd" | "bsdiff";
}

export interface HotUpdateFile {
  path: string;
  sha256: string;
  size: number;
  /** 整文件 zstd 压缩版（hotupdate-pack.ts 产出，可选）。 */
  zst?: HotUpdateBlob;
  /** 相对旧版本的二进制差分（可选）。 */
  patches?: HotUpdateFilePatch[];
}

export interface HotUpdateEncodingStats {
  zstFiles: number;
  patchedFiles: number;
  /** 全新安装（无任何可复用文件）时的下载量：有压缩版按压缩版计。 */
  zstBytes: number;
}

/** 热更新逻辑层（Rust 命令层编成的 WASM 组件，与前端同包同版本）。 */
export interface HotUpdateLogic {
  /** 要求的最低宿主接口级别：只下发给级别够得着的新原生壳，老原生壳永远拿不到。 */
  minHostLevel: number;
  buildId: string;
  files: HotUpdateFile[];
  fileCount?: number;
  totalSize?: number;
  encoding?: HotUpdateEncodingStats;
}

export interface HotUpdateRelease {
  id: string;
  channel: string;
  platform: HotUpdatePlatform;
  version: number;
  semver: string;
  minNativeVersion: string;
  maxNativeVersion: string;
  filesBaseUrl: string;
  files: HotUpdateFile[];
  fileCount: number;
  totalSize: number;
  rollout: number;
  notes: string;
  enabled: boolean;
  revoked: boolean;
  /** 强制更新：低于该版本的客户端被整屏拦住直到装好（无视灰度）。 */
  mandatory: boolean;
  encoding?: HotUpdateEncodingStats;
  logic?: HotUpdateLogic | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HotUpdatePatch {
  id: string;
  channel: string;
  platform: HotUpdatePlatform;
  patchId: string;
  script: string;
  minNativeVersion: string;
  maxNativeVersion: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManifestPreview {
  manifest: {
    channel: string;
    version: number;
    semver: string;
    min_native_version: string;
    platform: string;
    files_base_url: string;
    files: {
      path: string;
      sha256: string;
      size: number;
      zst?: HotUpdateBlob;
      patches?: { from: string; from_path: string; sha256: string; size: number }[];
    }[];
    rollout: number;
    revoke: number[];
    notes: string;
    required_version?: number;
    logic?: {
      min_host_level: number;
      files: { path: string; sha256: string; size: number }[];
    };
  } | null;
  envelope: { payload: string; sig: string } | null;
  signed: boolean;
}

export type KeyStatus =
  | { configured: false }
  | {
      configured: true;
      publicKeyHex: string;
      rustArray: string;
      configuredPublicKey: string | null;
    };

export interface CreateReleaseBody {
  channel: string;
  platform: HotUpdatePlatform;
  version: number;
  semver?: string;
  minNativeVersion?: string;
  maxNativeVersion?: string;
  filesBaseUrl: string;
  files: HotUpdateFile[];
  logic?: { minHostLevel: number; buildId?: string; files: HotUpdateFile[] };
  rollout?: number;
  notes?: string;
  enabled?: boolean;
  revoked?: boolean;
  mandatory?: boolean;
}

export interface UpdateReleaseBody {
  semver?: string;
  minNativeVersion?: string;
  maxNativeVersion?: string;
  filesBaseUrl?: string;
  files?: HotUpdateFile[];
  rollout?: number;
  notes?: string;
  enabled?: boolean;
  revoked?: boolean;
  mandatory?: boolean;
}

export interface CreatePatchBody {
  channel: string;
  platform: HotUpdatePlatform;
  patchId: string;
  script: string;
  minNativeVersion?: string;
  maxNativeVersion?: string;
  enabled?: boolean;
}

export interface UpdatePatchBody {
  script?: string;
  minNativeVersion?: string;
  maxNativeVersion?: string;
  enabled?: boolean;
}

function buildQuery(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const HotUpdateApi = {
  key: () => sendApiRequest<KeyStatus>("/admin/hotupdate/key", "GET"),
  preview: (channel: string, platform: string, native?: string, logic?: string) =>
    sendApiRequest<ManifestPreview>(
      `/admin/hotupdate/preview${buildQuery({ channel, platform, native, logic })}`,
      "GET",
    ),
  releases: {
    list: (query: { channel?: string; platform?: string; limit?: number }) =>
      sendApiRequest<{ items: HotUpdateRelease[] }>(
        `/admin/hotupdate/releases${buildQuery(query)}`,
        "GET",
      ),
    create: (body: CreateReleaseBody) =>
      sendApiRequest<HotUpdateRelease>(
        "/admin/hotupdate/releases",
        "POST",
        undefined,
        body,
      ),
    update: (id: string, body: UpdateReleaseBody) =>
      sendApiRequest<HotUpdateRelease>(
        `/admin/hotupdate/releases/${encodeURIComponent(id)}`,
        "PATCH",
        undefined,
        body,
      ),
    remove: (id: string) =>
      sendApiRequest<{ deleted: true }>(
        `/admin/hotupdate/releases/${encodeURIComponent(id)}`,
        "DELETE",
      ),
  },
  patches: {
    list: (query: { channel?: string; platform?: string; limit?: number }) =>
      sendApiRequest<{ items: HotUpdatePatch[] }>(
        `/admin/hotupdate/patches${buildQuery(query)}`,
        "GET",
      ),
    create: (body: CreatePatchBody) =>
      sendApiRequest<HotUpdatePatch>(
        "/admin/hotupdate/patches",
        "POST",
        undefined,
        body,
      ),
    update: (id: string, body: UpdatePatchBody) =>
      sendApiRequest<HotUpdatePatch>(
        `/admin/hotupdate/patches/${encodeURIComponent(id)}`,
        "PATCH",
        undefined,
        body,
      ),
    remove: (id: string) =>
      sendApiRequest<{ deleted: true }>(
        `/admin/hotupdate/patches/${encodeURIComponent(id)}`,
        "DELETE",
      ),
  },
};

// 解析 hotupdate-pack.ts 产出的 release.json
export interface ParsedReleaseJson {
  version: number;
  semver: string;
  channel?: string;
  platform?: HotUpdatePlatform;
  minNativeVersion: string;
  maxNativeVersion: string;
  filesBaseUrl?: string;
  mandatory: boolean;
  files: HotUpdateFile[];
  /** --logic 打进来的逻辑层（可选）。 */
  logic?: { minHostLevel: number; buildId: string; files: HotUpdateFile[] };
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

function parseBlob(raw: any): HotUpdateBlob | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw.sha256 !== "string" || !HEX64.test(raw.sha256))
    throw new Error("release.json 的 zst 条目非法");
  return {
    sha256: raw.sha256.toLowerCase(),
    size: typeof raw.size === "number" ? raw.size : 0,
  };
}

function parsePatches(raw: any): HotUpdateFilePatch[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error("release.json 的 patches 不是数组");
  return raw.map((p: any) => {
    if (
      !p ||
      typeof p.from !== "string" ||
      !HEX64.test(p.from) ||
      typeof p.sha256 !== "string" ||
      !HEX64.test(p.sha256)
    )
      throw new Error("release.json 的 patches 条目非法");
    const patch: HotUpdateFilePatch = {
      from: p.from.toLowerCase(),
      fromPath: typeof p.fromPath === "string" ? p.fromPath : "",
      sha256: p.sha256.toLowerCase(),
      size: typeof p.size === "number" ? p.size : 0,
    };
    if (p.kind === "bsdiff") patch.kind = "bsdiff";
    else if (p.kind !== undefined && p.kind !== "zstd")
      throw new Error("release.json 的 patches 差分算法未知");
    return patch;
  });
}

/** 统计清单里的传输编码，用于发布前预览。 */
export function summarizeEncodings(files: HotUpdateFile[]) {
  let zstFiles = 0;
  let patchedFiles = 0;
  let coldBytes = 0;
  for (const f of files) {
    if (f.zst) zstFiles++;
    if (f.patches?.length) patchedFiles++;
    coldBytes += f.zst?.size ?? f.size;
  }
  return { zstFiles, patchedFiles, coldBytes };
}

/**
 * 估算已装着 `base` 版本的客户端升级到 `files` 要下载多少：没变的文件零下载，
 * 变了的取「来自该版本的差分 / 压缩版 / 原文件」里最小的。
 */
export function estimateUpgradeBytes(
  files: HotUpdateFile[],
  base: HotUpdateFile[],
) {
  const baseShas = new Set(base.map((f) => f.sha256));
  let bytes = 0;
  let rawBytes = 0;
  let changed = 0;
  for (const f of files) {
    if (baseShas.has(f.sha256)) continue;
    changed++;
    rawBytes += f.size;
    const patch = f.patches
      ?.filter((p) => baseShas.has(p.from))
      .reduce((min, p) => Math.min(min, p.size), Infinity);
    bytes += Math.min(patch ?? Infinity, f.zst?.size ?? Infinity, f.size);
  }
  return { changed, bytes, rawBytes };
}

export function parseReleaseJson(text: string): ParsedReleaseJson {
  const raw = JSON.parse(text);
  if (typeof raw.version !== "number")
    throw new Error("release.json 缺少 version");
  if (!Array.isArray(raw.files) || raw.files.length === 0)
    throw new Error("release.json 缺少 files");
  const files: HotUpdateFile[] = raw.files.map(parseFileEntry);
  if (!files.some((f) => f.path === "index.html"))
    throw new Error("release.json 的 files 里没有 index.html");
  let logic: ParsedReleaseJson["logic"];
  if (raw.logic !== undefined && raw.logic !== null) {
    if (!Array.isArray(raw.logic.files) || raw.logic.files.length === 0)
      throw new Error("release.json 的 logic 缺少 files");
    const logicFiles: HotUpdateFile[] = raw.logic.files.map(parseFileEntry);
    if (logicFiles.some((f) => !f.path.startsWith("__logic__/")))
      throw new Error("release.json 的 logic 文件必须在 __logic__/ 下");
    if (!logicFiles.some((f) => f.path === "__logic__/applogic.wasm"))
      throw new Error("release.json 的 logic 缺少 __logic__/applogic.wasm");
    const level = Number(raw.logic.minHostLevel);
    if (!Number.isInteger(level) || level < 1)
      throw new Error("release.json 的 logic.minHostLevel 非法");
    logic = {
      minHostLevel: level,
      buildId: typeof raw.logic.buildId === "string" ? raw.logic.buildId : "",
      files: logicFiles,
    };
  }
  return {
    version: raw.version,
    semver: typeof raw.semver === "string" ? raw.semver : "",
    channel: typeof raw.channel === "string" ? raw.channel : undefined,
    platform:
      typeof raw.platform === "string"
        ? (raw.platform as HotUpdatePlatform)
        : undefined,
    minNativeVersion:
      typeof raw.minNativeVersion === "string" ? raw.minNativeVersion : "",
    maxNativeVersion:
      typeof raw.maxNativeVersion === "string" ? raw.maxNativeVersion : "",
    filesBaseUrl:
      typeof raw.filesBaseUrl === "string" ? raw.filesBaseUrl : undefined,
    mandatory: raw.mandatory === true,
    files,
    logic,
  };
}

function parseFileEntry(f: any): HotUpdateFile {
  if (
    !f ||
    typeof f.path !== "string" ||
    typeof f.sha256 !== "string" ||
    !HEX64.test(f.sha256)
  )
    throw new Error("release.json 的 files 条目非法");
  const file: HotUpdateFile = {
    path: f.path,
    sha256: String(f.sha256).toLowerCase(),
    size: typeof f.size === "number" ? f.size : 0,
  };
  const zst = parseBlob(f.zst);
  if (zst) file.zst = zst;
  const patches = parsePatches(f.patches);
  if (patches?.length) file.patches = patches;
  return file;
}

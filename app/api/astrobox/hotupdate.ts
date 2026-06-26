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

export interface HotUpdateFile {
  path: string;
  sha256: string;
  size: number;
}

export interface HotUpdateRelease {
  id: string;
  channel: string;
  platform: HotUpdatePlatform;
  version: number;
  semver: string;
  minNativeVersion: string;
  filesBaseUrl: string;
  files: HotUpdateFile[];
  fileCount: number;
  totalSize: number;
  rollout: number;
  notes: string;
  enabled: boolean;
  revoked: boolean;
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
    files: HotUpdateFile[];
    rollout: number;
    revoke: number[];
    notes: string;
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
  filesBaseUrl: string;
  files: HotUpdateFile[];
  rollout?: number;
  notes?: string;
  enabled?: boolean;
  revoked?: boolean;
}

export interface UpdateReleaseBody {
  semver?: string;
  minNativeVersion?: string;
  filesBaseUrl?: string;
  files?: HotUpdateFile[];
  rollout?: number;
  notes?: string;
  enabled?: boolean;
  revoked?: boolean;
}

export interface CreatePatchBody {
  channel: string;
  platform: HotUpdatePlatform;
  patchId: string;
  script: string;
  minNativeVersion?: string;
  enabled?: boolean;
}

export interface UpdatePatchBody {
  script?: string;
  minNativeVersion?: string;
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
  preview: (channel: string, platform: string) =>
    sendApiRequest<ManifestPreview>(
      `/admin/hotupdate/preview${buildQuery({ channel, platform })}`,
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
  filesBaseUrl?: string;
  files: HotUpdateFile[];
}

export function parseReleaseJson(text: string): ParsedReleaseJson {
  const raw = JSON.parse(text);
  if (typeof raw.version !== "number")
    throw new Error("release.json 缺少 version");
  if (!Array.isArray(raw.files) || raw.files.length === 0)
    throw new Error("release.json 缺少 files");
  const files: HotUpdateFile[] = raw.files.map((f: any) => {
    if (
      !f ||
      typeof f.path !== "string" ||
      typeof f.sha256 !== "string" ||
      !/^[0-9a-fA-F]{64}$/.test(f.sha256)
    )
      throw new Error("release.json 的 files 条目非法");
    return {
      path: f.path,
      sha256: String(f.sha256).toLowerCase(),
      size: typeof f.size === "number" ? f.size : 0,
    };
  });
  if (!files.some((f) => f.path === "index.html"))
    throw new Error("release.json 的 files 里没有 index.html");
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
    filesBaseUrl:
      typeof raw.filesBaseUrl === "string" ? raw.filesBaseUrl : undefined,
    files,
  };
}

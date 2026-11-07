/**
 * 发布页表单杂项：编辑模式从旧 manifest 还原下载行、拆分 ext 自定义字段、
 * 解析标签输入。均为纯函数，不依赖 React。
 */
import type { DownloadInput } from "~/routes/resource/publish/components/types";
import { createExistingUploadItem } from "~/routes/resource/publish/components/uploadUtils";
import type {
  ManifestDownloadInfo,
  ManifestExtObject,
} from "~/logic/publish/manifest";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";

export function isManifestExtObject(value: unknown): value is ManifestExtObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 从仓库已有 manifest 的 downloads 还原下载行；加密状态以服务端登记的密钥设备为准。 */
export function buildDownloadInputsFromManifest(params: {
  downloads?: Record<string, Partial<ManifestDownloadInfo>>;
  owner: string;
  repo: string;
  ref: string;
  encryptedDeviceSet?: Set<string>;
}): DownloadInput[] {
  const { downloads, owner, repo, ref, encryptedDeviceSet } = params;
  return Object.entries(downloads || {}).map(([platformId, info]) => {
    const fileName = info?.file_name || "";
    const rawLogs = info?.updatelogs;
    const rawVersionCode = info?.versionCode;
    const parsedVersionCode =
      typeof rawVersionCode === "number" && Number.isFinite(rawVersionCode)
        ? Math.trunc(rawVersionCode)
        : undefined;
    const version = info?.version || "";
    return {
      uid: crypto.randomUUID?.() ?? Math.random().toString(36),
      platformId,
      version,
      encryptOnUpload: encryptedDeviceSet?.has(platformId) ?? false,
      versionCode: parsedVersionCode,
      updatelogs: Array.isArray(rawLogs)
        ? rawLogs
            .map((log) => ({
              version: String(log.version ?? "").trim(),
              content: String(log.content ?? "").trim(),
            }))
            .filter((log) => log.version || log.content)
        : undefined,
      versionLocked: Boolean(fileName),
      versionSource: "existing" as const,
      previousVersion: version || undefined,
      previousVersionCode: parsedVersionCode,
      file: fileName
        ? createExistingUploadItem(
            fileName.split("/").pop() || fileName,
            buildRawFileUrl(owner, repo, ref, fileName),
            fileName,
          )
        : null,
      existingFileName: fileName,
      canopus: info?.canopus,
    };
  });
}

/**
 * 取出需要交给自定义 JSON 编辑框的 ext 字段。
 * 结构化字段（开关、试用下载、捆绑资源、壁纸）由各自的表单状态写入，
 * 若留在 JSON 里会出现两份互相覆盖的数据源。
 */
export function extractCustomExt(ext: ManifestExtObject | undefined): ManifestExtObject {
  if (!ext) return {};
  const next: ManifestExtObject = { ...ext };
  delete next.enableAstroBoxCreatorFeatures;
  delete next.trialDownloads;
  delete next.bundledResources;
  delete next.wallpaperGenerator;
  return next;
}

/**
 * 目录 CSV 的 devices / device_vendors 覆盖资源支持的全部设备。
 *
 * manifest 里正式包体在 downloads、试用包体在 ext.trialDownloads，两者都是
 * 资源可运行的设备；只取 downloads 会把「只提供试用包」的设备漏出目录，
 * 客户端会误判该资源不支持这些设备（见 AstroBox-Repo PR #1846）。
 */
export function collectCatalogDevices(
  rowGroups: ReadonlyArray<ReadonlyArray<{ platformId?: string }>>,
  vendorById: ReadonlyMap<string, string | undefined>,
): Array<{ id: string; vendor?: string }> {
  const devices = new Map<string, { id: string; vendor?: string }>();
  for (const rows of rowGroups) {
    for (const row of rows) {
      const id = row.platformId?.trim();
      if (!id) continue;
      const key = id.toLowerCase();
      if (devices.has(key)) continue;
      devices.set(key, { id, vendor: vendorById.get(key) });
    }
  }
  return Array.from(devices.values());
}

/** 标签输入框以中英文分号或逗号分隔。 */
export function parseTagText(raw: string): string[] {
    return raw
        .split(/[;；,，]/)
        .map((token) => token.trim())
        .filter(Boolean);
}
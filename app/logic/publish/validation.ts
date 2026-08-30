import { unzipSync } from "fflate";
import { log } from "~/logic/logging";

export interface ValidationUploadItem {
  id?: string;
  name?: string;
  file?: Blob;
  width?: number;
  height?: number;
  skipUpload?: boolean;
}

export interface ValidationDownloadInput {
  platformId: string;
  version: string;
  file: ValidationUploadItem | null;
  existingFileName?: string;
}

export interface ValidationLinkInput {
  icon: string;
  title: string;
  url: string;
}

export interface PublishValidationInput {
  itemId: string;
  itemName: string;
  previews: ValidationUploadItem[];
  icon: ValidationUploadItem | null;
  cover: ValidationUploadItem | null;
  usePreviewAsCover: boolean;
  coverPreviewId: string | null;
  downloads: ValidationDownloadInput[];
  trialDownloads: ValidationDownloadInput[];
  links: ValidationLinkInput[];
}

/** 封面必须为 3:2 宽高比（容差 0.02），且文件大小不得超过 1MB。 */
export const COVER_RATIO = 1.5;
export const COVER_RATIO_TOLERANCE = 0.02;
export const COVER_MAX_BYTES = 600 * 1024;

export interface PublishValidationResult {
  errors: string[];
  linkErrors: Array<string | null>;
}

export function normalizeLinkUrl(raw: string): string {
    let value = raw.trim();
    while (value.startsWith("`") && value.endsWith("`")) {
        value = value.slice(1, -1).trim();
    }
    if (value.startsWith("<") && value.endsWith(">")) {
        value = value.slice(1, -1).trim();
    }
    return value;
}

export function validateLink(link: ValidationLinkInput): string | null {
  if (![link.icon, link.title, link.url].some((value) => value.trim())) return null;
  const missing = [
    !link.icon.trim() && "图标",
    !link.title.trim() && "标题",
    !link.url.trim() && "网址",
  ].filter(Boolean);
  if (missing.length) return `请填写：${missing.join("、")}`;
  const url = normalizeLinkUrl(link.url);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname) return "仅支持有效 HTTPS URL";
  } catch {
    return "URL 格式无效";
  }
  return null;
}

function validateDownloadRows(
  rows: ValidationDownloadInput[],
  label: string,
): string[] {
  return rows.flatMap((row, index) => {
    const missing = [
      !row.platformId.trim() && "设备",
      !row.version.trim() && "版本",
      !row.file && !row.existingFileName?.trim() && "包体",
    ].filter(Boolean);
    return missing.length
      ? [`${label}第 ${index + 1} 行缺少${missing.join("、")}。`]
      : [];
  });
}

export function containsUrlUnsafeFilename(name: string): boolean {
  return /[#?%]/.test(name);
}

function validateUrlUnsafeFilenames(input: PublishValidationInput): string[] {
  const offenders: Array<{ label: string; name: string }> = [];
  const collect = (label: string, name?: string) => {
    if (name && containsUrlUnsafeFilename(name)) {
      offenders.push({ label, name });
    }
  };
  input.previews.forEach((item, index) =>
    collect(`预览图${input.previews.length > 1 ? ` ${index + 1}` : ""}`, item.name),
  );
  collect("图标", input.icon?.name);
  collect("封面", input.cover?.name);
  input.downloads.forEach((row) => collect("正式包", row.file?.name || row.existingFileName));
  input.trialDownloads.forEach((row) => collect("试用包", row.file?.name || row.existingFileName));
  if (offenders.length === 0) return [];
  return [
    `以下文件名包含 # ? % 等字符，客户端拼接 URL 时会被截断导致无法加载，请重命名后重新上传：${offenders
      .map((item) => `${item.label}「${item.name}」`)
      .join("、")}`,
  ];
}

export function validatePublish(
  input: PublishValidationInput,
): PublishValidationResult {
  const errors: string[] = [];
  if (!input.itemName.trim()) errors.push("请填写资源名称。");
  if (!input.itemId.trim()) errors.push("请填写资源 ID。");
  if (!input.icon) {
    errors.push("请上传图标。");
  } else if (!input.icon.width || !input.icon.height) {
    errors.push("图标无法读取，请重新上传。");
  } else if (input.icon.width !== input.icon.height) {
    errors.push("图标必须为正方形。");
  }
  if (input.previews.length === 0) errors.push("请至少上传一张预览图。");
  const hasCover = input.usePreviewAsCover
    ? input.coverPreviewId
      ? input.previews.some((preview) => preview.id === input.coverPreviewId)
      : input.previews.length > 0
    : Boolean(input.cover);
  if (!hasCover) {
    errors.push("请选择或上传封面。");
  } else {
    const coverItem = input.usePreviewAsCover
      ? (input.previews.find((preview) => preview.id === input.coverPreviewId) ??
        input.previews[0])
      : input.cover;
    if (coverItem) {
      if (!coverItem.width || !coverItem.height) {
        errors.push("封面无法读取，请重新上传。");
      } else if (
        Math.abs(coverItem.width / coverItem.height - COVER_RATIO) >
        COVER_RATIO_TOLERANCE
      ) {
        errors.push(
          `封面必须为 3:2 宽高比，当前 ${(coverItem.width / coverItem.height).toFixed(2)}。`,
        );
      }
      if (coverItem.file && coverItem.file.size > COVER_MAX_BYTES) {
        errors.push("封面大小超过 1MB，请压缩后重新上传。");
      }
    }
  }
  if (input.downloads.length === 0) errors.push("请至少添加一个正式下载设备。");
  errors.push(...validateDownloadRows(input.downloads, "正式下载"));
  errors.push(...validateDownloadRows(input.trialDownloads, "试用下载"));
  errors.push(...validateUrlUnsafeFilenames(input));
  const linkErrors = input.links.map(validateLink);
  const linkErrorText = linkErrors.filter(Boolean).join("；");
  if (linkErrorText) {
    errors.push(`外部链接填写不完整：${linkErrorText}`);
  }
  return { errors, linkErrors };
}

export async function readRpkPackage(file: Blob): Promise<string> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("RPK 文件无法解压。");
  }
  const manifestName = Object.keys(entries).find(
    (name) => name.split(/[\\/]/).pop() === "manifest.json",
  );
  if (!manifestName) throw new Error("RPK 包内缺少 manifest.json。");
  try {
    const manifest = JSON.parse(new TextDecoder().decode(entries[manifestName]));
    if (typeof manifest.package !== "string") {
      throw new Error("RPK manifest.json 缺少 package 字段。");
    }
    return manifest.package;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RPK ")) throw error;
    throw new Error("RPK manifest.json 不是有效 JSON。");
  }
}

export interface RpkManifestInfo {
    packageName: string;
    versionName: string;
    /** RPK manifest.json 的数字版本号，ABNG 用于 latest > installed 的更新检测。 */
    versionCode?: number;
}

export async function readRpkManifestInfo(file: Blob): Promise<RpkManifestInfo> {
    log.debug("rpk/parse", "开始解析 RPK 包体（解压）", {
        data: {
            name: file instanceof File ? file.name : "(blob)",
            size: file.size,
        },
    });
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
        log.warn("rpk/parse", "RPK 解压失败（不是有效的 ZIP 包）", {
            data: { name: file instanceof File ? file.name : "(blob)" },
        });
        throw new Error("RPK 文件无法解压。");
    }
    const manifestName = Object.keys(entries).find(
        (name) => name.split(/[\\/]/).pop() === "manifest.json",
    );
    if (!manifestName) {
        log.warn("rpk/parse", "RPK 解压成功但未找到 manifest.json", {
            data: {
                entryCount: Object.keys(entries).length,
                entries: Object.keys(entries).slice(0, 20),
            },
        });
        throw new Error("RPK 包内缺少 manifest.json。");
    }
    let manifest: Record<string, unknown>;
    try {
        manifest = JSON.parse(new TextDecoder().decode(entries[manifestName]));
    } catch {
        log.warn("rpk/parse", "RPK manifest.json 不是有效 JSON", {
            data: { manifestPath: manifestName },
        });
        throw new Error("RPK manifest.json 不是有效 JSON。");
    }
    const packageName =
        typeof manifest.package === "string" ? manifest.package.trim() : "";
    const versionName =
        typeof manifest.versionName === "string"
            ? manifest.versionName.trim()
            : typeof manifest.version_name === "string"
              ? manifest.version_name.trim()
              : "";
    const rawVersionCode = manifest.versionCode;
    const versionCode =
        typeof rawVersionCode === "number" && Number.isFinite(rawVersionCode)
            ? Math.trunc(rawVersionCode)
            : typeof rawVersionCode === "string" &&
                rawVersionCode.trim() !== "" &&
                Number.isFinite(Number(rawVersionCode))
              ? Math.trunc(Number(rawVersionCode))
              : undefined;
    if (!packageName) {
        log.warn("rpk/parse", "RPK manifest.json 缺少 package 字段", {
            data: { manifestPath: manifestName },
        });
        throw new Error("RPK manifest.json 缺少 package 字段。");
    }
    log.info("rpk/parse", "RPK 解析完成", {
        data: {
            name: file instanceof File ? file.name : "(blob)",
            size: file.size,
            entryCount: Object.keys(entries).length,
            manifestPath: manifestName,
            packageName,
            versionName,
            versionCode,
        },
    });
    return { packageName, versionName, versionCode };
}

export async function validateRpkPackage(
  file: Blob,
  resourceId: string,
): Promise<void> {
  const packageName = await readRpkPackage(file);
  if (packageName !== resourceId) {
    throw new Error("RPK包名和资源ID不一致，将无法使用自动检查更新的功能。");
  }
}

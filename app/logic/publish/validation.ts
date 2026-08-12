import { unzipSync } from "fflate";

export interface ValidationUploadItem {
  id?: string;
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
export const COVER_MAX_BYTES = 1024 * 1024;

export interface PublishValidationResult {
  errors: string[];
  linkErrors: Array<string | null>;
}

export function validateLink(link: ValidationLinkInput): string | null {
  if (![link.icon, link.title, link.url].some((value) => value.trim())) return null;
  if (!link.url.trim()) return "请填写 URL";
  try {
    const url = new URL(link.url.trim());
    if (url.protocol !== "https:" || !url.hostname) return "仅支持有效 HTTPS URL";
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
  const linkErrors = input.links.map(validateLink);
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

export async function validateRpkPackage(
  file: Blob,
  resourceId: string,
): Promise<void> {
  const packageName = await readRpkPackage(file);
  if (packageName !== resourceId) {
    throw new Error(`RPK package 必须与资源 ID 精确一致：${resourceId}`);
  }
}

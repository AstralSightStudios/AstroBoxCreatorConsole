/**
 * 进入发布第二步（仓库上传）之前的全部前置检查。
 *
 * 图标/封面规格同时被上传时与 validatePublish 使用，故规则只定义一次。
 * 下载行判定一律返回「有问题的行」而非文案，调用方据此滚动定位并高亮。
 *
 * compressImageFile 使用 alwaysKeepResolution，压缩不改变像素尺寸，
 * 因此这里判定过一次之后压缩产物与原图结论一致，无需区分阶段。
 */
import type { DownloadInput } from "~/routes/resource/publish/components/types";

/** 封面必须为 3:2 宽高比（容差 0.02），且文件大小不得超过 1MB。 */
/** 封面必须为 3:2 宽高比（容差 0.02），且文件大小不得超过 1MB。 */
export const COVER_RATIO = 1.5;
export const COVER_RATIO_TOLERANCE = 0.02;
export const COVER_MAX_BYTES = 600 * 1024;

/** 图标必须为正方形，边长上限 500px。 */
export const ICON_MAX_DIMENSION = 500;
/** 图标压缩目标字节数。 */
export const ICON_COMPRESS_TARGET_BYTES = 100 * 1024;
/** 封面压缩目标即体积上限，压缩后仍超标则拒绝。 */
export const COVER_COMPRESS_TARGET_BYTES = COVER_MAX_BYTES;
/** 预览图压缩目标字节数（无硬性上限，仅按此目标压缩）。 */
export const PREVIEW_COMPRESS_TARGET_BYTES = 500 * 1024;

/** 尺寸可缺失：读取失败时 width/height 为空，判定函数会给出「无法读取」。 */
export interface ImageDimensions {
  width?: number;
  height?: number;
}

/** 图标规格检查。返回错误文案，通过则返回 null。 */
export function checkIconDimensions(dims: ImageDimensions): string | null {
  if (!dims.width || !dims.height) return "图标无法读取，请重新上传。";
  if (dims.width !== dims.height) return "图标必须为正方形（1:1）。";
  if (dims.width > ICON_MAX_DIMENSION || dims.height > ICON_MAX_DIMENSION)
    return `图标尺寸过大（边长需小于等于 ${ICON_MAX_DIMENSION}px）。`;
  return null;
}

/** 封面宽高比检查。 */
export function checkCoverRatio(dims: ImageDimensions): string | null {
  if (!dims.width || !dims.height) return "封面无法读取，请重新上传。";
  const ratio = dims.width / dims.height;
  if (Math.abs(ratio - COVER_RATIO) > COVER_RATIO_TOLERANCE)
    return `封面必须为 3:2 宽高比，当前 ${ratio.toFixed(2)}。`;
  return null;
}

/** 封面体积检查，单位为字节。 */
export function checkCoverFileSize(bytes: number): string | null {
  if (bytes > COVER_MAX_BYTES) return "封面大小超过 1MB，请压缩后重新上传。";
  return null;
}

/** 行是否已挂上包体（新上传或复用仓库已有文件）。 */
export function rowHasPackage(row: DownloadInput): boolean {
  return row.file !== null || Boolean(row.existingFileName);
}

/**
 * 已挂包体但未填写 versionCode 的行。versionCode 为强制项，
 * 缺失会导致 AstroBox 无法自动检查更新。
 */
export function rowsMissingVersionCode(rows: DownloadInput[]): DownloadInput[] {
  return rows.filter(
    (row) =>
      rowHasPackage(row) &&
      (row.versionCode === undefined || row.versionCode === null),
  );
}

/**
 * 包体内嵌包名与资源 ID 不一致的行。
 * 表盘与 dial 的标识本就不是包名，不参与判定。
 */
export function rowsWithIdentityMismatch(
  rows: DownloadInput[],
  itemId: string,
): DownloadInput[] {
  const id = itemId.trim();
  if (!id) return [];
  return rows.filter(
    (row) =>
      row.packageIdentityKind === "package" &&
      Boolean(row.packageIdentity) &&
      row.packageIdentity !== id,
  );
}

/**
 * versionCode 未超过上次发布值的行。包体变了但版本号没涨，
 * 用户将检测不到更新。
 */
export function rowsWithNonIncrementedVersionCode(
  rows: DownloadInput[],
): DownloadInput[] {
  return rows.filter(
    (row) =>
      row.versionSource === "package" &&
      row.versionCode !== undefined &&
      row.previousVersionCode !== undefined &&
      row.versionCode <= row.previousVersionCode,
  );
}

import {
  checkCoverFileSize,
  checkCoverRatio,
  checkIconDimensions,
} from "./pre-publish-checks";
import type { ResourceType } from "./resource-type";
import { validateCanopusIdFormat } from "./canopus-id";
import { validateResPackIdFormat } from "./res-pack-id";
import { validateWatchfaceIdFormat } from "./watchface-id";
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
  encryptOnUpload?: boolean;
}

export interface ValidationLinkInput {
  icon: string;
  title: string;
  url: string;
}

/** 标签数量下限：简介与标签是算法推流的输入，标签太少会让检索面过窄。 */
export const PUBLISH_TAGS_MIN = 3;
/** 标签数量建议上限，仅用于文案提示，不做强制拦截。 */
export const PUBLISH_TAGS_SUGGESTED_MAX = 10;

export interface PublishValidationInput {
  itemId: string;
  itemName: string;
  /** 资源简介，参与算法与推流，必填。 */
  description: string;
  /** 已解析的标签列表，参与搜索与推流，数量需达到 PUBLISH_TAGS_MIN。 */
  tags: string[];
  /** 资源类型；决定资源 ID 的格式规则。 */
  resourceType?: ResourceType;
  previews: ValidationUploadItem[];
  icon: ValidationUploadItem | null;
  cover: ValidationUploadItem | null;
  usePreviewAsCover: boolean;
  coverPreviewId: string | null;
  downloads: ValidationDownloadInput[];
  trialDownloads: ValidationDownloadInput[];
  links: ValidationLinkInput[];
  enableAstroBoxCreatorFeatures: boolean;
}

// 图片规格常量与判定统一在 media-rules，这里转出以保持既有导入路径可用。
export {
  COVER_RATIO,
  COVER_RATIO_TOLERANCE,
  COVER_MAX_BYTES,
} from "./pre-publish-checks";

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

/** 列出启用了加密上传的正式下载设备标识。试用包体不支持加密上传，不参与判断。 */
function encryptedDownloadDevices(rows: ValidationDownloadInput[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.encryptOnUpload === true)
        .map((row) => row.platformId.trim())
        .filter(Boolean),
    ),
  );
}

export function containsUrlUnsafeFilename(name: string): boolean {
  return /[#?%]/.test(name);
}

/**
 * 简介与标签是算法推流的直接输入，因此强制校验：
 * 简介不得为空，标签数量不得少于 PUBLISH_TAGS_MIN。
 *
 * 报错文案要说明该字段参与算法与推流——只说「请填写」创作者会当成格式要求
 * 随便糊一句，导致推流输入失真。
 */
export function validatePushQuality(
  description: string,
  tags: string[],
): string[] {
  const errors: string[] = [];
  if (!description.trim()) {
    errors.push(
      "请填写资源简介。简介内容参与算法与推流，请准确说明资源的实际功能与适用场景。",
    );
  }
  // 调用方可能传入未清洗的原始分段，这里按有效标签计数，避免空串骗过下限。
  const effectiveCount = tags.map((tag) => tag.trim()).filter(Boolean).length;
  if (effectiveCount < PUBLISH_TAGS_MIN) {
    errors.push(
      `标签数量不足，请至少添加 ${PUBLISH_TAGS_MIN} 个标签。标签内容参与搜索与推流，请填写与资源功能贴合的标签。`,
    );
  }
  return errors;
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
  const trimmedId = input.itemId.trim();
  if (!trimmedId) {
    errors.push("请填写资源 ID。");
  } else {
    // 资源 ID 会写进包体（表盘 12 位 ID、模块前缀、资源包 themeId），
    // 因此格式不合规必须在这里拦住，而不是发布时静默改写。
    const idError =
      input.resourceType === "watchface"
        ? validateWatchfaceIdFormat(trimmedId)
        : input.resourceType === "canopus"
          ? validateCanopusIdFormat(trimmedId)
          : input.resourceType === "res_pack"
            ? validateResPackIdFormat(trimmedId)
            : null;
    if (idError) errors.push(idError);
  }
  // 放在 ID 之后、媒体规格之前：这两条是推流质量问题，优先级高于配图，
  // 且步骤流转只提示 errors[0]，让创作者先补齐推流输入。
  errors.push(...validatePushQuality(input.description, input.tags));
  if (!input.icon) {
    errors.push("请上传图标。");
  } else {
    const iconError = checkIconDimensions(input.icon);
    if (iconError) errors.push(iconError);
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
      const ratioError = checkCoverRatio(coverItem);
      if (ratioError) errors.push(ratioError);
      if (coverItem.file) {
        const sizeError = checkCoverFileSize(coverItem.file.size);
        if (sizeError) errors.push(sizeError);
      }
    }
  }
  if (input.downloads.length === 0) errors.push("请至少添加一个正式下载设备。");
  errors.push(...validateDownloadRows(input.downloads, "正式下载"));
  errors.push(...validateDownloadRows(input.trialDownloads, "试用下载"));
  // 加密上传的包体必须同时开启 ext.enableAstroBoxCreatorFeatures：
  // 客户端依据该开关决定是否请求 purchase_info 与加密文件密钥，
  // 开关关闭时密文不会被解密，类型嗅探失败后安装直接报错。
  const encryptedDevices = encryptedDownloadDevices(input.downloads);
  if (encryptedDevices.length > 0 && !input.enableAstroBoxCreatorFeatures) {
    errors.push(
      `以下设备启用了加密上传：${encryptedDevices.join("、")}。加密包体必须同时开启「启用购买与资源加密相关功能」，否则客户端不会请求加密密钥、不解密包体，安装时会失败。`,
    );
  }
  errors.push(...validateUrlUnsafeFilenames(input));
  const linkErrors = input.links.map(validateLink);
  const linkErrorText = linkErrors.filter(Boolean).join("；");
  if (linkErrorText) {
    errors.push(`外部链接填写不完整：${linkErrorText}`);
  }
  return { errors, linkErrors };
}

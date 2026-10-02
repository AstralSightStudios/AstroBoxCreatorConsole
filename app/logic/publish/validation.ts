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

/**
 * 校验项对应的表单位置。取值必须与各 Section 上的 `data-publish-field`
 * 一致，`flashPublishField` 靠它定位 DOM。
 */
export type PublishFieldKey =
  | "itemName"
  | "itemId"
  | "description"
  | "tags"
  | "icon"
  | "previews"
  | "cover"
  | "downloads"
  | "trialDownloads"
  | "creatorFeatures"
  | "links";

export interface PublishValidationIssue {
  field: PublishFieldKey;
  message: string;
}

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
  /**
   * 下载配置里是否已有付费平台映射（爱发电 / CDK）。
   *
   * 三态：true/false 为已确认；undefined 表示付费映射弹窗从未成功加载过，
   * 此时不做拦截——服务端不可用时不该把创作者挡在发布之外。
   */
  hasPaidPlatformMapping?: boolean;
}

// 图片规格常量与判定统一在 media-rules，这里转出以保持既有导入路径可用。
export {
  COVER_RATIO,
  COVER_RATIO_TOLERANCE,
  COVER_MAX_BYTES,
} from "./pre-publish-checks";

export interface PublishValidationResult {
  /** 带字段归属的校验项，「下一步」时据此滚动闪烁到出问题的表单项。 */
  issues: PublishValidationIssue[];
  /** 只要文案的等价视图，按 issues 顺序排列。 */
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
  field: PublishFieldKey,
): PublishValidationIssue[] {
  return rows.flatMap((row, index) => {
    const missing = [
      !row.platformId.trim() && "设备",
      !row.version.trim() && "版本",
      !row.file && !row.existingFileName?.trim() && "包体",
    ].filter(Boolean);
    return missing.length
      ? [{ field, message: `${label}第 ${index + 1} 行缺少${missing.join("、")}。` }]
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
): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];
  if (!description.trim()) {
    issues.push({
      field: "description",
      message:
        "请填写资源简介。简介内容参与算法与推流，请准确说明资源的实际功能与适用场景。",
    });
  }
  // 调用方可能传入未清洗的原始分段，这里按有效标签计数，避免空串骗过下限。
  const effectiveCount = tags.map((tag) => tag.trim()).filter(Boolean).length;
  if (effectiveCount < PUBLISH_TAGS_MIN) {
    issues.push({
      field: "tags",
      message: `标签数量不足，请至少添加 ${PUBLISH_TAGS_MIN} 个标签。标签内容参与搜索与推流，请填写与资源功能贴合的标签。`,
    });
  }
  return issues;
}

function validateUrlUnsafeFilenames(
  input: PublishValidationInput,
): PublishValidationIssue[] {
  const offenders: Array<{ label: string; name: string; field: PublishFieldKey }> = [];
  const collect = (field: PublishFieldKey, label: string, name?: string) => {
    if (name && containsUrlUnsafeFilename(name)) {
      offenders.push({ field, label, name });
    }
  };
  input.previews.forEach((item, index) =>
    collect(
      "previews",
      `预览图${input.previews.length > 1 ? ` ${index + 1}` : ""}`,
      item.name,
    ),
  );
  collect("icon", "图标", input.icon?.name);
  collect("cover", "封面", input.cover?.name);
  input.downloads.forEach((row) =>
    collect("downloads", "正式包", row.file?.name || row.existingFileName),
  );
  input.trialDownloads.forEach((row) =>
    collect("trialDownloads", "试用包", row.file?.name || row.existingFileName),
  );
  // 汇总为一条，但字段归属取第一个出问题的文件，滚动定位到那里。
  if (offenders.length === 0) return [];
  return [
    {
      field: offenders[0].field,
      message: `以下文件名包含 # ? % 等字符，客户端拼接 URL 时会被截断导致无法加载，请重命名后重新上传：${offenders
        .map((item) => `${item.label}「${item.name}」`)
        .join("、")}`,
    },
  ];
}

export function validatePublish(
  input: PublishValidationInput,
): PublishValidationResult {
  const issues: PublishValidationIssue[] = [];
  const push = (field: PublishFieldKey, message: string) => issues.push({ field, message });

  if (!input.itemName.trim()) push("itemName", "请填写资源名称。");
  const trimmedId = input.itemId.trim();
  if (!trimmedId) {
    push("itemId", "请填写资源 ID。");
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
    if (idError) push("itemId", idError);
  }
  // 放在 ID 之后、媒体规格之前：这两条是推流质量问题，优先级高于配图，
  // 且步骤流转只提示第一条，让创作者先补齐推流输入。
  issues.push(...validatePushQuality(input.description, input.tags));
  if (!input.icon) {
    push("icon", "请上传图标。");
  } else {
    const iconError = checkIconDimensions(input.icon);
    if (iconError) push("icon", iconError);
  }
  if (input.previews.length === 0) push("previews", "请至少上传一张预览图。");
  const hasCover = input.usePreviewAsCover
    ? input.coverPreviewId
      ? input.previews.some((preview) => preview.id === input.coverPreviewId)
      : input.previews.length > 0
    : Boolean(input.cover);
  if (!hasCover) {
    push("cover", "请选择或上传封面。");
  } else {
    const coverItem = input.usePreviewAsCover
      ? (input.previews.find((preview) => preview.id === input.coverPreviewId) ??
        input.previews[0])
      : input.cover;
    if (coverItem) {
      const ratioError = checkCoverRatio(coverItem);
      if (ratioError) push("cover", ratioError);
      if (coverItem.file) {
        const sizeError = checkCoverFileSize(coverItem.file.size);
        if (sizeError) push("cover", sizeError);
      }
    }
  }
  if (input.downloads.length === 0) push("downloads", "请至少添加一个正式下载设备。");
  issues.push(...validateDownloadRows(input.downloads, "正式下载", "downloads"));
  issues.push(...validateDownloadRows(input.trialDownloads, "试用下载", "trialDownloads"));
  // 加密上传的包体必须同时开启 ext.enableAstroBoxCreatorFeatures：
  // 客户端依据该开关决定是否请求 purchase_info 与加密文件密钥，
  // 开关关闭时密文不会被解密，类型嗅探失败后安装直接报错。
  const encryptedDevices = encryptedDownloadDevices(input.downloads);
  if (encryptedDevices.length > 0 && !input.enableAstroBoxCreatorFeatures) {
    // 落点是 ext 里的开关而不是下载行：改配置要动的是开关那一侧，
    // 滚到包体行只会让人反复检查已经填对的表格。
    push(
      "creatorFeatures",
      `以下设备启用了加密上传：${encryptedDevices.join("、")}。加密包体必须同时开启「启用购买与资源加密相关功能」，否则客户端不会请求加密密钥、不解密包体，安装时会失败。`,
    );
  }
  // ext 开关会让客户端每次启动都请求 purchase_info 与加密文件密钥。
  // 没有任何加密包体、也没配付费平台映射时，这两个请求必定拿不到东西：
  // 白费一次网络往返，还把启动拖慢。只在「已确认没有映射」时拦截。
  if (
    input.enableAstroBoxCreatorFeatures &&
    encryptedDevices.length === 0 &&
    input.hasPaidPlatformMapping === false
  ) {
    push(
      "creatorFeatures",
      "已开启「启用购买与资源加密相关功能」，但没有任何设备启用加密上传，下载配置里也没有该资源的付费平台映射。客户端会因此多请求一次拿不到内容的购买信息，请关闭该开关，或补上加密上传 / 付费平台映射。",
    );
  }
  issues.push(...validateUrlUnsafeFilenames(input));
  const linkErrors = input.links.map(validateLink);
  const linkErrorText = linkErrors.filter(Boolean).join("；");
  if (linkErrorText) {
    push("links", `外部链接填写不完整：${linkErrorText}`);
  }
  return { issues, errors: issues.map((issue) => issue.message), linkErrors };
}

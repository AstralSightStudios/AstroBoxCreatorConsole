/**
 * 进入发布第二步（仓库上传）之前的全部前置检查。
 *
 * 图标/封面规格同时被上传时与 validatePublish 使用，故规则只定义一次。
 * 下载行判定一律返回「有问题的行」而非文案，调用方据此滚动定位并高亮。
 *
 * 图标在上传阶段就会按 ICON_MAX_DIMENSION 自动缩放，进入表单的图标一定是
 * 合规尺寸；这里保留上限判定是为了兜住草稿恢复等绕过上传路径的素材。
 * 封面压缩使用 alwaysKeepResolution，不改变像素尺寸，压缩前后结论一致。
 */
import type { DownloadInput } from "~/routes/resource/publish/components/types";
import type { ImageMeta } from "./image-meta";
import type { ResourceType } from "./resource-type";

/**
 * 封面必须严格为 3:2 宽高比，且文件大小不得超过 COVER_MAX_BYTES。
 *
 * 判定只认整数比值（宽 × 2 === 高 × 3），不设任何浮点容差：3:2 的整数倍
 * （1500×1000、1200×800）能精确命中，而 2560×1707 这类「相机导出凑整」的
 * 尺寸会被明确拒绝，不再靠 0.02 容差蒙混过关。
 */
const COVER_RATIO_NUM = 3;
const COVER_RATIO_DEN = 2;
export const COVER_RATIO = COVER_RATIO_NUM / COVER_RATIO_DEN; // 1.5，仅供文案展示
export const COVER_MAX_BYTES = 600 * 1024;

/**
 * 图标必须为正方形，边长上限 512px。
 *
 * 超过 512px 的图标由上传流程自动等比缩放，不再拒绝并让创作者自己改图。
 */
export const ICON_MAX_DIMENSION = 512;
/** 图标压缩目标字节数。 */
export const ICON_COMPRESS_TARGET_BYTES = 100 * 1024;
/** 封面压缩目标即体积上限，压缩后仍超标则拒绝。 */
export const COVER_COMPRESS_TARGET_BYTES = COVER_MAX_BYTES;
/** 静态预览图压缩目标字节数（无硬性上限，仅按此目标压缩）。 */
export const PREVIEW_COMPRESS_TARGET_BYTES = 500 * 1024;

/**
 * 动图预览不经过 canvas 压缩，必须单独设阈值。
 *
 * 144fps 是峰值硬上限（任一帧间隔 < 1000/144ms 即超限）；2MB 是建议优化线，
 * 4MB 是硬上限——客户端内联图片上限也是 4MB，超过会回退 GitHub raw。
 */
export const PREVIEW_ANIMATED_WARN_BYTES = 2 * 1024 * 1024;
export const PREVIEW_ANIMATED_MAX_BYTES = 4 * 1024 * 1024;
export const PREVIEW_TOTAL_WARN_BYTES = 8 * 1024 * 1024;
export const PREVIEW_TOTAL_MAX_BYTES = 12 * 1024 * 1024;
export const PREVIEW_ANIMATED_WARN_FPS = 120;
export const PREVIEW_ANIMATED_MAX_FPS = 144;
export const PREVIEW_ANIMATED_WARN_FRAMES = 300;
export const PREVIEW_ANIMATED_MAX_FRAMES = 600;
export const PREVIEW_ANIMATED_WARN_DURATION_MS = 5_000;
export const PREVIEW_ANIMATED_MAX_DURATION_MS = 10_000;

export interface PreviewIssue {
    level: "warn" | "fail";
    message: string;
}

function formatPreviewBytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 动图的体积/帧率/帧数/时长问题。返回全部命中项，调用方自行决定展示哪些。 */
export function getAnimatedPreviewIssues(meta: ImageMeta, sizeBytes: number): PreviewIssue[] {
    if (!meta.animated) return [];
    const issues: PreviewIssue[] = [];

    if (sizeBytes > PREVIEW_ANIMATED_MAX_BYTES) {
        issues.push({
            level: "fail",
            message: `动图体积 ${formatPreviewBytes(sizeBytes)} 超过上限 ${formatPreviewBytes(PREVIEW_ANIMATED_MAX_BYTES)}`,
        });
    } else if (sizeBytes > PREVIEW_ANIMATED_WARN_BYTES) {
        issues.push({
            level: "warn",
            message: `动图体积 ${formatPreviewBytes(sizeBytes)} 超过建议值 ${formatPreviewBytes(PREVIEW_ANIMATED_WARN_BYTES)}`,
        });
    }

    // 文件被截断（例如超过 4MB 只读了头部）时帧数/时长不完整，不能据此判 fail。
    // 体积仍然可靠，由上面的体积/审核详情负责。
    if (!meta.partial) {
        if (meta.peakFps != null && meta.peakFps > PREVIEW_ANIMATED_MAX_FPS + 0.001) {
            issues.push({
                level: "fail",
                message: `峰值帧率 ${meta.peakFps.toFixed(1)}fps 超过上限 ${PREVIEW_ANIMATED_MAX_FPS}fps`,
            });
        } else if (meta.peakFps != null && meta.peakFps > PREVIEW_ANIMATED_WARN_FPS) {
            issues.push({
                level: "warn",
                message: `峰值帧率 ${meta.peakFps.toFixed(1)}fps 偏高（建议 ≤${PREVIEW_ANIMATED_WARN_FPS}fps）`,
            });
        }

        if (meta.frames != null && meta.frames > PREVIEW_ANIMATED_MAX_FRAMES) {
            issues.push({
                level: "fail",
                message: `动图 ${meta.frames} 帧，超过上限 ${PREVIEW_ANIMATED_MAX_FRAMES} 帧`,
            });
        } else if (meta.frames != null && meta.frames > PREVIEW_ANIMATED_WARN_FRAMES) {
            issues.push({
                level: "warn",
                message: `动图 ${meta.frames} 帧，超过建议值 ${PREVIEW_ANIMATED_WARN_FRAMES} 帧`,
            });
        }

        if (meta.durationMs != null && meta.durationMs > PREVIEW_ANIMATED_MAX_DURATION_MS) {
            issues.push({
                level: "fail",
                message: `动图时长 ${(meta.durationMs / 1000).toFixed(1)}s，超过上限 ${PREVIEW_ANIMATED_MAX_DURATION_MS / 1000}s`,
            });
        } else if (meta.durationMs != null && meta.durationMs > PREVIEW_ANIMATED_WARN_DURATION_MS) {
            issues.push({
                level: "warn",
                message: `动图时长 ${(meta.durationMs / 1000).toFixed(1)}s，超过建议值 ${PREVIEW_ANIMATED_WARN_DURATION_MS / 1000}s`,
            });
        }
    }

    return issues;
}

/** 发布页只提示最严重的一条；审核页用 getAnimatedPreviewIssues 展示全部。 */
export function checkAnimatedPreview(meta: ImageMeta, sizeBytes: number): PreviewIssue | null {
    const issues = getAnimatedPreviewIssues(meta, sizeBytes);
    return issues.find((issue) => issue.level === "fail") ?? issues[0] ?? null;
}

/** 静态预览体积。压缩目标 500KB，硬上限 1MB。 */
export function checkStaticPreviewSize(sizeBytes: number): PreviewIssue | null {
    if (sizeBytes > PREVIEW_COMPRESS_TARGET_BYTES * 2) {
        return {
            level: "fail",
            message: `静态预览 ${formatPreviewBytes(sizeBytes)} 超过上限 ${formatPreviewBytes(PREVIEW_COMPRESS_TARGET_BYTES * 2)}`,
        };
    }
    if (sizeBytes > PREVIEW_COMPRESS_TARGET_BYTES) {
        return {
            level: "warn",
            message: `静态预览 ${formatPreviewBytes(sizeBytes)} 超过建议值 ${formatPreviewBytes(PREVIEW_COMPRESS_TARGET_BYTES)}`,
        };
    }
    return null;
}

/** 所有预览图加起来的体积上限。 */
export function checkPreviewTotalSize(totalBytes: number): PreviewIssue | null {
    if (totalBytes > PREVIEW_TOTAL_MAX_BYTES) {
        return {
            level: "fail",
            message: `预览图总体积 ${formatPreviewBytes(totalBytes)} 超过上限 ${formatPreviewBytes(PREVIEW_TOTAL_MAX_BYTES)}`,
        };
    }
    if (totalBytes > PREVIEW_TOTAL_WARN_BYTES) {
        return {
            level: "warn",
            message: `预览图总体积 ${formatPreviewBytes(totalBytes)} 超过建议值 ${formatPreviewBytes(PREVIEW_TOTAL_WARN_BYTES)}`,
        };
    }
    return null;
}

/**
 * 预览图数量下限。
 *
 * 单张或少量的预览图无法展示资源的主界面、功能页与设置项，用户只能凭封面
 * 猜测实际效果，商店页的信息量也不足以支撑下载决策。发布页提交前与审核页
 * 自动检查共用这一下限，避免两边口径漂移。
 */
export const PUBLISH_PREVIEWS_MIN = 3;

/** 预览图数量检查：达到下限返回 null，否则返回给创作者看的文案。 */
export function checkPreviewCount(count: number): string | null {
  if (count >= PUBLISH_PREVIEWS_MIN) return null;
  return `请至少上传 ${PUBLISH_PREVIEWS_MIN} 张预览图。预览图是用户判断资源效果的主要依据，少于 ${PUBLISH_PREVIEWS_MIN} 张无法展示足够的界面与功能细节。`;
}

/** 尺寸可缺失：读取失败时 width/height 为空，判定函数会给出「无法读取」。 */
export interface ImageDimensions {
  width?: number;
  height?: number;
}

/**
 * 资源图片禁用的矢量格式。
 *
 * AstroBox 宿主并不统一：Apple 系走 WebKit，Android 走 Chromium 或厂商自研
 * WebView，WebView 版本还随系统碎片化。SVG 在这些引擎里的字体度量、渐变/滤镜
 * 与外链引用支持差异很大——同一份 SVG 在手环上可能正常、在手机上渐变丢失或
 * 整张不显示。资源图片是要随包下发到所有宿主端的公共素材，一份渲染不一致的
 * 图会直接影响商店页与设备内观感，因此这里只收位图。
 */
export const BANNED_IMAGE_EXTENSIONS: readonly string[] = ["svg"];

/** 媒体选择器的 accept 值：位图白名单，SVG 不进候选。 */
export const PUBLISH_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";

/** 禁用格式的说明，命中时的提示与审核结论共用同一句，避免两处各写一份。 */
export const BANNED_IMAGE_NOTICE =
  "SVG 矢量图在 WebKit、Chromium 与各家 WebView 上渲染差异很大，跨设备显示不一致，资源图片不支持 SVG。";

/** 取文件名的小写扩展名；传入仓库路径时只取末段，无有效扩展名返回空串。 */
function extensionOf(name?: string | null): string {
  const base = (name ?? "").trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // dot < 0：整段就是文件名；dot 在末尾：形如 `v1.2/icon` 的隐藏文件/无后缀名。
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

/** 文件名（或仓库路径）是否命中禁用的矢量格式。 */
export function isBannedImageName(name?: string | null): boolean {
  return BANNED_IMAGE_EXTENSIONS.includes(extensionOf(name));
}

/** 图片格式检查：命中禁用格式返回文案，通过返回 null。 */
export function checkImageFormat(name?: string | null): string | null {
  const ext = extensionOf(name);
  if (!BANNED_IMAGE_EXTENSIONS.includes(ext)) return null;
  return `${BANNED_IMAGE_NOTICE}请改用 PNG / JPEG 后重新上传。`;
}

/**
 * 内容嗅探所需的头部字节数。
 *
 * SVG 是文本，没有二进制魔数，但开头特征极强且必然出现在最前面：跳过
 * UTF-8 BOM 与前导空白后只能是 `<svg` 或 `<?xml`。256 字节足以覆盖
 * 带一段 XML 声明与注释的写法。
 */
export const SVG_SNIFF_BYTES = 256;

function bytesStartWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * 按文件内容判断是否为 SVG，用于识破「改扩展名伪装」。
 *
 * 只看后缀挡不住把 `logo.svg` 改名成 `logo.png` 再上传：后缀是 png，
 * 但 `<img>` 照样能解码出尺寸，规格校验也会通过，最终仓库里存的是
 * 一份名为 png 的 SVG。
 */
export function isSvgContent(bytes: Uint8Array): boolean {
  let start = 0;
  if (bytesStartWith(bytes, [0xef, 0xbb, 0xbf])) start = 3;
  while (
    start < bytes.length &&
    (bytes[start] === 0x20 ||
      bytes[start] === 0x09 ||
      bytes[start] === 0x0a ||
      bytes[start] === 0x0d)
  ) {
    start += 1;
  }
  if (asciiAt(bytes, start, "<svg")) return true;
  if (!asciiAt(bytes, start, "<?xml")) return false;
  const head = new TextDecoder().decode(
    bytes.subarray(start, Math.min(bytes.length, start + SVG_SNIFF_BYTES)),
  );
  return /<svg[\s>]/i.test(head);
}

/**
 * 图标形状校验：只判可读性与 1:1。
 *
 * 上传阶段先过这一关，再对超限图片自动缩放并压缩体积；边长上限不在此拦截，
 * 否则「软件能自动修好」的图会被提前退回给创作者手工处理。
 */
export function checkIconShape(dims: ImageDimensions): string | null {
  if (!dims.width || !dims.height) return "图标无法读取，请重新上传。";
  if (dims.width !== dims.height) return "图标必须为正方形（1:1）。";
  return null;
}

/** 图标规格检查。返回错误文案，通过则返回 null。 */
export function checkIconDimensions(dims: ImageDimensions): string | null {
  const shapeError = checkIconShape(dims);
  if (shapeError) return shapeError;
  const longestSide = Math.max(dims.width ?? 0, dims.height ?? 0);
  if (longestSide > ICON_MAX_DIMENSION)
    return `图标尺寸过大（边长需小于等于 ${ICON_MAX_DIMENSION}px）。`;
  return null;
}

/**
 * 尺寸是否严格等于 3:2。整数乘法判定，不引入容差。
 *
 * 发布页实时红框（shared.tsx 的 UploadSlot）与审核页（rule-checks）都复用它，
 * 三处曾各自写死 0.02 / 0.01 容差，同一张图在发布页能过、审核页判不过。
 */
export function hasExactCoverRatio(width: number, height: number): boolean {
  return width * COVER_RATIO_DEN === height * COVER_RATIO_NUM;
}

/** 封面宽高比检查：严格 3:2，不容差。 */
export function checkCoverRatio(dims: ImageDimensions): string | null {
  if (!dims.width || !dims.height) return "封面无法读取，请重新上传。";
  if (hasExactCoverRatio(dims.width, dims.height)) return null;
  const ratio = dims.width / dims.height;
  return `封面必须严格为 3:2 宽高比（宽 = 高 × ${COVER_RATIO}），当前 ${dims.width}×${dims.height}（${ratio.toFixed(2)}）。`;
}

/**
 * 字节体积格式化，本模块自用（阈值文案要给人读）。
 *
 * KB 一档刻意向上取整：文案同时印「上限」和「当前」，四舍五入会让刚超限的
 * 文件两项显示成同一个数（如 600.0 KB / 600.0 KB），读起来自相矛盾。
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 封面体积检查，单位为字节。文案里的门槛与当前体积都实算，不与常量脱钩。 */
export function checkCoverFileSize(bytes: number): string | null {
  if (bytes > COVER_MAX_BYTES)
    return `封面大小超过 ${formatBytes(COVER_MAX_BYTES)}（当前 ${formatBytes(bytes)}），请压缩后重新上传。`;
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
 * 原生 Canopus 资源里新上传、却读不出 `.canopus` 清单的行。商店条目的 `canopus`
 * 元数据只来自包内 manifest，读不出就无法在安装前拦下不兼容的固件。
 * 沿用线上旧文件的行不重新读包体，不在此列。
 */
export function rowsWithoutCanopusMeta(
  rows: DownloadInput[],
  resourceType: ResourceType,
): DownloadInput[] {
  if (resourceType !== "canopus") return [];
  return rows.filter((row) => row.file !== null && !row.canopus);
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

/** 已合入索引的 manifest 中某设备的版本信息，递增判定唯一的合法基线。 */
export interface PublishedDownloadBaseline {
  version?: string;
  versionCode?: number;
}

/**
 * 用「已合入索引的包体版本」重写各行的 previousVersion / previousVersionCode。
 *
 * 编辑一个尚未合入的 PR 时，`buildDownloadInputsFromManifest` 读到的是 PR 分支上的
 * manifest —— 那是还没发布的状态，把它当基线会让创作者每替换一次包体就再涨一次
 * versionCode：明明是同一个尚未合入的提交，版本号却被一路抬高。
 *
 * 递增要求唯一合法的基准是**索引指向的那个已合入版本**。因此这里用已发布 manifest
 * 覆盖基线，PR 内无论替换多少次包体，比的始终是线上那一版。
 *
 * 索引里没有该设备（首次发布、该设备从未发布、编辑的是新增设备）时清空基线：
 * 没有可对齐的版本，递增检查自然不参与——这正是「没进索引就可以随意改」。
 */
export function applyPublishedBaseline(
  rows: DownloadInput[],
  publishedDownloads:
    | Record<string, PublishedDownloadBaseline>
    | undefined,
): DownloadInput[] {
  return rows.map((row) => {
    const published = publishedDownloads?.[row.platformId];
    if (!published) {
      return {
        ...row,
        previousVersion: undefined,
        previousVersionCode: undefined,
      };
    }
    const versionCode = published.versionCode;
    return {
      ...row,
      previousVersion: published.version?.trim() || undefined,
      previousVersionCode:
        typeof versionCode === "number" && Number.isFinite(versionCode)
          ? Math.trunc(versionCode)
          : undefined,
    };
  });
}

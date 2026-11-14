/**
 * 给 AI 审核准备素材图片：缩小、转码，连同原图的真实规格一起带上。
 *
 * 模型按图计费，原图动辄几 MB，而判断封面排版、预览图质量用不到那么高的分辨率；
 * 缩小后的副本连同「原图 1200×800、356 KB、JPEG」这样的说明一起发，比例和体积以说明为准。
 * 图片在本地读取并转码后以 base64 上传，服务端不替任何人抓 URL，私有仓库里的素材也能看。
 */
import { fetchProxiedMediaBlob } from "~/logic/media-proxy";
import type { ReviewAiImage, ReviewAiImageRole } from "./ai";

/** 审核页自动检查算出的图片规格（rule-checks.ts 的 ImageSizeInfo 在结构上满足）。 */
export interface ReviewAiImageMeta {
  label: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  ratio?: number;
  format?: string;
  animated?: boolean;
  frames?: number;
  bannedFormat?: boolean;
}

export interface ReviewAiImageSource {
  role: ReviewAiImageRole;
  url: string;
  meta?: ReviewAiImageMeta;
}

// 封面要判断排版细节，留得大一些；预览图数量多，各自小一点
const MAX_EDGE: Record<ReviewAiImageRole, number> = { cover: 1280, preview: 1024, icon: 256 };
/** 一次最多带多少张预览图 */
export const REVIEW_AI_MAX_PREVIEWS = 8;
// 与服务端一致：单张 base64 不超过 1.4M 字符，合计不超过 6M
const MAX_IMAGE_BASE64 = 1_400_000;
const MAX_TOTAL_BASE64 = 5_600_000;
const JPEG_QUALITIES = [0.88, 0.75, 0.6];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 原图规格说明，例如「1200×800（宽高比 1.50），356 KB，JPEG」。 */
export function describeOriginalImage(input: {
  width?: number;
  height?: number;
  sizeBytes?: number;
  format?: string;
  animated?: boolean;
  frames?: number;
}): string {
  const parts: string[] = [];
  if (input.width && input.height) {
    parts.push(`${input.width}×${input.height}（宽高比 ${(input.width / input.height).toFixed(2)}）`);
  }
  if (typeof input.sizeBytes === "number" && input.sizeBytes > 0) {
    parts.push(formatBytes(input.sizeBytes));
  }
  if (input.format) parts.push(input.format.toUpperCase());
  if (input.animated) {
    parts.push(input.frames ? `动图共 ${input.frames} 帧，这里只有首帧` : "动图，这里只有首帧");
  }
  return parts.join("，");
}

/** 等比缩到最长边不超过 maxEdge；本来就小的不放大。 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片转码失败"))),
      type,
      quality,
    );
  });
}

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("无法解码图片（格式不受支持或文件损坏）");
  }
}

/**
 * 把一张图缩小并转码。图标保留透明通道用 PNG；封面与预览图铺白底转 JPEG，
 * 体积超限就逐级降低质量。
 */
export async function encodeReviewAiImage(
  blob: Blob,
  role: ReviewAiImageRole,
  meta?: ReviewAiImageMeta,
): Promise<ReviewAiImage> {
  const bitmap = await decodeImage(blob);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, MAX_EDGE[role]);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理图片");

    const note = describeOriginalImage({
      width: meta?.width ?? bitmap.width,
      height: meta?.height ?? bitmap.height,
      sizeBytes: meta?.sizeBytes ?? blob.size,
      format: meta?.format ?? blob.type.replace(/^image\//, ""),
      animated: meta?.animated,
      frames: meta?.frames,
    });

    if (role === "icon") {
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const data = await blobToBase64(await canvasToBlob(canvas, "image/png"));
      if (data.length <= MAX_IMAGE_BASE64) return { role, mime: "image/png", data, note };
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    for (const quality of JPEG_QUALITIES) {
      const data = await blobToBase64(await canvasToBlob(canvas, "image/jpeg", quality));
      if (data.length <= MAX_IMAGE_BASE64) return { role, mime: "image/jpeg", data, note };
    }
    throw new Error("图片压缩后仍然过大");
  } finally {
    bitmap.close();
  }
}

export interface PreparedReviewAiImages {
  images: ReviewAiImage[];
  /** 没能带上的图片及原因，展示给审核员：模型没看到的图不能当它看过 */
  skipped: Array<{ label: string; reason: string }>;
}

/**
 * 读取并准备一次提交的全部素材：图标、封面、最多 8 张预览图。
 * 单张读取或转码失败只跳过那一张；合计超出上限时从最后的预览图开始舍弃。
 */
export async function prepareReviewAiImages(
  sources: readonly ReviewAiImageSource[],
): Promise<PreparedReviewAiImages> {
  const images: ReviewAiImage[] = [];
  const skipped: PreparedReviewAiImages["skipped"] = [];
  let previewCount = 0;
  let total = 0;

  for (const source of sources) {
    const label = source.meta?.label ?? source.role;
    if (!source.url) continue;
    if (source.role === "preview" && ++previewCount > REVIEW_AI_MAX_PREVIEWS) {
      skipped.push({ label, reason: `预览图超过 ${REVIEW_AI_MAX_PREVIEWS} 张，其余未带上` });
      continue;
    }
    if (source.meta?.bannedFormat) {
      skipped.push({ label, reason: "SVG 等禁用格式不送审" });
      continue;
    }
    try {
      const blob = await fetchProxiedMediaBlob(source.url);
      const image = await encodeReviewAiImage(blob, source.role, source.meta);
      if (total + image.data.length > MAX_TOTAL_BASE64) {
        skipped.push({ label, reason: "图片总体积已达上限" });
        continue;
      }
      total += image.data.length;
      images.push(image);
    } catch (error) {
      skipped.push({
        label,
        reason: error instanceof Error ? error.message : "图片读取失败",
      });
    }
  }
  return { images, skipped };
}

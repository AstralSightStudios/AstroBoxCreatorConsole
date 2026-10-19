import { acceptToExtensions, basenameFromPath } from "./file-picker";
import { PUBLISH_IMAGE_ACCEPT } from "./pre-publish-checks";

export type MediaDropTarget = "previews" | "icon" | "cover";

const IMAGE_EXTENSIONS = new Set([
  ...acceptToExtensions(PUBLISH_IMAGE_ACCEPT),
  // 交给现有上传校验展示 SVG 禁用原因，避免绕过内容校验。
  "svg",
]);

/** 原生路径没有 MIME，浏览器拖入的图片也可能没有 MIME。 */
export function isDroppedImage(name: string, type = ""): boolean {
  const extension = basenameFromPath(name).split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension) || type.startsWith("image/");
}

export function mediaDropError(
  target: MediaDropTarget,
  imageCount: number,
): string | null {
  if (imageCount === 0) return "请拖入 PNG、JPEG、WebP 等图片文件。";
  if (target !== "previews" && imageCount > 1) {
    return `${target === "icon" ? "图标" : "封面"}一次只能拖入一张图片。`;
  }
  return null;
}

/** 原生拖放是物理像素；DOM 命中测试使用 CSS 像素，兼容 Retina / Windows 缩放。 */
export function dropClientPosition(
  position: { x: number; y: number },
  pixelRatio: number,
): { x: number; y: number } {
  const scale = pixelRatio > 0 ? pixelRatio : 1;
  return { x: position.x / scale, y: position.y / scale };
}

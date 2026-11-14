import { PUBLISH_CONFIG } from "~/config/publish";

/**
 * 预览图与封面比对的素材信息。
 *
 * 发布页的 `UploadItem`、校验输入与编辑模式回填的素材都满足这个结构，
 * 因此可以共用同一套「是否复用封面」的判定。
 */
export interface PreviewReuseMedia {
  name?: string;
  file?: Blob;
  /** 仓库已有素材的落点路径；编辑模式与新上传复用同一路径。 */
  pathOverride?: string;
  skipUpload?: boolean;
}

function mediaFileName(item: PreviewReuseMedia): string {
  const file = item.file as File | undefined;
  return (file?.name || item.name || "").trim();
}

/**
 * 媒体去重键，口径必须与 `buildManifest` 的 `reuseDuplicateAsset` 一致：
 * 仓库已有素材按路径复用，新上传素材按「文件名 + 大小 + 类型」复用。
 *
 * 返回 `null` 表示无法确定身份（例如草稿里的空占位），调用方应把它当成
 * 一张独立预览图，宁可多算也不误删。
 */
export function mediaReuseKey(item: PreviewReuseMedia): string | null {
  const name = mediaFileName(item);
  const path =
    item.pathOverride?.trim() ||
    (name ? `${PUBLISH_CONFIG.mediaDirectory.replace(/\/+$/, "")}/${name}` : "");
  if (item.skipUpload) return path ? `existing:${path}` : null;
  if (!item.file || !name) return null;
  return `${name}|${item.file.size}|${item.file.type}`;
}

/** 这张预览图是否会复用封面文件。 */
export function previewReusesCover(
  preview: PreviewReuseMedia,
  cover: PreviewReuseMedia | null | undefined,
): boolean {
  if (!cover) return false;
  const coverKey = mediaReuseKey(cover);
  const previewKey = mediaReuseKey(preview);
  return Boolean(coverKey && previewKey && coverKey === previewKey);
}

export interface IndependentPreviewCount {
  /** 能独立计入最低数量要求的预览图数量；同素材只算一张，复用封面的不算。 */
  count: number;
  /** 因与封面相同而被排除的预览图数量。 */
  reusedCoverCount: number;
}

/**
 * 统计独立的预览图数量。
 *
 * 与封面对应同一素材的预览图只是复用了封面文件，若仍计入下限，创作者就能
 * 用「封面 + 两张截图」凑够三张，商店页实际只有两张截图，达不到最低数量
 * 要求的目的。同一素材被重复添加时也按一张计，因为 `buildManifest` 会把
 * 它们折叠成同一个仓库路径。
 */
export function countIndependentPreviews(
  previews: readonly PreviewReuseMedia[],
  cover: PreviewReuseMedia | null | undefined,
): IndependentPreviewCount {
  const coverKey = cover ? mediaReuseKey(cover) : null;
  const seen = new Set<string>();
  let reusedCoverCount = 0;
  previews.forEach((preview, index) => {
    const key = mediaReuseKey(preview);
    if (!key) {
      // 无法判定身份的素材不参与去重，按独立预览图计。
      seen.add(`anonymous:${index}`);
      return;
    }
    if (coverKey && key === coverKey) {
      reusedCoverCount += 1;
      return;
    }
    seen.add(key);
  });
  return { count: seen.size, reusedCoverCount };
}

/**
 * 审核侧按 URL 统计：manifest 里 cover 与 preview 指向同一文件时，预览图
 * 只是复用了封面，不计入最低数量。空 URL 与重复 URL 同样不计数。
 */
export function countIndependentPreviewUrls(
  previewUrls: readonly string[],
  coverUrl: string | null | undefined,
): IndependentPreviewCount {
  const cover = (coverUrl ?? "").trim();
  const seen = new Set<string>();
  let reusedCoverCount = 0;
  for (const raw of previewUrls) {
    const url = raw.trim();
    if (!url) continue;
    if (cover && url === cover) {
      reusedCoverCount += 1;
      continue;
    }
    seen.add(url);
  }
  return { count: seen.size, reusedCoverCount };
}

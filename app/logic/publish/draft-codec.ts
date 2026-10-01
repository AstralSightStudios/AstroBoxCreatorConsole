/**
 * 草稿编解码：PublishDraftFormData 中的 Draft* 结构 ⇄ 发布页使用的 UI 类型。
 *
 * 媒体文件在草稿里以 dataURL（上传）或远端 URL（复用仓库已有文件）保存，
 * 恢复时重建为 File / UploadItem。仅在内存与 IndexedDB 之间转换，不涉及网络。
 */
import type { UploadItem } from "~/routes/resource/publish/components/shared";
import type { DownloadInput } from "~/routes/resource/publish/components/types";
import {
  createExistingUploadItem,
  createImageUploadItem,
  createUploadItem,
} from "~/routes/resource/publish/components/uploadUtils";
import type {
  DraftDownloadInput,
  DraftMediaItem,
  DraftWallpaperAsset,
} from "./publish-drafts";
import type { WallpaperAssetFile } from "~/logic/wallpaper/types";

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, base64] = dataUrl.split(",");
  const type = meta?.replace("data:", "").split(";")[0] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(base64 || ""), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

function imageMimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mimes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
  };
  return mimes[ext] || "application/octet-stream";
}

export async function serializeMediaItem(
  item: UploadItem | null,
): Promise<DraftMediaItem | null> {
  if (!item) return null;
  if (item.skipUpload || !item.file?.size) {
    return {
      id: item.id,
      name: item.name,
      url: item.url,
      pathOverride: item.pathOverride,
      skipUpload: true,
      source: "existing",
      width: item.width,
      height: item.height,
    };
  }
  return {
    id: item.id,
    name: item.name,
    dataUrl: await fileToDataUrl(item.file),
    pathOverride: item.pathOverride,
    skipUpload: item.skipUpload,
    source: "upload",
    width: item.width,
    height: item.height,
  };
}

export function restoreMediaItem(item: DraftMediaItem | null): UploadItem | null {
  if (!item) return null;
  if (item.dataUrl) {
    const file = dataUrlToFile(item.dataUrl, item.name);
    const restored = createUploadItem(file);
    return {
      ...restored,
      pathOverride: item.pathOverride,
      width: item.width,
      height: item.height,
    };
  }
  return {
    id: item.id,
    name: item.name,
    url: item.url || "",
    file: new File([], item.name),
    pathOverride: item.pathOverride,
    skipUpload: true,
    source: "existing",
    width: item.width,
    height: item.height,
  };
}

export async function serializeDownloadInputs(
  inputs: DownloadInput[],
): Promise<DraftDownloadInput[]> {
  return Promise.all(
    inputs.map(async (item) => {
      const file = item.file;
      if (!file?.file?.size) {
        return { ...item, file: null };
      }
      const bytes = await file.file.arrayBuffer();
      return {
        ...item,
        file: {
          id: file.id,
          name: file.name,
          type: file.file.type,
          size: bytes.byteLength,
          bytes,
          pathOverride: file.pathOverride,
          skipUpload: file.skipUpload,
          source: file.source,
        },
      };
    }),
  );
}

export function restoreDownloadInput(item: DraftDownloadInput): DownloadInput {
  if (item.file?.bytes?.byteLength) {
    const file = new File([item.file.bytes], item.file.name, {
      type: item.file.type || "application/octet-stream",
    });
    const restored = createUploadItem(file);
    return {
      ...item,
      file: {
        ...restored,
        id: item.file.id,
        pathOverride: item.file.pathOverride,
        skipUpload: item.file.skipUpload,
        source: item.file.source,
      },
      existingFileName: undefined,
    };
  }
  // 旧版草稿可能残留 WebKitGTK 无法回读的 File 对象：直接置空，
  // 避免恢复后上传报 “The object can not be found here.”。
  return { ...item, file: null };
}

export async function serializeWallpaperAsset(
  asset: WallpaperAssetFile,
): Promise<DraftWallpaperAsset> {
  if (asset.file?.size) {
    return { path: asset.path, dataUrl: await fileToDataUrl(asset.file), skipUpload: false };
  }
  return { path: asset.path, url: asset.url, skipUpload: true };
}

export function restoreWallpaperAsset(item: DraftWallpaperAsset): WallpaperAssetFile {
  if (item.dataUrl) {
    const name = item.path.split("/").pop() || "asset";
    const file = dataUrlToFile(item.dataUrl, name);
    return { path: item.path, url: URL.createObjectURL(file), file };
  }
  return { path: item.path, url: item.url || "", skipUpload: true };
}

export async function loadRemoteMediaItem(
  path: string,
  url: string,
): Promise<UploadItem> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File(
      [blob],
      path.split("/").pop() || "image",
      { type: blob.type || imageMimeFromPath(path) },
    );
    const item = await createImageUploadItem(file);
    return {
      ...item,
      pathOverride: path,
      skipUpload: true,
      source: "existing",
    };
  } catch (error) {
    console.warn("[edit-media] failed to download remote image", path, error);
    return createExistingUploadItem(
      path.split("/").pop() || "image",
      url,
      path,
    );
  }
}
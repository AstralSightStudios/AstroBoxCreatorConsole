import imageCompression from "browser-image-compression";
import type { UploadItem } from "./shared";

const COMPRESS_TARGET_HEIGHT = 720;

export function getImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("无法读取图片尺寸"));
        };
        img.src = url;
    });
}

/**
 * Resize image so its height is at most COMPRESS_TARGET_HEIGHT px while keeping
 * aspect ratio, then compress with minimal quality loss. PNG/WebP stay lossless;
 * JPEG is re-encoded at high quality.
 */
export async function compressImageFile(file: File): Promise<File> {
    const { width, height } = await getImageDimensions(file);

    // browser-image-compression limits the larger side via maxWidthOrHeight.
    // To make the output height exactly target height (only downscale, never upscale),
    // derive the matching larger-side limit.
    let maxWidthOrHeight: number;
    if (height > COMPRESS_TARGET_HEIGHT) {
        maxWidthOrHeight = Math.max(
            COMPRESS_TARGET_HEIGHT,
            Math.round((COMPRESS_TARGET_HEIGHT * width) / height),
        );
    } else {
        maxWidthOrHeight = Math.max(width, height);
    }

    const compressed = await imageCompression(file, {
        maxWidthOrHeight,
        initialQuality: 0.92,
        preserveExif: false,
        fileType: file.type || "image/jpeg",
        // Web workers can be flaky inside Tauri's webview; target size is small
        // enough that main-thread processing is fine.
        useWebWorker: false,
    });

    // Keep original filename; imageCompression may rename the output.
    return new File([compressed], file.name, { type: compressed.type });
}

export const createUploadItem = (file: File): UploadItem => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
    name: file.name,
    url: URL.createObjectURL(file),
    file,
    source: "upload",
});

export const createImageUploadItem = async (file: File): Promise<UploadItem> => ({
    ...createUploadItem(file),
    ...(await getImageDimensions(file)),
});

export const createExistingUploadItem = (
    name: string,
    url: string,
    pathOverride?: string,
): UploadItem => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
    name,
    url,
    file: new File([new Uint8Array()], name),
    pathOverride,
    skipUpload: true,
    source: "existing",
});

export const revokeUrl = (item: UploadItem | null | undefined) => {
    if (item?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(item.url);
    }
};

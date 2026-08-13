import imageCompression from "browser-image-compression";
import type { UploadItem } from "./shared";

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
export async function compressImageFile(
    file: File,
    targetBytes: number,
    useWorker = true,
): Promise<File> {
    if (file.size <= targetBytes) return file;

    const { width, height } = await getImageDimensions(file);
    try {
        const compressed = await imageCompression(file, {
            maxSizeMB: Math.max(0.01, targetBytes / (1024 * 1024)),
            maxWidthOrHeight: Math.max(width, height),
            alwaysKeepResolution: true,
            initialQuality: 0.95,
            preserveExif: false,
            fileType: file.type || "image/jpeg",
            useWebWorker: useWorker,
        });

        return new File([compressed], file.name, { type: compressed.type });
    } catch (error) {
        if (useWorker) {
            console.warn(
                "image compression worker failed, falling back to main thread",
                error,
            );
            return compressImageFile(file, targetBytes, false);
        }
        throw error;
    }
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

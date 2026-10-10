import imageCompression from "browser-image-compression";
import { SVG_SNIFF_BYTES, isBannedImageName, isSvgContent } from "~/logic/publish/pre-publish-checks";
import type { UploadItem } from "./shared";

/**
 * 剔除禁用格式（SVG）的图片文件，返回保留与被拒两组。
 *
 * 判定同时看文件名与文件内容：只看后缀挡不住把 `logo.svg` 改名成
 * `logo.png`，那种文件 `<img>` 能正常解码出尺寸，会一路通过宽高比校验，
 * 最终以 png 之名把 SVG 存进仓库。内容嗅探只读文件头 256 字节，
 * 不受文件大小影响。
 */
export async function partitionAllowedImages(
    files: File[],
): Promise<{ allowed: File[]; rejected: File[] }> {
    const allowed: File[] = [];
    const rejected: File[] = [];
    for (const file of files) {
        if (isBannedImageName(file.name)) {
            rejected.push(file);
            continue;
        }
        try {
            const head = new Uint8Array(await file.slice(0, SVG_SNIFF_BYTES).arrayBuffer());
            if (isSvgContent(head)) rejected.push(file);
            else allowed.push(file);
        } catch {
            // 读不到头部字节时不武断拒绝：这类文件在后续尺寸读取阶段
            // 仍会被 getImageDimensions 拦下。
            allowed.push(file);
        }
    }
    return { allowed, rejected };
}

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

const URL_UNSAFE_FILENAME_PATTERN = /[#?%]/g;

export function containsUrlUnsafeFilename(name: string): boolean {
    return /[#?%]/.test(name);
}

export function sanitizeFileName(name: string): string {
    return name.replace(URL_UNSAFE_FILENAME_PATTERN, "-");
}

function ensureSafeFileName(file: File): File {
    if (!containsUrlUnsafeFilename(file.name)) return file;
    return new File([file], sanitizeFileName(file.name), { type: file.type });
}

export const createUploadItem = (rawFile: File): UploadItem => {
    const file = ensureSafeFileName(rawFile);
    return {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        source: "upload",
    };
};

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

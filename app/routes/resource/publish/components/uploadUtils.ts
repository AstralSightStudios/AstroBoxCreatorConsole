import imageCompression from "browser-image-compression";
import {
    extensionForFormat,
    formatToMime,
    imageExtension,
    inspectImageFile,
    normalizeImageExtension,
    type ImageMeta,
} from "~/logic/publish/image-meta";
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
 * 让文件后缀/MIME 与实际内容一致。
 *
 * WebKit 的 canvas 不能编码 WebP，`canvas.toDataURL("image/webp")` 会静默回退
 * PNG；如果继续沿用原文件名，就会产出“PNG 内容 + .webp 后缀”。这里按 magic
 * 识别真实格式并重命名，保证 manifest 路径和审核看到的扩展名可信。
 */
export async function normalizeImageFile(file: File, meta?: ImageMeta): Promise<File> {
    const inspected = meta ?? (await inspectImageFile(file));
    const extension = extensionForFormat(inspected.format);
    if (!extension) return file;

    const actualType = formatToMime(inspected.format) ?? file.type;
    const currentExtension = normalizeImageExtension(imageExtension(file.name));
    if (currentExtension === extension && actualType === file.type) return file;

    const dot = file.name.lastIndexOf(".");
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    return new File([file], `${base || "image"}.${extension}`, {
        type: actualType,
    });
}

/**
 * 静态图压缩：按目标体积重编码，不改变像素尺寸。
 *
 * 动图不在这里处理——canvas 只会保留第一帧，调用方必须在更外层识别并跳过。
 * 这里保留兜底：误传动图时原样返回，绝不静默转成静态图。
 */
export async function compressImageFile(
    file: File,
    targetBytes: number,
    useWorker = true,
): Promise<File> {
    const meta = await inspectImageFile(file);
    const normalized = await normalizeImageFile(file, meta);
    if (meta.animated) return normalized;
    if (normalized.size <= targetBytes) return normalized;

    const { width, height } = await getImageDimensions(normalized);
    return runImageCompression(
        normalized,
        {
            targetBytes,
            maxWidthOrHeight: Math.max(width, height),
            alwaysKeepResolution: true,
        },
        useWorker,
    );
}

/**
 * 图标导入处理：长边超过 maxDimension 时先等比缩到 maxDimension，再按目标体积压缩。
 *
 * 与 compressImageFile 的唯一区别是允许降低分辨率。图标是列表/详情页里的小图，
 * 512px 已远超实际显示尺寸，超限时由软件直接缩好，避免让创作者自己回去改图。
 * 缩放之后仍保持 alwaysKeepResolution，后续只会继续降质量，不会继续缩尺寸。
 */
export async function compressIconImage(
    file: File,
    targetBytes: number,
    maxDimension: number,
    useWorker = true,
): Promise<File> {
    const meta = await inspectImageFile(file);
    const normalized = await normalizeImageFile(file, meta);
    // 图标不允许动图；调用方会提前拦截，这里再兜一层，避免误压成首帧。
    if (meta.animated) return normalized;

    const { width, height } = await getImageDimensions(normalized);
    const longestSide = Math.max(width, height);
    if (longestSide <= maxDimension) {
        return compressImageFile(normalized, targetBytes, useWorker);
    }
    return runImageCompression(
        normalized,
        {
            targetBytes,
            maxWidthOrHeight: maxDimension,
            alwaysKeepResolution: true,
        },
        useWorker,
    );
}

interface ImageCompressionOptions {
    targetBytes: number;
    maxWidthOrHeight: number;
    alwaysKeepResolution: boolean;
}

async function runImageCompression(
    file: File,
    options: ImageCompressionOptions,
    useWorker: boolean,
): Promise<File> {
    try {
        const compressed = await imageCompression(file, {
            maxSizeMB: Math.max(0.01, options.targetBytes / (1024 * 1024)),
            maxWidthOrHeight: options.maxWidthOrHeight,
            alwaysKeepResolution: options.alwaysKeepResolution,
            initialQuality: 0.95,
            preserveExif: false,
            fileType: file.type || "image/jpeg",
            useWebWorker: useWorker,
        });
        const compressedFile = new File([compressed], file.name, {
            type: compressed.type,
        });
        // WebKit 可能把 WebP 回退成 PNG；按实际内容改名，避免 PNG 装 .webp。
        return normalizeImageFile(compressedFile);

    } catch (error) {
        if (useWorker) {
            console.warn(
                "image compression worker failed, falling back to main thread",
                error,
            );
            return runImageCompression(file, options, false);
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

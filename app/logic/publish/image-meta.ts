/**
 * 图片内容识别：格式 + 是否动图 + 帧数/时长/峰值帧率。
 *
 * 发布页和审核页共用这一份实现。判断只依赖文件头/chunk，不依赖扩展名或
 * `file.type`——这两者都可能是错的（例如 PNG 被改名成 .webp）。
 *
 * 动图判定：
 * - PNG/APNG：存在 acTL chunk
 * - WebP：VP8X 的 animation flag，或存在 ANIM/ANMF
 * - GIF：解析 block 后 image descriptor 数量 >= 2
 * - AVIF：ftyp 的 avis 品牌
 *
 * 解析器只做必要的边界检查；遇到截断/损坏时返回已经拿到的信息，并标记
 * `partial`，调用方应优先按“未知/异常”处理，绝不能把不确定的文件交给 canvas。
 */

export type ImageFormat =
    | "png"
    | "jpeg"
    | "gif"
    | "webp"
    | "bmp"
    | "avif"
    | "svg"
    | "unknown";

export interface ImageMeta {
    format: ImageFormat;
    animated: boolean;
    /** 容器声明的帧数；截断或格式不支持时为 undefined。 */
    frames?: number;
    /** 所有帧延迟之和（毫秒）；截断或格式不支持时为 undefined。 */
    durationMs?: number;
    /** 峰值帧率 = 1000 / 最短帧间隔。 */
    peakFps?: number;
    /** 文件被截断后解析，帧数/时长可能不完整。 */
    partial?: boolean;
}

const FORMAT_TO_MIME: Record<Exclude<ImageFormat, "unknown" | "svg">, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    avif: "image/avif",
};

const FORMAT_TO_EXTENSION: Record<Exclude<ImageFormat, "unknown" | "svg">, string> = {
    png: "png",
    jpeg: "jpg",
    gif: "gif",
    webp: "webp",
    bmp: "bmp",
    avif: "avif",
};

export function formatToMime(format: ImageFormat): string | null {
    if (format === "unknown" || format === "svg") return null;
    return FORMAT_TO_MIME[format];
}

export function extensionForFormat(format: ImageFormat): string | null {
    if (format === "unknown" || format === "svg") return null;
    return FORMAT_TO_EXTENSION[format];
}

export function formatFromMime(type: string | undefined | null): ImageFormat {
    const normalized = (type ?? "").trim().toLowerCase();
    if (normalized === "image/png") return "png";
    if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
    if (normalized === "image/gif") return "gif";
    if (normalized === "image/webp") return "webp";
    if (normalized === "image/bmp") return "bmp";
    if (normalized === "image/avif") return "avif";
    if (normalized === "image/svg+xml") return "svg";
    return "unknown";
}

export function imageExtension(name: string | undefined | null): string {
    const base = (name ?? "").trim().split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return "";
    return base.slice(dot + 1).toLowerCase();
}

export function normalizeImageExtension(ext: string): string {
    return ext === "jpeg" ? "jpg" : ext;
}

export function formatFromExtension(ext: string): ImageFormat {
    switch (normalizeImageExtension(ext)) {
        case "png":
            return "png";
        case "jpg":
            return "jpeg";
        case "gif":
            return "gif";
        case "webp":
            return "webp";
        case "bmp":
            return "bmp";
        case "avif":
            return "avif";
        case "svg":
            return "svg";
        default:
            return "unknown";
    }
}

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
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

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let result = "";
    for (let i = 0; i < length && offset + i < bytes.length; i += 1) {
        result += String.fromCharCode(bytes[offset + i]);
    }
    return result;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 3] << 24)) >>>
        0
    );
}

function readU16BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>>
        0
    );
}

function finishDuration(
    frames: number | undefined,
    durationMs: number,
    minFrameMs: number,
): Pick<ImageMeta, "frames" | "durationMs" | "peakFps"> {
    return {
        frames,
        durationMs: durationMs > 0 ? durationMs : undefined,
        peakFps: minFrameMs > 0 && Number.isFinite(minFrameMs)
            ? 1000 / minFrameMs
            : undefined,
    };
}

function inspectPng(bytes: Uint8Array): ImageMeta {
    let offset = 8;
    let animated = false;
    let frames: number | undefined;
    let durationMs = 0;
    let minFrameMs = Number.POSITIVE_INFINITY;

    while (offset + 12 <= bytes.length) {
        const length = readU32BE(bytes, offset);
        const type = readAscii(bytes, offset + 4, 4);
        const dataStart = offset + 8;
        if (dataStart + length + 4 > bytes.length) {
            return {
                format: "png",
                animated,
                ...(animated ? finishDuration(frames, durationMs, minFrameMs) : {}),
                partial: true,
            };
        }

        if (type === "acTL" && length >= 8) {
            animated = true;
            frames = readU32BE(bytes, dataStart);
        } else if (type === "fcTL" && length >= 26) {
            const delayNum = readU16BE(bytes, dataStart + 20);
            const delayDen = readU16BE(bytes, dataStart + 22);
            const denominator = delayDen === 0 ? 100 : delayDen;
            const frameMs = Math.max(1, Math.round((delayNum / denominator) * 1000));
            durationMs += frameMs;
            minFrameMs = Math.min(minFrameMs, frameMs);
        } else if (type === "IEND") {
            break;
        }

        offset = dataStart + length + 4;
    }

    return {
        format: "png",
        animated,
        ...(animated ? finishDuration(frames, durationMs, minFrameMs) : {}),
    };
}

function inspectWebp(bytes: Uint8Array): ImageMeta {
    let offset = 12;
    let animated = false;
    let frames = 0;
    let durationMs = 0;
    let minFrameMs = Number.POSITIVE_INFINITY;

    while (offset + 8 <= bytes.length) {
        const fourcc = readAscii(bytes, offset, 4);
        const size = readU32LE(bytes, offset + 4);
        const dataStart = offset + 8;
        if (dataStart + size > bytes.length) {
            return {
                format: "webp",
                animated,
                ...(animated
                    ? finishDuration(frames || undefined, durationMs, minFrameMs)
                    : {}),
                partial: true,
            };
        }

        if (fourcc === "VP8X" && size >= 1) {
            if ((bytes[dataStart] & 0x02) !== 0) animated = true;
        } else if (fourcc === "ANIM") {
            animated = true;
        } else if (fourcc === "ANMF") {
            animated = true;
            frames += 1;
            if (size >= 15) {
                const frameMs = Math.max(1, readU24LE(bytes, dataStart + 12));
                durationMs += frameMs;
                minFrameMs = Math.min(minFrameMs, frameMs);
            }
        }

        offset = dataStart + size + (size & 1);
    }

    return {
        format: "webp",
        animated,
        ...(animated
            ? finishDuration(frames || undefined, durationMs, minFrameMs)
            : {}),
    };
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): { offset: number; complete: boolean } {
    let offset = start;
    while (offset < bytes.length) {
        const length = bytes[offset];
        offset += 1;
        if (length === 0) return { offset, complete: true };
        offset += length;
    }
    return { offset, complete: false };
}

function inspectGif(bytes: Uint8Array): ImageMeta {
    if (bytes.length < 13) {
        return { format: "gif", animated: false, partial: true };
    }

    const packed = bytes[10];
    let offset = 13;
    if ((packed & 0x80) !== 0) {
        offset += 3 * (1 << ((packed & 0x07) + 1));
    }

    let frames = 0;
    let durationMs = 0;
    let minFrameMs = Number.POSITIVE_INFINITY;
    let pendingDelayMs: number | undefined;
    let complete = false;

    while (offset < bytes.length) {
        const block = bytes[offset];
        offset += 1;

        if (block === 0x3b) {
            complete = true;
            break;
        }

        if (block === 0x21) {
            if (offset >= bytes.length) break;
            const label = bytes[offset];
            offset += 1;

            if (label === 0xf9) {
                if (offset >= bytes.length) break;
                const blockSize = bytes[offset];
                offset += 1;
                if (blockSize >= 4 && offset + blockSize <= bytes.length) {
                    const delayCs = readU16LE(bytes, offset + 1);
                    // 浏览器通常把 0/1cs 当作 100ms 处理，这里按实际播放行为对齐。
                    pendingDelayMs = delayCs === 0 ? 100 : delayCs * 10;
                }
                offset += blockSize;
                const skipped = skipGifSubBlocks(bytes, offset);
                offset = skipped.offset;
                if (!skipped.complete) break;
            } else {
                const skipped = skipGifSubBlocks(bytes, offset);
                offset = skipped.offset;
                if (!skipped.complete) break;
            }
            continue;
        }

        if (block === 0x2c) {
            if (offset + 9 > bytes.length) break;
            const imagePacked = bytes[offset + 8];
            offset += 9;
            if ((imagePacked & 0x80) !== 0) {
                offset += 3 * (1 << ((imagePacked & 0x07) + 1));
            }
            if (offset >= bytes.length) break;
            offset += 1; // LZW minimum code size
            const skipped = skipGifSubBlocks(bytes, offset);
            offset = skipped.offset;
            if (!skipped.complete) break;

            frames += 1;
            const frameMs = pendingDelayMs ?? 100;
            durationMs += frameMs;
            minFrameMs = Math.min(minFrameMs, frameMs);
            pendingDelayMs = undefined;
            continue;
        }

        // 未知 block：按损坏处理，避免死循环。
        break;
    }

    return {
        format: "gif",
        // 解析不完整时不能断言“静态”：大 GIF 的第二帧可能不在读取窗口内。
        // 按动图处理，最坏也只是走动图体积阈值，绝不会被 canvas 压成首帧。
        animated: frames > 1 || (!complete && frames > 0),
        ...(frames > 0 ? finishDuration(frames, durationMs, minFrameMs) : {}),
        ...(complete ? {} : { partial: true }),
    };
}

function looksLikeSvg(bytes: Uint8Array): boolean {
    const head = new TextDecoder()
        .decode(bytes.subarray(0, Math.min(bytes.length, 512)))
        .trimStart();
    if (/^<svg[\s>]/i.test(head)) return true;
    return /^<\?xml/i.test(head) && /<svg[\s>]/i.test(head);
}

export function inspectImageBytes(bytes: Uint8Array): ImageMeta {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return inspectPng(bytes);
    }
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, "WEBP")) {
        return inspectWebp(bytes);
    }
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
        return inspectGif(bytes);
    }
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return { format: "jpeg", animated: false };
    }
    if (startsWith(bytes, [0x42, 0x4d])) {
        return { format: "bmp", animated: false };
    }
    if (asciiAt(bytes, 4, "ftyp")) {
        const brand = readAscii(bytes, 8, 4);
        if (brand === "avif" || brand === "avis") {
            return { format: "avif", animated: brand === "avis" };
        }
    }
    if (looksLikeSvg(bytes)) {
        return { format: "svg", animated: false };
    }
    return { format: "unknown", animated: false };
}

/**
 * 读取文件头部并识别内容。默认最多读 4MB：动图硬上限就是 4MB，
 * 超过这个体积的文件只需要知道“它是动图”就足够触发体积 fail。
 */
export async function inspectImageFile(
    file: Blob,
    maxBytes = 4 * 1024 * 1024,
): Promise<ImageMeta> {
    const limit = Math.max(0, Math.min(file.size, maxBytes));
    const bytes = new Uint8Array(await file.slice(0, limit).arrayBuffer());
    const meta = inspectImageBytes(bytes);
    if (file.size > limit) meta.partial = true;
    return meta;
}

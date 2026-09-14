import { basename as tauriBasename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "~/logic/update/update-checker";

/** 从 content:// 或绝对路径中提取文件名（兼容带查询参数与 URL 编码）。 */
export function basenameFromPath(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // 编码非法时退回原始字符串
  }
  const segments = decoded.split(/[\\/]/);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]) return segments[i];
  }
  return "file";
}

/** 根据扩展名推断 MIME 类型，供构造内存 File 与后续指纹/上传使用。 */
export function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mimes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
  };
  return mimes[ext] || "application/octet-stream";
}

function startsWithBytes(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
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

function sniffSvg(bytes: Uint8Array): boolean {
  let start = 0;
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) start = 3;
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
    bytes.subarray(start, Math.min(bytes.length, start + 256)),
  );
  return /<svg[\s>]/i.test(head);
}

/**
 * 依据文件头魔数推断扩展名，识别失败返回 null。
 * 用于原生选择器返回无后缀路径时补全（如 Android MediaStore 的 content://
 * 路径末段只有数字 ID，直接取 basename 会丢失 .png 等后缀）。
 */
export function sniffExtension(bytes: Uint8Array): string | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWithBytes(bytes, [0x42, 0x4d])) return "bmp";
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, "WEBP")) {
    return "webp";
  }
  if (asciiAt(bytes, 4, "ftyp")) {
    if (asciiAt(bytes, 8, "avif") || asciiAt(bytes, 8, "avis")) return "avif";
    if (
      asciiAt(bytes, 8, "heic") ||
      asciiAt(bytes, 8, "heix") ||
      asciiAt(bytes, 8, "hevc") ||
      asciiAt(bytes, 8, "mif1") ||
      asciiAt(bytes, 8, "msf1")
    ) {
      return "heic";
    }
  }
  if (sniffSvg(bytes)) return "svg";
  return null;
}

const EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,8}$/;

/** 文件名缺少后缀时按文件头补全；已有后缀或无法识别则原样返回。 */
export function ensureFileNameExtension(name: string, bytes: Uint8Array): string {
  if (EXTENSION_PATTERN.test(name)) return name;
  const ext = sniffExtension(bytes);
  return ext ? `${name}.${ext}` : name;
}

/**
 * 解析选中文件的真实文件名。
 *
 * Android 的图片选择器返回的是 `content://media/.../media/<数字ID>` 这类 URI，
 * 直接取路径末段只能得到数字 ID，会丢掉 `.png` 等后缀。优先调用
 * `@tauri-apps/api/path` 的 `basename`（其底层在 Android 上通过 PathPlugin
 * 查询 `OpenableColumns.DISPLAY_NAME`，返回真实文件名，覆盖所有文件类型）；
 * 拿不到或仍无后缀时，再按文件头魔数补全，保证上传路径带后缀。
 */
async function resolvePickedFileName(
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  try {
    const resolved = await tauriBasename(path);
    if (resolved) return ensureFileNameExtension(resolved, bytes);
  } catch {
    // 原生解析失败时退回路径解析
  }
  return ensureFileNameExtension(basenameFromPath(path), bytes);
}

/**
 * 通过 tauri-plugin-fs 将选中的 content:// / 绝对路径读入内存，
 * 构造浏览器 File 对象。Android WebView 无法用 FileReader 直接读取
 * content:// URI（报 NotFoundError），必须先经 ContentResolver 读到字节。
 */
async function pathToFile(path: string): Promise<File> {
  const bytes = await readFile(path);
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const name = await resolvePickedFileName(path, buffer);
  return new File([buffer], name, { type: mimeFromName(name) });
}

/** MIME 通配符/具体类型到原生对话框扩展名的映射。 */
const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/*": ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/bmp": ["bmp"],
  "image/svg+xml": ["svg"],
  "image/avif": ["avif"],
  "video/*": ["mp4", "webm", "mov"],
  "audio/*": ["mp3", "wav", "ogg", "m4a", "flac"],
  "application/zip": ["zip"],
  "application/pdf": ["pdf"],
  "application/json": ["json"],
};

/**
 * 将 accept 字符串（逗号分隔的扩展名/MIME）转换为原生对话框所需的扩展名列表。
 * 原生对话框只接受具体扩展名（如 "png"），传入 "image/*" 会生成非法过滤器，
 * 导致 Windows 下无法选中任何文件。
 */
export function acceptToExtensions(accept?: string): string[] {
  if (!accept) return [];
  const result: string[] = [];
  for (const token of accept.split(",")) {
    const value = token.trim().toLowerCase();
    if (!value) continue;
    const mapped = MIME_EXTENSIONS[value];
    if (mapped) {
      result.push(...mapped);
      continue;
    }
    if (value.includes("/")) {
      const subtype = value.split("/")[1];
      if (!subtype || subtype === "*") continue;
      result.push(subtype === "svg+xml" ? "svg" : subtype);
      continue;
    }
    result.push(value.replace(/^\./, ""));
  }
  return Array.from(new Set(result));
}

export interface PickFilesOptions {
  multiple?: boolean;
  /** 逗号分隔的扩展名/MIME，如 "png,jpg" 或 "image/*"。 */
  accept?: string;
  title?: string;
}

/**
 * 跨平台文件选择：
 * - Tauri 运行时使用原生对话框（Android 返回 content://），读入内存返回 File[]；
 * - 非 Tauri（纯浏览器）回退到隐藏 <input type="file">。
 */
export async function pickFiles(options: PickFilesOptions = {}): Promise<File[]> {
  if (isTauriRuntime()) {
    const extensions = acceptToExtensions(options.accept);
    const result = await open({
      multiple: options.multiple ?? false,
      title: options.title,
      filters: extensions.length
        ? [{ name: "Files", extensions }]
        : undefined,
    });
    if (!result) return [];
    const paths = Array.isArray(result) ? result : [result];
    const files: File[] = [];
    for (const path of paths) {
      files.push(await pathToFile(path));
    }
    return files;
  }

  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple ?? false;
    if (options.accept) {
      input.accept = options.accept
        .split(",")
        .map((token) => {
          const value = token.trim();
          return value.startsWith(".") || value.includes("/")
            ? value
            : `.${value}`;
        })
        .join(",");
    }
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

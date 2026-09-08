import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "~/logic/update/update-checker";

/** 从 content:// 或绝对路径中提取文件名（兼容带查询参数与 URL 编码）。 */
export function basenameFromPath(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  const segments = clean.split(/[\\/]/);
  const raw = segments[segments.length - 1] || "file";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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
  };
  return mimes[ext] || "application/octet-stream";
}

/**
 * 通过 tauri-plugin-fs 将选中的 content:// / 绝对路径读入内存，
 * 构造浏览器 File 对象。Android WebView 无法用 FileReader 直接读取
 * content:// URI（报 NotFoundError），必须先经 ContentResolver 读到字节。
 */
async function pathToFile(path: string): Promise<File> {
  const bytes = await readFile(path);
  const name = basenameFromPath(path);
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new File([buffer], name, { type: mimeFromName(name) });
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
    const extensions = (options.accept || "")
      .split(",")
      .map((token) => token.trim().replace(/^\./, ""))
      .filter(Boolean);
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

import type { NgPluginManifest } from "./plugin-repo";
import type { PluginIndexIssue } from "./plugin-index";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export interface PluginManifestValidationResult {
  manifest?: NgPluginManifest;
  issues: PluginIndexIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 校验 manifest 里声明的相对文件路径。允许子目录，但禁止绝对路径、`..`、
 * 反斜杠、完整 URL，以及指向 manifest.json 本身。
 */
export function validatePluginAssetPath(
  path: unknown,
  label: string,
): PluginIndexIssue[] {
  const issues: PluginIndexIssue[] = [];
  if (typeof path !== "string" || !path.trim()) {
    issues.push({ level: "error", message: `${label} 必须是非空字符串。` });
    return issues;
  }
  const value = path.trim();
  if (CONTROL_PATTERN.test(value)) {
    issues.push({ level: "error", message: `${label} 包含控制字符。` });
  }
  if (value.startsWith("/") || value.startsWith("\\")) {
    issues.push({ level: "error", message: `${label} 必须是相对路径。` });
  }
  if (value.includes("\\")) {
    issues.push({ level: "error", message: `${label} 不能包含反斜杠。` });
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    issues.push({ level: "error", message: `${label} 不能是完整 URL。` });
  }
  if (value.split("/").some((part) => part === ".." || part === ".")) {
    issues.push({ level: "error", message: `${label} 不能包含 . 或 .. 路径段。` });
  }
  if (value === "manifest.json" || value.endsWith("/manifest.json")) {
    issues.push({ level: "error", message: `${label} 不能指向 manifest.json。` });
  }
  return issues;
}

/**
 * 按 AstroBox 插件文档校验 manifest。
 *
 * 只对运行时真正强制的字段判 error：
 * - api_level 必须在 2/3/4；
 * - name 必须安全且非空；
 * - 文档中的必填字段必须存在。
 *
 * wasi_version 不在运行时强校验（Level 4 的 linker 同时注册 p2 与 p3），
 * 因此不检查 api_level 与 wasi_version 的对应关系，只对异常值给出提醒。
 */
export function validatePluginManifest(
  raw: unknown,
): PluginManifestValidationResult {
  const issues: PluginIndexIssue[] = [];
  if (!isRecord(raw)) {
    return {
      issues: [{ level: "error", message: "manifest.json 必须是 JSON 对象。" }],
    };
  }

  const name = asTrimmedString(raw.name);
  const icon = asTrimmedString(raw.icon);
  const version = asTrimmedString(raw.version);
  const description = asTrimmedString(raw.description);
  const author = asTrimmedString(raw.author);
  const website = asTrimmedString(raw.website);
  const entry = asTrimmedString(raw.entry);

  if (!name) {
    issues.push({ level: "error", message: "name 必须是非空字符串。" });
  } else {
    if (
      name === "." ||
      name === ".." ||
      name.endsWith(".") ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      CONTROL_PATTERN.test(name)
    ) {
      issues.push({
        level: "error",
        message: "name 包含运行时不允许的字符（/ \\ : 控制字符，或以 . 结尾）。",
      });
    }
  }

  if (!version) {
    issues.push({ level: "error", message: "version 必须是非空字符串。" });
  }
  if (!description) {
    issues.push({ level: "error", message: "description 必须是非空字符串。" });
  }
  if (!author) {
    issues.push({ level: "error", message: "author 必须是非空字符串。" });
  }
  if (!website) {
    issues.push({ level: "error", message: "website 必须是非空字符串。" });
  } else if (!isHttpUrl(website)) {
    issues.push({ level: "error", message: "website 必须是合法的 http(s) 地址。" });
  }

  issues.push(...validatePluginAssetPath(icon, "icon"));
  if (icon && /\.svg$/i.test(icon)) {
    issues.push({ level: "warn", message: "icon 建议使用 png，不建议使用 svg。" });
  }

  issues.push(...validatePluginAssetPath(entry, "entry"));
  if (entry && !/\.wasm$/i.test(entry)) {
    issues.push({ level: "error", message: "entry 必须是 .wasm 文件。" });
  }

  const apiLevel = raw.api_level;
  if (
    typeof apiLevel !== "number" ||
    !Number.isInteger(apiLevel)
  ) {
    issues.push({ level: "error", message: "api_level 必须是整数。" });
  } else if (![2, 3, 4].includes(apiLevel)) {
    issues.push({
      level: "error",
      message: `api_level=${apiLevel} 不受支持，当前仅支持 2 / 3 / 4。`,
    });
  }

  const wasiVersion = raw.wasi_version;
  if (
    typeof wasiVersion !== "number" ||
    !Number.isInteger(wasiVersion)
  ) {
    issues.push({ level: "error", message: "wasi_version 必须是整数。" });
  } else if (![2, 3].includes(wasiVersion)) {
    issues.push({
      level: "warn",
      message: `wasi_version=${wasiVersion} 不常见；当前插件通常使用 2 或 3。`,
    });
  }

  const permissions = raw.permissions;
  if (!Array.isArray(permissions)) {
    issues.push({ level: "error", message: "permissions 必须是字符串数组。" });
  } else {
    const seen = new Set<string>();
    for (const [index, permission] of permissions.entries()) {
      if (typeof permission !== "string" || !permission.trim()) {
        issues.push({
          level: "error",
          message: `permissions[${index}] 必须是非空字符串。`,
        });
        continue;
      }
      const value = permission.trim();
      if (seen.has(value)) {
        issues.push({
          level: "warn",
          message: `permissions 中存在重复项：${value}`,
        });
      }
      seen.add(value);
    }
  }

  const additionalFiles = raw.additional_files;
  if (additionalFiles !== undefined) {
    if (!Array.isArray(additionalFiles)) {
      issues.push({
        level: "error",
        message: "additional_files 必须是字符串数组。",
      });
    } else {
      for (const [index, file] of additionalFiles.entries()) {
        issues.push(
          ...validatePluginAssetPath(file, `additional_files[${index}]`),
        );
      }
    }
  }

  const hasError = issues.some((issue) => issue.level === "error");
  if (hasError) return { issues };

  return {
    issues,
    manifest: {
      name,
      icon,
      version,
      description,
      author,
      website,
      entry,
      wasi_version: wasiVersion as number,
      api_level: apiLevel as number,
      permissions: (permissions as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
      additional_files: Array.isArray(additionalFiles)
        ? (additionalFiles as unknown[])
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      enableSettingsButton:
        typeof raw.enableSettingsButton === "boolean"
          ? raw.enableSettingsButton
          : undefined,
      disable_default_padding:
        typeof raw.disable_default_padding === "boolean"
          ? raw.disable_default_padding
          : undefined,
    },
  };
}

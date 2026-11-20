/**
 * AstroBox-NG `manifest_v2.json` 的严格结构检查。
 *
 * 依据 `AstroBox-NG/src-tauri/modules/provider/src/community/models/common.rs`：
 * `ManifestV2` 与 `ManifestItemV2` 的字段都没有容器级 `#[serde(default)]`，
 * 因此缺字段、类型错误会让整份 manifest 反序列化失败 —— 资源仍会出现在目录里，
 * 但用户点进详情页时拿不到任何数据。审核侧必须在合入前拦住这类提交。
 *
 * 这里只复刻 serde 的行为，不做运营策略判断；返回的 issue 由调用方决定展示方式。
 */

import { canOmitDownloadPackage } from "./plugin-install";

export type ManifestIssueSeverity = "error" | "warning";

export interface ManifestSchemaIssue {
  /** JSON 路径，例如 `downloads["default"].versionCode`。根节点问题为空串。 */
  path: string;
  reason: string;
  severity: ManifestIssueSeverity;
}

const RESOURCE_TYPES = [
  "quick_app",
  "watchface",
  "canopus",
  "firmware",
  "res_pack",
] as const;

/** `PaidTypeV2`：免费是空字符串，不是 "free"。 */
const PAID_TYPES = ["", "paid", "force_paid"] as const;

const BUNDLED_TYPES = ["resource", "plugin"] as const;

const MAX_U32 = 4_294_967_295;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(record: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    record[key] !== undefined
  );
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组";
  switch (typeof value) {
    case "string":
      return "字符串";
    case "number":
      return Number.isInteger(value) ? "整数" : "小数";
    case "boolean":
      return "布尔值";
    case "object":
      return "对象";
    default:
      return typeof value;
  }
}

function keyPath(base: string, key: string): string {
  return `${base}[${JSON.stringify(key)}]`;
}

function error(path: string, reason: string): ManifestSchemaIssue {
  return { path, reason, severity: "error" };
}

function warning(path: string, reason: string): ManifestSchemaIssue {
  return { path, reason, severity: "warning" };
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  base: string,
): ManifestSchemaIssue | null {
  const path = base ? keyPath(base, key) : key;
  if (!has(record, key)) {
    return error(path, "缺少必填字段，AstroBox 会整份解析失败");
  }
  if (typeof record[key] !== "string") {
    return error(path, `必须是字符串，当前为 ${typeName(record[key])}`);
  }
  return null;
}

/** `Option<String>` 字段：缺失或 null 都合法，出现时必须是字符串。 */
function optionalString(
  record: Record<string, unknown>,
  key: string,
  base: string,
): ManifestSchemaIssue | null {
  if (!has(record, key) || record[key] === null) return null;
  if (typeof record[key] !== "string") {
    const path = base ? keyPath(base, key) : key;
    return error(path, `必须是字符串，当前为 ${typeName(record[key])}`);
  }
  return null;
}

/** `Option<u32>` 字段：缺失或 null 都合法，出现时必须是 0..2^32-1 的整数。 */
function optionalU32(
  record: Record<string, unknown>,
  key: string,
  base: string,
): ManifestSchemaIssue | null {
  if (!has(record, key) || record[key] === null) return null;
  const value = record[key];
  const path = base ? keyPath(base, key) : key;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_U32) {
    return error(path, `必须是 0..${MAX_U32} 的整数（u32），当前为 ${typeName(value)}`);
  }
  return null;
}

function inspectManifestItem(item: Record<string, unknown>): ManifestSchemaIssue[] {
  const issues: ManifestSchemaIssue[] = [];

  for (const key of ["id", "restype", "name", "description", "icon", "cover"]) {
    const issue = requiredString(item, key, "item");
    if (issue) issues.push(issue);
  }

  if (has(item, "restype") && typeof item.restype === "string") {
    if (!(RESOURCE_TYPES as readonly string[]).includes(item.restype)) {
      issues.push(
        error(
          "item.restype",
          `「${item.restype}」不是合法资源类型（${RESOURCE_TYPES.join(" / ")}），AstroBox 会整份解析失败`,
        ),
      );
    }
  }

  // paid_type 是 Option<PaidTypeV2>：缺省或 null 合法；出现时必须是枚举值。
  if (has(item, "paid_type") && item.paid_type !== null) {
    const value = item.paid_type;
    if (typeof value !== "string") {
      issues.push(
        error("item.paid_type", `必须是字符串枚举，当前为 ${typeName(value)}`),
      );
    } else if (!(PAID_TYPES as readonly string[]).includes(value)) {
      issues.push(
        error(
          "item.paid_type",
          value === "free"
            ? '免费资源应写空字符串 ""，写 "free" 会让整份 manifest 解析失败'
            : `「${value}」不是合法付费类型（"" / paid / force_paid）`,
        ),
      );
    }
  }

  // preview: Vec<String>，缺键、null、非数组、元素非字符串都会让整份解析失败。
  if (!has(item, "preview")) {
    issues.push(error("item.preview", "缺少必填字段，AstroBox 会整份解析失败"));
  } else if (!Array.isArray(item.preview)) {
    issues.push(
      error("item.preview", `必须是字符串数组，当前为 ${typeName(item.preview)}`),
    );
  } else {
    item.preview.forEach((entry, index) => {
      if (typeof entry !== "string") {
        issues.push(
          error(`item.preview[${index}]`, `必须是字符串，当前为 ${typeName(entry)}`),
        );
      }
    });
  }

  if (!has(item, "author")) {
    issues.push(error("item.author", "缺少必填字段，AstroBox 会整份解析失败"));
  } else if (!Array.isArray(item.author)) {
    issues.push(
      error("item.author", `必须是数组，当前为 ${typeName(item.author)}`),
    );
  } else {
    item.author.forEach((author, index) => {
      const base = `item.author[${index}]`;
      if (!isRecord(author)) {
        issues.push(error(base, `必须是对象，当前为 ${typeName(author)}`));
        return;
      }
      const nameIssue = requiredString(author, "name", base);
      if (nameIssue) issues.push(nameIssue);
      // bindABAccount 是 bool + serde(default)：缺省合法，但 null 不合法。
      if (has(author, "bindABAccount")) {
        if (typeof author.bindABAccount !== "boolean") {
          issues.push(
            error(
              keyPath(base, "bindABAccount"),
              `必须是布尔值，当前为 ${typeName(author.bindABAccount)}`,
            ),
          );
        }
      }
    });
  }

  return issues;
}

function inspectLinks(links: unknown[]): ManifestSchemaIssue[] {
  const issues: ManifestSchemaIssue[] = [];
  links.forEach((link, index) => {
    const base = `links[${index}]`;
    if (!isRecord(link)) {
      issues.push(error(base, `必须是对象，当前为 ${typeName(link)}`));
      return;
    }
    const titleIssue = requiredString(link, "title", base);
    if (titleIssue) issues.push(titleIssue);
    const urlIssue = requiredString(link, "url", base);
    if (urlIssue) issues.push(urlIssue);
    const iconIssue = optionalString(link, "icon", base);
    if (iconIssue) issues.push(iconIssue);
  });
  return issues;
}

/**
 * manifest 顶层与 `item`、`links` 的结构检查。
 * 这些字段任何一处不合法，AstroBox 都会整份解析失败。
 */
export function inspectManifestStructure(manifest: unknown): ManifestSchemaIssue[] {
  if (!isRecord(manifest)) {
    return [error("", `manifest 根节点必须是 JSON 对象，当前为 ${typeName(manifest)}`)];
  }

  const issues: ManifestSchemaIssue[] = [];

  // ManifestV2 没有容器级 serde(default)，四个顶层键必须真实存在。
  if (!has(manifest, "item")) {
    issues.push(error("item", "缺少顶层字段，AstroBox 会整份解析失败"));
  } else if (!isRecord(manifest.item)) {
    issues.push(error("item", `必须是对象，当前为 ${typeName(manifest.item)}`));
  } else {
    issues.push(...inspectManifestItem(manifest.item));
  }

  if (!has(manifest, "links")) {
    issues.push(error("links", "缺少顶层字段，AstroBox 会整份解析失败"));
  } else if (!Array.isArray(manifest.links)) {
    issues.push(error("links", `必须是数组，当前为 ${typeName(manifest.links)}`));
  } else {
    issues.push(...inspectLinks(manifest.links));
  }

  if (!has(manifest, "downloads")) {
    issues.push(error("downloads", "缺少顶层字段，AstroBox 会整份解析失败"));
  } else if (!isRecord(manifest.downloads)) {
    issues.push(
      error("downloads", `必须是对象（设备 → 下载项），当前为 ${typeName(manifest.downloads)}`),
    );
  }

  if (!has(manifest, "ext")) {
    issues.push(error("ext", "缺少顶层字段，AstroBox 会整份解析失败"));
  }

  return issues;
}

function inspectDownloadEntry(
  entry: Record<string, unknown>,
  base: string,
): ManifestSchemaIssue[] {
  const issues: ManifestSchemaIssue[] = [];

  const versionIssue = requiredString(entry, "version", base);
  if (versionIssue) issues.push(versionIssue);
  const fileNameIssue = requiredString(entry, "file_name", base);
  if (fileNameIssue) issues.push(fileNameIssue);

  // versionCode 是 Option<u64>，同时支持 version_code 别名；两个键同时出现 serde 会报重复字段。
  const hasCamel =
    has(entry, "versionCode") && entry.versionCode !== null;
  const hasSnake =
    has(entry, "version_code") && entry.version_code !== null;
  if (hasCamel && hasSnake) {
    issues.push(
      error(
        base,
        "同时出现 versionCode 与 version_code，AstroBox 会报重复字段导致整份解析失败",
      ),
    );
  }
  const codeValue = hasCamel
    ? entry.versionCode
    : hasSnake
      ? entry.version_code
      : undefined;
  if (codeValue !== undefined) {
    const path = `${base}.versionCode`;
    if (
      typeof codeValue !== "number" ||
      !Number.isInteger(codeValue) ||
      codeValue < 0
    ) {
      issues.push(
        error(
          path,
          `必须是大于等于 0 的整数，当前为 ${typeName(codeValue)}；写成字符串或小数会让整份 manifest 解析失败`,
        ),
      );
    } else if (codeValue > MAX_SAFE_INTEGER) {
      issues.push(
        warning(
          path,
          "超过 JavaScript 安全整数，审核侧读到的数值可能与客户端不一致",
        ),
      );
    }
  }

  for (const key of ["url", "sha256", "display_name"]) {
    const issue = optionalString(entry, key, base);
    if (issue) issues.push(issue);
  }

  // updatelogs: Option<Vec<{version, content}>>，任一元素缺字段都会让整份解析失败。
  if (has(entry, "updatelogs") && entry.updatelogs !== null) {
    const logs = entry.updatelogs;
    if (!Array.isArray(logs)) {
      issues.push(
        error(`${base}.updatelogs`, `必须是数组，当前为 ${typeName(logs)}`),
      );
    } else {
      logs.forEach((log, index) => {
        const logBase = `${base}.updatelogs[${index}]`;
        if (!isRecord(log)) {
          issues.push(error(logBase, `必须是对象，当前为 ${typeName(log)}`));
          return;
        }
        for (const key of ["version", "content"]) {
          const issue = requiredString(log, key, logBase);
          if (issue) issues.push(issue);
        }
      });
    }
  }

  // canopus: Option<ManifestCanopusV2>，abi 必填 u32，targets 必须是字符串数组。
  if (has(entry, "canopus") && entry.canopus !== null) {
    const canopus = entry.canopus;
    const canopusBase = `${base}.canopus`;
    if (!isRecord(canopus)) {
      issues.push(
        error(canopusBase, `必须是对象，当前为 ${typeName(canopus)}`),
      );
    } else {
      if (!has(canopus, "abi")) {
        issues.push(
          error(`${canopusBase}.abi`, "缺少必填字段，AstroBox 会整份解析失败"),
        );
      } else {
        const abi = canopus.abi;
        if (
          typeof abi !== "number" ||
          !Number.isInteger(abi) ||
          abi < 0 ||
          abi > MAX_U32
        ) {
          issues.push(
            error(
              `${canopusBase}.abi`,
              `必须是 0..${MAX_U32} 的整数（u32），当前为 ${typeName(abi)}`,
            ),
          );
        }
      }
      // targets 是 Vec<String> + serde(default)：缺省合法，但 null 不合法。
      if (has(canopus, "targets")) {
        const targets = canopus.targets;
        if (!Array.isArray(targets)) {
          issues.push(
            error(
              `${canopusBase}.targets`,
              `必须是字符串数组，当前为 ${typeName(targets)}`,
            ),
          );
        } else {
          targets.forEach((target, index) => {
            if (typeof target !== "string") {
              issues.push(
                error(
                  `${canopusBase}.targets[${index}]`,
                  `必须是字符串，当前为 ${typeName(target)}`,
                ),
              );
            }
          });
        }
      }
      const minFrameworkIssue = optionalU32(
        canopus,
        "minFramework",
        canopusBase,
      );
      if (minFrameworkIssue) issues.push(minFrameworkIssue);
    }
  }

  return issues;
}

/**
 * `downloads` 与 `ext.trialDownloads` 的逐条结构检查。
 *
 * 正式下载解析失败会让整份 manifest 失败；试用下载则是下载时才按
 * `HashMap<String, ManifestDownloadV2>` 严格解析，任一 entry 非法都会让试用下载整体失败。
 */
export function inspectDownloadsStructure(
  manifest: unknown,
): ManifestSchemaIssue[] {
  if (!isRecord(manifest)) return [];
  const issues: ManifestSchemaIssue[] = [];

  if (isRecord(manifest.downloads)) {
    for (const [device, entry] of Object.entries(manifest.downloads)) {
      const base = keyPath("downloads", device);
      if (!isRecord(entry)) {
        issues.push(error(base, `必须是对象，当前为 ${typeName(entry)}`));
        continue;
      }
      issues.push(...inspectDownloadEntry(entry, base));
    }
  }

  const ext = manifest.ext;
  if (isRecord(ext) && has(ext, "trialDownloads")) {
    const trial = ext.trialDownloads;
    if (trial === null || !isRecord(trial)) {
      issues.push(
        error(
          "ext.trialDownloads",
          `必须是对象，当前为 ${typeName(trial)}；AstroBox 解析试用下载时会整体失败`,
        ),
      );
    } else {
      for (const [device, entry] of Object.entries(trial)) {
        const base = keyPath("ext.trialDownloads", device);
        if (!isRecord(entry)) {
          issues.push(error(base, `必须是对象，当前为 ${typeName(entry)}`));
          continue;
        }
        issues.push(...inspectDownloadEntry(entry, base));
      }
    }
  }

  return issues;
}

/**
 * `ext.bundledResources` 结构检查。
 *
 * AstroBox 用 `serde_json::from_value(...).ok()` 解析，任一字段非法都会**静默丢弃整段声明**，
 * 不会报错。因此这里单独检查，避免作者以为配置生效、实际客户端什么都没装。
 */
export function inspectBundledResourcesStructure(
  ext: unknown,
): ManifestSchemaIssue[] {
  if (!isRecord(ext) || !has(ext, "bundledResources")) return [];
  const value = ext.bundledResources;
  if (value === null) {
    return [
      warning(
        "ext.bundledResources",
        "值为 null，AstroBox 会忽略整段声明",
      ),
    ];
  }
  if (!isRecord(value)) {
    return [
      error(
        "ext.bundledResources",
        `必须是对象，当前为 ${typeName(value)}；AstroBox 会忽略整段声明`,
      ),
    ];
  }

  const issues: ManifestSchemaIssue[] = [];
  for (const group of ["required", "recommended"] as const) {
    if (!has(value, group)) continue;
    const list = value[group];
    if (list === null || !Array.isArray(list)) {
      issues.push(
        error(
          `ext.bundledResources.${group}`,
          `必须是数组，当前为 ${typeName(list)}；AstroBox 会忽略整段声明`,
        ),
      );
      continue;
    }
    list.forEach((item, index) => {
      const base = `ext.bundledResources.${group}[${index}]`;
      if (!isRecord(item)) {
        issues.push(error(base, `必须是对象，当前为 ${typeName(item)}`));
        return;
      }
      if (!has(item, "type")) {
        issues.push(
          error(`${base}.type`, "缺少 type，AstroBox 会忽略整段声明"),
        );
      } else if (typeof item.type !== "string") {
        issues.push(
          error(
            `${base}.type`,
            `必须是字符串，当前为 ${typeName(item.type)}`,
          ),
        );
      } else if (!(BUNDLED_TYPES as readonly string[]).includes(item.type)) {
        issues.push(
          error(
            `${base}.type`,
            `「${item.type}」不是合法类型（resource / plugin），AstroBox 会忽略整段声明`,
          ),
        );
      }
      if (!has(item, "id")) {
        issues.push(
          error(`${base}.id`, "缺少 id，AstroBox 会忽略整段声明"),
        );
      } else if (typeof item.id !== "string") {
        issues.push(
          error(`${base}.id`, `必须是字符串，当前为 ${typeName(item.id)}`),
        );
      }
      if (has(item, "provider") && item.provider !== null) {
        if (typeof item.provider !== "string") {
          issues.push(
            error(
              `${base}.provider`,
              `必须是字符串，当前为 ${typeName(item.provider)}；AstroBox 会忽略整段声明`,
            ),
          );
        }
      }
    });
  }
  return issues;
}

/**
 * 运行期硬约束：不影响详情页打开，但会让下载/安装/更新失败。
 * 见 `officialv2.rs` 的 `resolve_canopus_download_entry` 与 `res_pack.rs`。
 */
export function inspectRuntimeConstraints(
  manifest: unknown,
): ManifestSchemaIssue[] {
  if (!isRecord(manifest)) return [];
  const item = manifest.item;
  const restype =
    isRecord(item) && typeof item.restype === "string" ? item.restype : "";
  if (restype !== "canopus" && restype !== "res_pack") return [];
  if (!isRecord(manifest.downloads)) return [];

  const issues: ManifestSchemaIssue[] = [];
  const packageOptional = canOmitDownloadPackage(manifest.ext);
  for (const [device, rawEntry] of Object.entries(manifest.downloads)) {
    if (!isRecord(rawEntry)) continue;
    // 插件完整接管的元数据条目没有包体，不适用宿主的包体安装约束。
    if (packageOptional && rawEntry.file_name === "") continue;
    const base = keyPath("downloads", device);

    if (restype === "canopus") {
      const fileName = rawEntry.file_name;
      if (typeof fileName === "string" && !fileName.toLowerCase().endsWith(".canopus")) {
        issues.push(
          error(
            `${base}.file_name`,
            `模块下载必须是 .canopus 包，当前为「${fileName}」`,
          ),
        );
      }
      const code = rawEntry.versionCode ?? rawEntry.version_code;
      if (typeof code === "number" && Number.isInteger(code) && code > MAX_U32) {
        issues.push(
          error(
            `${base}.versionCode`,
            `超过 u32 上限 ${MAX_U32}，AstroBox 会拒绝该模块`,
          ),
        );
      }
    }

    if (restype === "res_pack") {
      const code = rawEntry.versionCode ?? rawEntry.version_code;
      if (
        typeof code === "number" &&
        Number.isInteger(code) &&
        code > MAX_SAFE_INTEGER
      ) {
        issues.push(
          error(
            `${base}.versionCode`,
            `超过 JavaScript 安全整数上限 ${MAX_SAFE_INTEGER}，AstroBox 会拒绝该资源包`,
          ),
        );
      }
    }
  }
  return issues;
}

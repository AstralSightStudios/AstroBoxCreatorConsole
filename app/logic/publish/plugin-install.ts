/**
 * 让插件接管「下载/安装」按钮（manifest `ext.pluginInstall`）。
 *
 * 作者声明后，用户点资源页的下载/安装按钮时，AstroBox 不再走常规下载，而是调用这个插件
 * （Level 4 插件导出的 `resource-install.on-install`），把资源、目标设备和作者写的 `data` 交给它。
 * 插件可以自己把安装任务入队、让用户先去插件页核销（兑换码、卡密、授权……）、交还给宿主走
 * 常规下载，或报告失败。
 *
 * ```json
 * "ext": { "pluginInstall": { "plugin": "my-plugin", "data": { "sku": "abc" }, "fallback": "block" } }
 * ```
 *
 * 客户端的解析规则见 AstroBox-NG `web/src/logic/resourcePluginInstall.ts`，这里的校验要与它保持一致：
 * 插件名按「合法的插件目录名」校验，`data` 必须是合法 JSON 且不超过 16 KiB（UTF-8 字节），
 * 写得不对的声明客户端会整体忽略，等于没写。
 */

export type PluginInstallFallback = "block" | "download";

export const PLUGIN_INSTALL_FALLBACKS: readonly PluginInstallFallback[] = ["block", "download"];

export const PLUGIN_INSTALL_FALLBACK_LABELS: Record<PluginInstallFallback, string> = {
  block: "提示用户并停下",
  download: "退回常规下载",
};

/** 与客户端、宿主一致：`data` 序列化后的 UTF-8 字节数上限。 */
export const PLUGIN_INSTALL_DATA_MAX_BYTES = 16 * 1024;

/** 与客户端一致：插件名按 Unicode 码点最多这么多。 */
export const PLUGIN_INSTALL_NAME_MAX_CHARS = 128;

export interface PluginInstallValue {
  plugin: string;
  fallback: PluginInstallFallback;
  /** `data` 的 JSON 文本（表单里编辑用）；留空表示不带数据。 */
  dataText: string;
}

export interface PluginInstallInspection {
  /** ext 里有没有 pluginInstall 这个键。 */
  present: boolean;
  plugin: string;
  fallback: PluginInstallFallback;
  /** `data` 序列化后的 UTF-8 字节数；没写 data 为 0。 */
  dataBytes: number;
  /** 写法本身有误、客户端一定会忽略整个声明的问题：发布前必须改掉。 */
  problems: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const codePointLength = (value: string) => Array.from(value).length;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** 与宿主校验插件目录名的规则一致：不能是 `.` / `..`，不能含路径分隔符、冒号、控制字符，不能以点结尾。 */
export function isValidPluginName(name: string): boolean {
  if (!name || name !== name.trim() || codePointLength(name) > PLUGIN_INSTALL_NAME_MAX_CHARS) return false;
  if (name === "." || name === ".." || name.endsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\:\u0000-\u001f]/.test(name);
}

/** 检查 `ext.pluginInstall` 的写法是否会被客户端接受。 */
export function inspectPluginInstall(ext: unknown): PluginInstallInspection {
  const raw = isRecord(ext) ? ext.pluginInstall : undefined;
  const result: PluginInstallInspection = {
    present: isRecord(ext) && "pluginInstall" in ext,
    plugin: "",
    fallback: "block",
    dataBytes: 0,
    problems: [],
  };
  if (!result.present) return result;
  if (!isRecord(raw)) {
    result.problems.push("pluginInstall 需要是一个对象");
    return result;
  }

  if (typeof raw.plugin !== "string" || !raw.plugin.trim()) {
    result.problems.push("必须填写插件名（plugin），否则客户端会忽略整个声明");
  } else {
    result.plugin = raw.plugin.trim();
    if (raw.plugin !== result.plugin) {
      result.problems.push("插件名首尾不能有空格");
    } else if (!isValidPluginName(result.plugin)) {
      result.problems.push(
        `插件名不合法：不能含 / \\ : 或控制字符，不能是 . 或 .. ，不能以点结尾，最多 ${PLUGIN_INSTALL_NAME_MAX_CHARS} 个字`,
      );
    }
  }

  if (raw.fallback !== undefined) {
    if (typeof raw.fallback !== "string" || !(PLUGIN_INSTALL_FALLBACKS as readonly string[]).includes(raw.fallback)) {
      result.problems.push('fallback 只能是 "block"（提示用户并停下）或 "download"（退回常规下载）');
    } else {
      result.fallback = raw.fallback as PluginInstallFallback;
    }
  }

  if (raw.data !== undefined) {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(raw.data);
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) {
      result.problems.push("data 无法序列化为 JSON");
    } else {
      result.dataBytes = utf8Length(serialized);
      if (result.dataBytes > PLUGIN_INSTALL_DATA_MAX_BYTES) {
        result.problems.push(
          `data 序列化后 ${result.dataBytes} 字节，超过 ${PLUGIN_INSTALL_DATA_MAX_BYTES} 字节（16 KiB）上限，客户端会忽略整个声明`,
        );
      }
    }
  }
  return result;
}

function parseExtObject(extRaw: string): Record<string, unknown> | null {
  const trimmed = extRaw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 把表单里编辑的 `data` 文本解析成值；留空表示不带数据。 */
export function parsePluginInstallData(
  dataText: string,
): { ok: true; empty: true } | { ok: true; empty: false; value: unknown } | { ok: false; error: string } {
  const trimmed = dataText.trim();
  if (!trimmed) return { ok: true, empty: true };
  try {
    return { ok: true, empty: false, value: JSON.parse(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "不是合法的 JSON" };
  }
}

/** 从表单的 ext JSON 文本里读出设置；没设置或 JSON 不合法返回 null。 */
export function readPluginInstall(extRaw: string): PluginInstallValue | null {
  const ext = parseExtObject(extRaw);
  if (!ext || !isRecord(ext.pluginInstall)) return null;
  const raw = ext.pluginInstall;
  let dataText = "";
  if (raw.data !== undefined) {
    try {
      dataText = JSON.stringify(raw.data, null, 2) ?? "";
    } catch {
      dataText = "";
    }
  }
  return {
    plugin: typeof raw.plugin === "string" ? raw.plugin : "",
    fallback: (PLUGIN_INSTALL_FALLBACKS as readonly string[]).includes(String(raw.fallback))
      ? (raw.fallback as PluginInstallFallback)
      : "block",
    dataText,
  };
}

/**
 * 把设置写回 ext JSON 文本，其它键原样保留；传 null 删除。
 * ext 文本本身不是合法 JSON 对象时不动它（交给表单自己的 JSON 报错），原样返回；
 * `dataText` 不是合法 JSON 时 `data` 保持原样（由界面上的草稿提示错误），不会把半截 JSON 写进去。
 */
export function writePluginInstall(extRaw: string, value: PluginInstallValue | null): string {
  const ext = parseExtObject(extRaw);
  if (!ext) return extRaw;
  const next = { ...ext };
  if (value === null) {
    delete next.pluginInstall;
  } else {
    const previous = isRecord(ext.pluginInstall) ? ext.pluginInstall : {};
    const data = parsePluginInstallData(value.dataText);
    next.pluginInstall = {
      plugin: value.plugin.trim(),
      ...(value.fallback === "download" ? { fallback: "download" } : {}),
      ...(data.ok ? (data.empty ? {} : { data: data.value }) : previous.data !== undefined ? { data: previous.data } : {}),
    };
  }
  return Object.keys(next).length === 0 ? "{}" : JSON.stringify(next, null, 2);
}

/** 只有 Level 4 的插件才能导出 `resource-install`；Level 2/3 的插件客户端会判为「不支持」。 */
export const PLUGIN_INSTALL_MIN_API_LEVEL = 4;

/** 插件市场索引里与本校验有关的那部分（`NgPluginIndexEntry` 的子集）。 */
export interface PluginInstallMarketEntry {
  manifest?: { name?: string; api_level?: number } | null;
}

export type PluginInstallMarketStatus =
  /** 索引没加载到，没法核对。 */
  | { state: "unknown" }
  /** 插件市场里没有这个名字：用户点按钮时没法一键安装。 */
  | { state: "missing" }
  /** 市场里的版本不是 Level 4：它实现不了安装处理。 */
  | { state: "outdated"; apiLevel: number }
  | { state: "ok"; apiLevel: number };

/** 核对声明里的插件在插件市场里是否存在、是否是 Level 4。 */
export function checkPluginInstallMarket(
  plugin: string,
  index: readonly PluginInstallMarketEntry[] | null | undefined,
): PluginInstallMarketStatus {
  if (!index) return { state: "unknown" };
  const name = plugin.trim();
  const entry = name ? index.find((candidate) => candidate.manifest?.name === name) : undefined;
  if (!entry) return { state: "missing" };
  const apiLevel = entry.manifest?.api_level;
  const level = typeof apiLevel === "number" && Number.isFinite(apiLevel) ? apiLevel : 0;
  return level >= PLUGIN_INSTALL_MIN_API_LEVEL ? { state: "ok", apiLevel: level } : { state: "outdated", apiLevel: level };
}

/** 把市场核对结果翻成给作者/审核看的一句话；`ok` 与 `unknown` 返回 null（没有要提醒的）。 */
export function describePluginInstallMarketIssue(
  plugin: string,
  status: PluginInstallMarketStatus,
): string | null {
  switch (status.state) {
    case "missing":
      return `插件市场里找不到名为「${plugin}」的插件，用户点下载时无法一键安装它`;
    case "outdated":
      return `插件「${plugin}」在市场里的版本是 API Level ${status.apiLevel}，Level ${PLUGIN_INSTALL_MIN_API_LEVEL} 以上才能实现资源安装处理，客户端会判为不支持`;
    default:
      return null;
  }
}

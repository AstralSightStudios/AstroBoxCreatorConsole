/**
 * 模块（canopus）资源要求的最低 Canopus 管理器版本（manifest `ext.canopusManager.minVersion`）。
 *
 * 每个模块都强制绑定安装 Canopus 管理器（表盘 `canopus_manager`）。作者可以声明模块至少需要
 * 哪个版本的管理器，设备上的管理器低于它时客户端会要求先更新管理器，不会装一个跑不起来的模块。
 * 不填表示不限制。
 *
 * 值是 `"x.y.z"`（如 "2.0.3"，补丁号可省略）或表盘 versionCode 整数；
 * 编码为 `主 << 16 | 次 << 8 | 补丁`，与管理器表盘的 versionCode 同一编码。
 * 写错的值客户端会按「不限」处理（静默失效），所以发布前在这里拦住。
 * 客户端的解析规则见 AstroBox-NG `web/src/logic/canopus/manager.ts`，两边必须保持一致。
 *
 * 与 `canopus.minFramework`（条目里的「最低 Supervisor 框架修订号」，手环固件侧）不是一回事，
 * 后者由 `.canopus` 包自动读取，作者不需要填。
 */

/** 只有「模块」类资源才会读这个字段。 */
export const CANOPUS_MODULE_RESTYPE = "canopus";

const VERSION_PATTERN = /^\s*v?(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?\s*$/;

/** "2.0.3" → 0x020003；整数原样；不合法返回 undefined。与客户端 `parseCanopusManagerVersion` 一致。 */
export function parseCanopusManagerVersion(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = VERSION_PATTERN.exec(value);
  if (!match) return undefined;
  const [major, minor, patch = 0] = match.slice(1).map((part) => Number(part ?? 0));
  if (minor > 0xff || patch > 0xff) return undefined;
  const code = major * 0x10000 + minor * 0x100 + patch;
  return code > 0 ? code : undefined;
}

export function formatCanopusManagerVersion(code: number): string {
  return `${Math.floor(code / 0x10000)}.${Math.floor(code / 0x100) % 0x100}.${code % 0x100}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface CanopusManagerInspection {
  /** ext 里有没有 canopusManager 这个键。 */
  present: boolean;
  /** 解析出的版本编码；没有或写错为 undefined。 */
  code: number | undefined;
  /** 写法有误、客户端一定会忽略的问题：发布前必须改掉。 */
  problems: string[];
  /** 不影响发布、但声明不会生效的情况（例如不是模块类资源）。 */
  warnings: string[];
}

/** 检查 `ext.canopusManager` 的写法是否会被客户端接受。 */
export function inspectCanopusManager(ext: unknown, resourceType?: string): CanopusManagerInspection {
  const result: CanopusManagerInspection = {
    present: isRecord(ext) && "canopusManager" in ext,
    code: undefined,
    problems: [],
    warnings: [],
  };
  if (!result.present) return result;
  const declared = (ext as Record<string, unknown>).canopusManager;
  if (!isRecord(declared)) {
    result.problems.push("canopusManager 需要是一个对象，例如 { \"minVersion\": \"2.0.3\" }");
    return result;
  }
  if (declared.minVersion === undefined || declared.minVersion === null || declared.minVersion === "") {
    result.problems.push("canopusManager 里没有填写 minVersion，不会生效；不需要限制请删除整个 canopusManager");
    return result;
  }
  result.code = parseCanopusManagerVersion(declared.minVersion);
  if (result.code === undefined) {
    result.problems.push(
      `minVersion "${String(declared.minVersion)}" 格式不对，应写成 x.y.z（如 2.0.3，次版本与补丁号不超过 255）或大于 0 的整数 versionCode`,
    );
  }
  if (resourceType !== undefined && resourceType !== CANOPUS_MODULE_RESTYPE) {
    result.warnings.push("canopusManager 只对「模块」类资源生效，其它类型的资源会忽略它");
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

/**
 * 表单输入框里显示的最低管理器版本：字符串原样显示，整数 versionCode 显示成 x.y.z；没填返回空串。
 * ext 文本不是合法 JSON 对象或 canopusManager 结构不对也返回空串。
 */
export function readCanopusManagerMinVersion(extRaw: string): string {
  const ext = parseExtObject(extRaw);
  const declared = ext && isRecord(ext.canopusManager) ? ext.canopusManager : null;
  const value = declared?.minVersion;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? formatCanopusManagerVersion(value) : String(value);
  }
  return "";
}

/**
 * 把输入框里的最低管理器版本写回 ext JSON 文本，其它键（含 canopusManager 里的其它键）原样保留。
 * 输入为空则删除 minVersion，canopusManager 空了就整个删掉；输入的内容（哪怕还没写完）原样写入，
 * 不合法的值由校验拦截发布。ext 文本本身不是合法 JSON 对象时不动它，原样返回。
 */
export function writeCanopusManagerMinVersion(extRaw: string, input: string): string {
  const ext = parseExtObject(extRaw);
  if (!ext) return extRaw;
  const next = { ...ext };
  const rest = isRecord(next.canopusManager) ? { ...next.canopusManager } : {};
  const value = input.trim();
  if (value) {
    rest.minVersion = value;
    next.canopusManager = rest;
  } else {
    delete rest.minVersion;
    if (Object.keys(rest).length > 0) next.canopusManager = rest;
    else delete next.canopusManager;
  }
  return Object.keys(next).length === 0 ? "{}" : JSON.stringify(next, null, 2);
}

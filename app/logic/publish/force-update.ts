/**
 * 资源强制更新（manifest `ext.forceUpdate`）。
 *
 * 作者声明「这个版本需要强制更新」后，AstroBox 客户端在设备连接、检查到该版本的更新时：
 * - `prompt`：专门为这个资源弹一个可忽略的窗，写明理由，并给一个直接入队更新的按钮；
 * - `silent`：不提醒用户，直接把更新加进队列下载并安装。
 *
 * 声明必须绑定版本（`version` 与某个下载项的版本号一致，或 `versionCode`），
 * 这样作者发布下一版后忘了删，旧声明也不会跟到新版本上。客户端的解析规则见
 * AstroBox-NG `web/src/logic/resourceForceUpdate.ts`，这里的校验要与它保持一致。
 */

export type ForceUpdateStrategy = "prompt" | "silent";

export const FORCE_UPDATE_STRATEGIES: readonly ForceUpdateStrategy[] = ["prompt", "silent"];

/** 与客户端一致：理由按 Unicode 码点最多显示这么多。 */
export const FORCE_UPDATE_REASON_MAX = 500;

export const FORCE_UPDATE_STRATEGY_LABELS: Record<ForceUpdateStrategy, string> = {
  prompt: "弹窗提示（可忽略）",
  silent: "静默更新（不提醒）",
};

export interface ForceUpdateValue {
  version: string;
  strategy: ForceUpdateStrategy;
  reason: string;
}

export interface DownloadVersionRef {
  version?: unknown;
  versionCode?: unknown;
}

export interface ForceUpdateInspection {
  /** ext 里有没有 forceUpdate 这个键。 */
  present: boolean;
  strategy: ForceUpdateStrategy | null;
  version: string;
  versionCode: number | null;
  reason: string;
  /** 写法本身有误、客户端一定会忽略的问题：发布前必须改掉。 */
  problems: string[];
  /**
   * 绑定的版本与本次下载项对不上：声明不会生效，但这是「老资源发了新版、忘了删旧声明」的
   * 正常残留（客户端按版本绑定，不会误伤新版本），只提示不拦截。
   */
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const codePointLength = (value: string) => Array.from(value).length;

/**
 * 检查 `ext.forceUpdate` 的写法是否会被客户端接受。
 * @param downloads manifest.downloads 的各项（或表单里的下载行），用来核对声明绑定的版本真实存在。
 */
export function inspectForceUpdate(
  ext: unknown,
  downloads: readonly DownloadVersionRef[],
): ForceUpdateInspection {
  const raw = isRecord(ext) ? ext.forceUpdate : undefined;
  const result: ForceUpdateInspection = {
    present: isRecord(ext) && "forceUpdate" in ext,
    strategy: null,
    version: "",
    versionCode: null,
    reason: "",
    problems: [],
    warnings: [],
  };
  if (!result.present) return result;
  if (!isRecord(raw)) {
    result.problems.push("forceUpdate 需要是一个对象");
    return result;
  }

  const strategy = typeof raw.strategy === "string" ? raw.strategy.trim().toLowerCase() : "";
  if ((FORCE_UPDATE_STRATEGIES as readonly string[]).includes(strategy)) {
    result.strategy = strategy as ForceUpdateStrategy;
  } else {
    result.problems.push('strategy 只能是 "prompt"（弹窗提示）或 "silent"（静默更新）');
  }

  result.version = typeof raw.version === "string" ? raw.version.trim() : "";
  if (raw.versionCode !== undefined) {
    if (typeof raw.versionCode === "number" && Number.isInteger(raw.versionCode)) {
      result.versionCode = raw.versionCode;
    } else {
      result.problems.push("versionCode 需要是整数");
    }
  }
  if (!result.version && result.versionCode === null) {
    result.problems.push("必须填写 version（下载项的版本号）或 versionCode，否则不会生效");
  }

  const versions = new Set(
    downloads
      .map((entry) => (typeof entry.version === "string" ? entry.version.trim() : ""))
      .filter(Boolean),
  );
  const codes = new Set(
    downloads.map((entry) => entry.versionCode).filter((code): code is number => typeof code === "number"),
  );
  if (result.version && versions.size > 0 && !versions.has(result.version)) {
    result.warnings.push(`version "${result.version}" 与任何下载项的版本号都对不上，不会生效`);
  }
  if (result.versionCode !== null && codes.size > 0 && !codes.has(result.versionCode)) {
    result.warnings.push(`versionCode ${result.versionCode} 与任何下载项的 versionCode 都对不上，不会生效`);
  }

  if (raw.reason !== undefined) {
    if (typeof raw.reason !== "string") {
      result.problems.push("reason 需要是字符串");
    } else {
      result.reason = raw.reason;
      if (codePointLength(raw.reason.trim()) > FORCE_UPDATE_REASON_MAX) {
        result.problems.push(`reason 超过 ${FORCE_UPDATE_REASON_MAX} 字，客户端只会显示前 ${FORCE_UPDATE_REASON_MAX} 字`);
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

/** 从表单的 ext JSON 文本里读出强制更新设置；没设置或 JSON 不合法返回 null。 */
export function readForceUpdate(extRaw: string): ForceUpdateValue | null {
  const ext = parseExtObject(extRaw);
  if (!ext || !isRecord(ext.forceUpdate)) return null;
  const raw = ext.forceUpdate;
  const strategy = typeof raw.strategy === "string" ? raw.strategy.trim().toLowerCase() : "";
  return {
    version: typeof raw.version === "string" ? raw.version.trim() : "",
    strategy: (FORCE_UPDATE_STRATEGIES as readonly string[]).includes(strategy)
      ? (strategy as ForceUpdateStrategy)
      : "prompt",
    reason: typeof raw.reason === "string" ? raw.reason : "",
  };
}

/**
 * 把强制更新设置写回 ext JSON 文本，其它键原样保留；传 null 删除。
 * ext 文本本身不是合法 JSON 对象时不动它（交给表单自己的 JSON 报错），原样返回。
 */
export function writeForceUpdate(extRaw: string, value: ForceUpdateValue | null): string {
  const ext = parseExtObject(extRaw);
  if (!ext) return extRaw;
  const next = { ...ext };
  if (value === null) {
    delete next.forceUpdate;
  } else {
    const reason = value.strategy === "prompt" ? value.reason.trim() : "";
    next.forceUpdate = {
      version: value.version.trim(),
      strategy: value.strategy,
      // 静默更新不显示理由，不往 manifest 里写无用内容
      ...(reason ? { reason } : {}),
    };
  }
  return Object.keys(next).length === 0 ? "{}" : JSON.stringify(next, null, 2);
}

/** 表单下载行里出现过的版本号（去重、保持出现顺序），供「绑定哪个版本」选择。 */
export function collectDownloadVersions(downloads: readonly DownloadVersionRef[]): string[] {
  const seen = new Set<string>();
  for (const entry of downloads) {
    const version = typeof entry.version === "string" ? entry.version.trim() : "";
    if (version) seen.add(version);
  }
  return [...seen];
}

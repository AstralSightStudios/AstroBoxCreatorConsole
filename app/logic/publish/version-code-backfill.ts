/**
 * 编辑已有资源时，从仓库里的包体补齐历史 manifest 缺失的 versionCode。
 *
 * versionCode 是后加进 manifest 的字段：大量已上架资源的 downloads 里只有
 * `version`。直接编辑这类资源（哪怕只换一张预览图）时，下载行因为「已挂包体
 * 但没有 versionCode」会被拦在第二步之前，而版本列又是只读的——创作者只能
 * 重新导入一次包体，等于被逼着动包体。
 *
 * 这里在进入编辑页后按包体补齐：
 * - 小米表盘的 versionCode 由包体 offset 4..6 的 major.minor.patch 唯一派生，
 *   而 manifest 里的 version 也是发布时从同一处读出的，因此可以直接按 version
 *   计算，不必下载包体；
 * - 其余包体（rpk / CRPack / .canopus / vivo 表盘）的 versionCode 只存在包内
 *   清单里，交给调用方注入的 loadPackage 读取。
 *
 * 读不出来就保持缺失：未替换的旧包体不再强制填写，只有本次导入/替换的包体
 * 才要求 versionCode 非空（见 pre-publish-checks 的 rowUploadsPackage）。
 */
import type { DownloadInput } from "~/routes/resource/publish/components/types";
import {
  readPackageVersion,
  xiaomiVersionCodeFromVersion,
} from "./package-version";
import type { ResourceType } from "./resource-type";

/** 一条回填结果。`uid` 对应下载行，应用时会再次核对行是否已被替换。 */
export interface VersionCodeBackfill {
  uid: string;
  /** 读取时的包体路径，用来确认读取期间包体没有被换掉。 */
  fileName: string;
  version?: string;
  versionCode: number;
  /**
   * 目录直编时的已发布基线。PR 编辑不写：PR 分支上的包体未必是线上版本，
   * 拿来当递增基线会误拦。
   */
  previousVersionCode?: number;
}

/** 仓库里已有包体的路径；本地新上传的行没有值。 */
function existingPackagePath(row: DownloadInput): string {
  return (row.file?.pathOverride || row.existingFileName || "").trim();
}

/**
 * 小米表盘 versionCode 是否可由 manifest 的 version 唯一确定。
 *
 * 仅限小米表盘：小米 `.bin` / `.mwz` 把 major.minor.patch 直接写在包体里，
 * versionCode 就是这三个字节的拼接；vivo 表盘 rpk 的 version 与 versionCode
 * 各自独立，套用这个公式会算出错误的值。
 */
export function deriveXiaomiWatchfaceVersionCode(
  row: DownloadInput,
  params: { resourceType: ResourceType; vendor?: string },
): number | undefined {
  if (params.resourceType !== "watchface") return undefined;
  if ((params.vendor ?? "").trim().toLowerCase() !== "xiaomi") return undefined;
  return xiaomiVersionCodeFromVersion(row.version);
}

function toBackfill(
  row: DownloadInput,
  fileName: string,
  info: { version?: string; versionCode: number },
  catalogMode: boolean,
): VersionCodeBackfill {
  return {
    uid: row.uid,
    fileName,
    ...(info.version ? { version: info.version } : {}),
    versionCode: info.versionCode,
    ...(catalogMode ? { previousVersionCode: info.versionCode } : {}),
  };
}

/**
 * 收集需要回填的行。单次编辑内按包体路径去重：多台设备共用同一份包体时
 * 只读取一次。单行读取失败交给 `onError` 记录后跳过，不影响其他行。
 */
export async function collectVersionCodeBackfills(params: {
  rows: readonly DownloadInput[];
  loadPackage: (row: DownloadInput) => Promise<File>;
  /** 目录直编时把读到的值同时写成递增基线。 */
  catalogMode: boolean;
  /** 无需读取包体即可确定的值；返回 undefined 时回退到读取包体。 */
  deriveVersionCode?: (row: DownloadInput) => number | undefined;
  onError?: (row: DownloadInput, error: unknown) => void;
}): Promise<VersionCodeBackfill[]> {
  const { rows, loadPackage, catalogMode, deriveVersionCode, onError } =
    params;
  // 只处理仍指向仓库旧文件的行；本次导入/替换的包体在导入时就读出版本了。
  const targets = rows.filter(
    (row) => Boolean(row.existingFileName?.trim()) && row.versionCode === undefined,
  );
  if (targets.length === 0) return [];

  const backfills: VersionCodeBackfill[] = [];
  const pending: DownloadInput[] = [];
  for (const row of targets) {
    const derived = deriveVersionCode?.(row);
    if (derived !== undefined) {
      backfills.push(
        toBackfill(
          row,
          existingPackagePath(row),
          { version: row.version, versionCode: derived },
          catalogMode,
        ),
      );
      continue;
    }
    pending.push(row);
  }

  const reads = new Map<
    string,
    Promise<{ version?: string; versionCode: number } | null>
  >();
  const readPath = (path: string, row: DownloadInput) => {
    let promise = reads.get(path);
    if (!promise) {
      promise = (async () => {
        try {
          const info = await readPackageVersion(await loadPackage(row));
          if (!info.readable || info.versionCode === undefined) return null;
          return { version: info.version, versionCode: info.versionCode };
        } catch (error) {
          onError?.(row, error);
          return null;
        }
      })();
      reads.set(path, promise);
    }
    return promise;
  };

  const loaded = await Promise.all(
    pending.map(async (row) => {
      const path = existingPackagePath(row);
      const info = await readPath(path, row);
      return info ? toBackfill(row, path, info, catalogMode) : null;
    }),
  );
  for (const item of loaded) {
    if (item) backfills.push(item);
  }
  return backfills;
}

/**
 * 把回填结果写回当前下载行。
 *
 * 读取是异步的：期间创作者可能已经替换包体、删掉该行或手填了版本号。
 * 因此只补「路径没变且仍为空」的行，绝不覆盖用户的新输入。
 */
export function applyVersionCodeBackfills(
  rows: DownloadInput[],
  backfills: readonly VersionCodeBackfill[],
): DownloadInput[] {
  if (backfills.length === 0) return rows;
  const byUid = new Map(backfills.map((item) => [item.uid, item]));
  let changed = false;
  const next = rows.map((row) => {
    const backfill = byUid.get(row.uid);
    if (!backfill) return row;
    if (row.versionCode !== undefined) return row;
    if (existingPackagePath(row) !== backfill.fileName) return row;
    changed = true;
    return {
      ...row,
      ...(!row.version.trim() && backfill.version
        ? { version: backfill.version }
        : {}),
      versionCode: backfill.versionCode,
      ...(backfill.previousVersionCode !== undefined
        ? { previousVersionCode: backfill.previousVersionCode }
        : {}),
    };
  });
  return changed ? next : rows;
}

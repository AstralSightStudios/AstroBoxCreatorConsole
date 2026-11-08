/**
 * 编辑已有资源时，从仓库里的包体补齐历史 manifest 缺失的 versionCode。
 *
 * versionCode 是后加进 manifest 的字段：大量已上架资源的 downloads 里只有
 * `version`。直接编辑这类资源（哪怕只换一张预览图）时，下载行因为「已挂包体
 * 但没有 versionCode」会被拦在第二步之前，而版本列又是只读的——创作者只能
 * 重新导入一次包体，等于被逼着动包体。
 *
 * 这里在进入编辑页后按包体补齐：versionCode 一律以**包体自身**为准，不能用
 * manifest 的 version 反推。存量资源里展示版本与包内版本不一致的例子并不少见
 * （例如 manifest 写 1.1.0、包体实际是 1.0.0），按 version 算出来的 versionCode
 * 会高于用户真正安装的版本，客户端会陷入「永远有更新」的循环。
 *
 * 读不出来就保持缺失：未替换的旧包体不再强制填写，只有本次导入/替换的包体
 * 才要求 versionCode 非空（见 pre-publish-checks 的 rowUploadsPackage）。
 */
import type { DownloadInput } from "~/routes/resource/publish/components/types";
import { readPackageVersion } from "./package-version";

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
  onError?: (row: DownloadInput, error: unknown) => void;
}): Promise<VersionCodeBackfill[]> {
  const { rows, loadPackage, catalogMode, onError } = params;
  // 只处理仍指向仓库旧文件的行；本次导入/替换的包体在导入时就读出版本了。
  const targets = rows.filter(
    (row) => Boolean(row.existingFileName?.trim()) && row.versionCode === undefined,
  );
  if (targets.length === 0) return [];

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

  const backfills: VersionCodeBackfill[] = [];
  const loaded = await Promise.all(
    targets.map(async (row) => {
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

/**
 * 判断下载行是否共用同一份包体，以及包体本次是否会重新上传。
 *
 * 一键填充会把模板行的 UploadItem 原样复制到其余行（同一对象、同一 id），
 * 发布时 `buildDownloadAssets` 也会按内容指纹让多行共用一条仓库路径。加密
 * 状态因此是整份包体的属性：同一个路径只会上传一份文件、服务端也只登记一份
 * 密钥，不能出现「同一包体有的设备加密、有的设备不加密」的状态。
 *
 * 这里只做行与行之间的判断，不依赖 React 或发布流程，便于单测。
 */

/** 与下载行结构兼容的最小形状（UploadItem / DownloadInput 都满足）。 */
export interface PackageSharingRow {
  uid: string;
  file?: {
    id?: string;
    file?: File;
    pathOverride?: string;
    skipUpload?: boolean;
  } | null;
  existingFileName?: string;
}

/** 包体在仓库里的落点：显式路径优先，其次是编辑模式沿用的旧文件路径。 */
export function packageSourcePath(row: PackageSharingRow): string | undefined {
  return row.file?.pathOverride || row.existingFileName || undefined;
}

/**
 * 两行是否共用同一份包体。
 *
 * 依次比对三类能证明「字节完全一致」的依据：
 * - 同一个 UploadItem 对象（一键填充直接复制引用）；
 * - 同一个 UploadItem.id / File 对象（草稿恢复、复制行会换对象但保留 id）；
 * - 同一个仓库落点（编辑模式下多设备复用 manifest 里的同一个 file_name）。
 *
 * 和 `manifest.ts` 的包体指纹一样，不按文件名/大小猜内容：同名不同包会被
 * 误判成一份，从而把加密状态错误地联动过去。
 */
export function rowsSharePackage(
  a: PackageSharingRow,
  b: PackageSharingRow,
): boolean {
  if (a.uid === b.uid) return true;
  if (a.file && b.file) {
    if (a.file === b.file) return true;
    if (a.file.id && b.file.id && a.file.id === b.file.id) return true;
    if (a.file.file && b.file.file && a.file.file === b.file.file) return true;
  }
  const aPath = packageSourcePath(a);
  const bPath = packageSourcePath(b);
  return Boolean(aPath && bPath && aPath === bPath);
}

/**
 * 该行的包体本次是否会被重新上传。
 *
 * 编辑模式沿用的仓库旧包带 `skipUpload`，发布时既不重传也无法在本次生成
 * 加密副本；此时开关应保持禁用，而不是清掉 existingFileName 后让开关看起来
 * 可用却不会生效。
 */
export function canTogglePackageEncryption(row: PackageSharingRow): boolean {
  return Boolean(row.file && !row.file.skipUpload);
}

/**
 * 包体导入。
 *
 * 导入阶段还要做两件事：读出包内的版本 / 包体标识 / canopus 元数据，以及在
 * 「包内 ID 与资源 ID 不一致」时就地改写包体（表盘 12 位 ID、CRPack themeId）。
 * 后者只有这两类资源需要，调用方因此可以传 `validate`，其余类型不传。
 *
 * **不传 `validate` 也必须自己读一遍包体**：版本号、包体 hash 与 canopus 元数据
 * 全来自这里。漏读的表现很隐蔽——行里文件有了、版本列也空着，直到下一步
 * `rowsWithoutCanopusMeta` 把这份刚从包里读得出来的 `.canopus` 判成无效模块包。
 */

import { readPackageVersion, type PackageVersionInfo } from "./package-version";

/** 包体导入结果。`file` 是真正要落库的那份。 */
export interface ImportedPackage {
  info: PackageVersionInfo;
  file: File;
}

/**
 * `validate` 由调用方按资源类型提供，返回它就代表「已读过包体、可能已改写」。
 * 返回值优先于默认读取，避免对同一份字节读两遍。
 */
export async function resolveImportedPackage(
  file: File,
  validate?: (file: File) => Promise<ImportedPackage>,
): Promise<ImportedPackage> {
  const validated = await validate?.(file);
  if (validated) return validated;
  return { info: await readPackageVersion(file), file };
}

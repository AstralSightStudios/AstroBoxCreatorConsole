import type { ResourceEditContext } from "./resources";

/** 推送新版本时可选的「清空资源评分 / 折叠既往的全部评论」。 */
export interface VersionResetOptions {
  resetRatings: boolean;
  foldComments: boolean;
}

export const DEFAULT_VERSION_RESET_OPTIONS: VersionResetOptions = {
  resetRatings: false,
  foldComments: false,
};

/**
 * 只有已上架资源的更新才有评分和评论可处理：从目录进入编辑的资源，
 * 或继续一个「修改已有资源」的 PR。新资源（含继续中的新建 PR）不提供。
 */
export function canOfferVersionReset(
  editContext: Pick<ResourceEditContext, "mode" | "submission"> | null | undefined,
): boolean {
  if (!editContext) return false;
  if (editContext.mode === "catalog") return true;
  return editContext.submission?.request?.mode === "edit";
}

export function hasVersionResetSelection(options: VersionResetOptions): boolean {
  return options.resetRatings || options.foldComments;
}

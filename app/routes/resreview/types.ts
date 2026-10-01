import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import type { ManifestUpdateLogEntry } from "~/logic/publish/manifest";
import type { SubmissionClientInfo } from "~/logic/publish/submission-protocol";

export const STATE_LABELS: Record<ReviewState, string> = {
  waiting_review: "等待审核",
  changes_requested: "需要修改",
  fixed_waiting: "已修复待复核",
};

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
export const CATALOG_CSV_HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

export type ReviewState = "waiting_review" | "changes_requested" | "fixed_waiting";

export interface ResourcePackagePreview {
  kind: "正式包" | "试用包";
  deviceId: string;
  version: string;
  fileName: string;
  url: string;
  versionCode?: number;
  updateLogs?: ManifestUpdateLogEntry[];
}

export interface PrResourcePreview {
  entry: CatalogEntry;
  baseEntry?: CatalogEntry;
  ref: string;
  /**
   * 本次提交顶替掉的原资源 ID。编辑允许改资源 ID，因此可能与 `entry.id` 不同；
   * 比例判定要靠它把原行摘掉，否则同一资源会既算免费又算付费。
   */
  originalId?: string;
  request?: {
    mode: "create" | "edit";
    originalId?: string | null;
    /** staging 提交 request.json 附带的提交客户端信息（历史提交可能缺失）。 */
    client?: SubmissionClientInfo | null;
  };
  predictedAction?: string;
  manifest?: ManifestV2;
  manifestError?: string;
  iconUrl: string;
  coverUrl: string;
  previewUrls: string[];
  packages: ResourcePackagePreview[];
}

export interface PullReviewState {
  state: ReviewState;
  items: { id: string; message: string; fixed: boolean }[];
}

/**
 * 检查项对应的「详情容器」锚点。检查清单只给结论，具体逐条明细由面板底部的
 * 结构化容器展示，因此有明细的检查项填上锚点，UI 在行右侧渲染跳转按钮。
 */
export type RuleCheckAnchorKind = "packages" | "paidRatio" | "images";

export interface RuleCheckItem {
  title: string;
  status: "pass" | "fail" | "warn" | "manual";
  detail: string;
  /** 详情容器锚点；缺省表示该项没有逐条明细，detail 本身已足够。 */
  anchor?: RuleCheckAnchorKind;
  /** images 锚点下具体高亮哪张图（icon / cover / preview 序号）。 */
  anchorLabel?: string;
}

export interface RepoFileChangeInfo {
  entryId: string;
  resourceName: string;
  isNew: boolean;
  owner: string;
  repo: string;
  commitHash: string;
  baseCommitHash?: string;
  manifest?: ManifestV2;
}

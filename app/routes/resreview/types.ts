import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import type { ManifestUpdateLogEntry } from "~/logic/publish/manifest";

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
  request?: {
    mode: "create" | "edit";
    originalId?: string | null;
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

export interface RuleCheckItem {
  title: string;
  status: "pass" | "fail" | "warn" | "manual";
  detail: string;
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

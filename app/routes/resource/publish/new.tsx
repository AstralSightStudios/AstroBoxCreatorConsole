import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Spinner,
  Text,
} from "~/components/ScaleAwareThemes";
import {
  FileXIcon,
  UploadIcon,
  PencilSimpleLineIcon,
  GitBranchIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { PUBLISH_CONFIG, buildRepoName } from "~/config/publish";
import { REPO_ENVS, useRepoEnvId } from "~/config/repoEnv";
import { log } from "~/logic/logging";
import { reportFailure, reportSuccess } from "~/logic/logging/feedback";
import {
  endResourceSession,
  flowSpan,
  logFieldChange,
  getActiveResourceSession,
  resumeResourceSession,
  usePublishFlowSession,
} from "~/logic/logging/publish-flow";
import type { WallpaperAssetFile, WallpaperConfigRaw } from "~/logic/wallpaper/types";
import {
  parseWallpaperEditorInitial,
  resolveWallpaperEditorInitial,
  saveWizardSession,
  takeWizardSession,
  type WizardSession,
} from "~/logic/wallpaper/wizard-session";
import {
  buildManifest,
  normalizeBundledResources,
  type ManifestBuildResult,
} from "~/logic/publish/manifest";
import {
  upsertManifestAndAssets,
  uploadManifestAndAssets,
  type RepoInfo,
} from "~/logic/publish/submission";
import {
  loadAccountState,
  useAccountState,
  useDisplayAccount,
} from "~/logic/account/store";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import { listSellerResourceFileKeys } from "~/api/astrobox/order";
import {
  createCatalogPullRequest,
  updateCatalogCsv,
  updateCatalogEntryOnBranch,
} from "~/logic/publish/catalog";
import {
  PendingSubmissionConflictError,
  createSubmissionBranch,
  createSubmissionPullRequest,
  updateSubmissionEntryOnBranch,
} from "~/logic/publish/staging-submission";
import {
  createPullRequestComment,
  reopenPullRequest,
  updatePullRequestTitle,
  waitForPullRequestOpen,
} from "~/api/github/pr-review";
import { renderCommentMarkdownInlineHtml } from "~/routes/resreview/utils/comment";
import Page from "~/layout/page";
import { StepList, SectionCard, type UploadItem } from "./components/shared";
import {
  AutoSaveRestoreDialog,
  DraftActions,
  UnboundAuthorNoticeDialog,
  UnpaidEncryptionWarningDialog,
  VersionCodeWarningDialog,
  VersionIncrementWarningDialog,
} from "./components/ComposerDialogs";
import {
  compressIconImage,
  compressImageFile,
  createExistingUploadItem,
  createImageUploadItem,
  createUploadItem,
  getImageDimensions,
  normalizeImageFile,
  partitionAllowedImages,
  revokeUrl,
} from "./components/uploadUtils";
import { inspectImageFile, type ImageMeta } from "~/logic/publish/image-meta";
import {
  type AuthorInput,
  type BundledResourceInput,
  type DeviceOption,
  type DownloadInput,
  type LinkInput,
  type UpdateLogEntry,
  type ValidatedPackage,
} from "./components/types";
import { loadDeviceOptions } from "~/logic/devices/catalog";
import {
  generateUniqueWatchfaceId,
  validateWatchfaceIdFormat,
  fetchExistingCatalogIds,
  replaceWatchfaceIdInPackage,
  WATCHFACE_ID_PREFIX,
} from "~/logic/publish/watchface-id";
import { validateCanopusIdFormat } from "~/logic/publish/canopus-id";
import {
  normalizeResPackIdInput,
  validateResPackIdFormat,
} from "~/logic/publish/res-pack-id";
import {
  readCrpackThemeId,
  rewriteCrpackCorona,
  validateCrpack,
} from "~/logic/publish/crpack-validate";
import { BasicInfoSection } from "./components/BasicInfoSection";
import {
  filterDeviceOptionsByResourceType,
  formatResourceType,
  isDeviceVendorSupportedByResourceType,
  isXiaomiOnlyResourceType,
  normalizeResourceType,
  type ResourceType,
} from "~/logic/publish/resource-type";
import { moveToSlot } from "~/logic/publish/update-log-draft";
import { MediaSection } from "./components/MediaSection";
import { AuthorsSection } from "./components/AuthorsSection";
import {
  unboundAuthorNotice,
  withBoundFirstAuthor,
} from "~/logic/publish/author-match";
import { LinksSection } from "./components/LinksSection";
import { DownloadsSection } from "./components/DownloadsSection";
import { ExtSection } from "./components/ExtSection";
import {
  RepoStepSection,
  formatOccupiedResourceLabel,
  type ExistingRepoOption,
} from "./components/RepoStepSection";
import { isAstroBoxResourceRepo } from "~/logic/publish/repo-options";
import {
  getRepoFile,
  isGithubStatus,
  listCurrentUserRepos,
} from "~/logic/publish/github-actions";
import { PrStepSection } from "./components/PrStepSection";
import {
  type ResourceEditContext,
  buildResourcePrTitle,
  canEditResourceIdentity,
  listedResourceIdOf,
  buildInProgressEditContextFromPr,
  resolveIdMigration,
  resolveIdentityLocks,
} from "~/logic/publish/resources";
import {
  registerIdMigrationIntent,
  registerVersionResetIntent,
} from "~/api/astrobox/resource";
import {
  DEFAULT_VERSION_RESET_OPTIONS,
  canOfferVersionReset,
  hasVersionResetSelection,
  type VersionResetOptions,
} from "~/logic/publish/version-reset";
import {
  encryptedDownloadDevices,
  resourceIdFormatError,
  validatePublish,
  validatePushQuality,
} from "~/logic/publish/validation";
import {
  checkUnpaidEncryption,
  type UnpaidEncryptionCheck,
} from "~/logic/publish/unpaid-encryption";
import {
  BANNED_IMAGE_NOTICE,
  COVER_COMPRESS_TARGET_BYTES,
  ICON_COMPRESS_TARGET_BYTES,
  ICON_MAX_DIMENSION,
  PREVIEW_COMPRESS_TARGET_BYTES,
  checkAnimatedPreview,
  checkCoverFileSize,
  checkCoverRatio,
  checkIconShape,
  checkImageFormat,
} from "~/logic/publish/pre-publish-checks";
import {
  flashFirstDownloadRow,
  flashPublishField,
  flashPublishIssue,
} from "~/logic/publish/scroll-highlight";
import {
  applyPublishedBaseline,
  rowsMissingVersionCode,
  rowsWithIdentityMismatch,
  rowsWithNonIncrementedVersionCode,
  rowsWithoutCanopusMeta,
} from "~/logic/publish/pre-publish-checks";
import { fetchPublishedBaselinesForResourceId } from "~/logic/publish/published-baseline";
import {
  computePackageHash,
  readPackageVersion,
} from "~/logic/publish/package-version";
import {
  buildRawFileUrl,
  fetchManifestForCatalogEntry,
  fetchWallpaperConfigForCatalogEntry,
  getWallpaperConfigUrl,
} from "~/logic/publish/manifest-loader";
import { syncBranchWithUpstream } from "~/logic/publish/fork";
import { normalizeLinkIconName } from "~/logic/publish/phosphor-link-icon";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import {
  listDrafts,
  saveDraft,
  deleteDraft,
  autoSaveDraft,
  loadAutoSavedDraft,
  clearAutoSavedDraft,
  type PublishDraft,
  type PublishDraftFormData,
  type DraftMediaItem,
} from "~/logic/publish/publish-drafts";
import {
  loadRemoteMediaItem,
  restoreDownloadInput,
  restoreMediaItem,
  restoreWallpaperAsset,
  serializeDownloadInputs,
  serializeMediaItem,
  serializeWallpaperAsset,
} from "~/logic/publish/draft-codec";
import {
  buildDownloadInputsFromManifest,
  collectCatalogDevices,
  extractCustomExt,
  isManifestExtObject,
  parseTagText,
} from "~/logic/publish/composer-utils";

/** 目标仓库已被软件索引里的资源占用；资源信息供错误提示渲染跳转链接。 */
class RepoOccupiedError extends Error {
  constructor(
    message: string,
    readonly resource: { id?: string; name?: string },
  ) {
    super(message);
    this.name = "RepoOccupiedError";
  }
}

async function findExistingResourceManifest(
  token: string,
  repoName: string,
): Promise<{
  file: string;
  id?: string;
  restype?: string;
  name?: string;
} | null> {
  const username = loadAccountState().github?.username;
  if (!username || !repoName) return null;
  for (const file of [PUBLISH_CONFIG.manifestFileName, "manifest.json"]) {
    let data: any = null;
    try {
      data = await getRepoFile({
        repo: {
          owner: username,
          name: repoName,
          branch: MAIN_RESOURCE_BRANCH,
        },
        path: file,
        tokenOverride: token,
        ref: MAIN_RESOURCE_BRANCH,
      });
    } catch (error) {
      if (!isGithubStatus(error, 404)) throw error;
      continue;
    }
    try {
      const raw = String(data?.content || "").replace(/\s+/g, "");
      const parsed = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
        ),
      );
      if (parsed && typeof parsed === "object") {
        return {
          file,
          id: typeof parsed.item?.id === "string" ? parsed.item.id : undefined,
          restype:
            typeof parsed.item?.restype === "string"
              ? parsed.item.restype
              : undefined,
          name:
            typeof parsed.item?.name === "string"
              ? parsed.item.name
              : undefined,
        };
      }
    } catch {
      return { file };
    }
  }
  return null;
}

const DEFAULT_DOWNLOADS: DownloadInput[] = [];

/**
 * 包体选择器的候选扩展名，按资源类型给出。只影响原生对话框的过滤列表，
 * 真实格式识别一律靠包体魔数（见 package-version.ts），选错格式会在导入时被拦下。
 * 除 res_pack 与 canopus 外沿用同一份列表，避免突然缩窄创作者已习惯的可选项。
 * canopus 资源必须能选中原生 `.canopus` 模块包：商店条目的 canopus 元数据只能
 * 从包内 manifest 读出，选不到该后缀就没法走通发布流程。
 */
const PACKAGE_ACCEPT: Record<ResourceType, string> = {
  quick_app: "zip,rpk,mwz,bin,face",
  watchface: "zip,rpk,mwz,bin,face",
  canopus: "canopus,zip,rpk,mwz,bin,face",
  res_pack: "crpack,zip,rpk,mwz,bin,face",
};

const REQUIRE_ASTROBOX_LOGIN = !import.meta.env.DEV;

function ResourceComposerPage({ mode = "new" }: { mode?: "new" | "edit" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const accountState = useAccountState();
  const displayAccount = useDisplayAccount();
  const isVip = hasCreatorPlusOrAbove(displayAccount.plan);
  const isEditMode = mode === "edit";
  const repoEnvId = useRepoEnvId();
  const [itemId, setItemId] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>(
    "quick_app",
  );
  const idsByTypeRef = useRef<Partial<Record<ResourceType, string>>>({});
  // 已上架资源切到别的类型时收起来的 previousVersionCode（按行 uid），切回原类型时放回
  const versionBaselinesRef = useRef<Map<string, number | undefined> | null>(
    null,
  );
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");

  const [idError, setIdError] = useState("");
  const [idGenerating, setIdGenerating] = useState(false);
  const [existingCatalogIds, setExistingCatalogIds] = useState<
    Map<string, string> | null
  >(null);


  const [previews, setPreviews] = useState<UploadItem[]>([]);
  const [previewUploading, setPreviewUploading] = useState(false);
  const [previewProcessingId, setPreviewProcessingId] = useState<string | null>(
    null,
  );
  const [icon, setIcon] = useState<UploadItem | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [cover, setCover] = useState<UploadItem | null>(null);

  const handlePreviewUpload = async (files: File[]) => {
    // SVG 在各宿主（WebKit / Chromium / WebView）渲染差异大，按后缀与文件内容
    // 双重判定后剔除：批量选择时只提示被剔除的文件，其余照常导入，不整批作废。
    const { allowed: fileList, rejected } = await partitionAllowedImages(files);
    if (rejected.length > 0) {
      log.warn("media/preview", `已跳过 ${rejected.length} 个 SVG 文件`, {
        data: { files: rejected.map((f) => f.name) },
      });
      toast.error(`${BANNED_IMAGE_NOTICE}本次选择的 ${rejected.length} 个 SVG 文件已被跳过。`);
    }
    if (!fileList.length) return;
    log.info("media/preview", `导入 ${fileList.length} 张预览图`, {
      data: {
        files: fileList.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })),
      },
    });
    setPreviewUploading(true);
    try {
      const initialItems = fileList.map((file) => ({
        ...createUploadItem(file),
        processing: true,
        progress: 0,
      }));
      setPreviews((prev) => [...prev, ...initialItems]);

      for (let index = 0; index < fileList.length; index++) {
        const file = fileList[index];
        const itemId = initialItems[index].id;
        let progressTimer: number | undefined;
        try {
          log.debug(
            "media/preview",
            `压缩预览图 ${index + 1}/${fileList.length}`,
            { data: { name: file.name, size: file.size } },
          );
          setPreviewProcessingId(itemId);
          progressTimer = window.setInterval(() => {
            setPreviews((prev) =>
              prev.map((item) =>
                item.id === itemId && item.processing
                  ? { ...item, progress: Math.min(90, (item.progress || 0) + 8 + Math.random() * 12) }
                  : item,
              ),
            );
          }, 160);
          const meta = await inspectImageFile(file);
          let processed: File;
          let finalMeta: ImageMeta;
          if (meta.animated) {
            const issue = checkAnimatedPreview(meta, file.size);
            if (issue?.level === "fail") {
              if (progressTimer != null) window.clearInterval(progressTimer);
              setPreviewProcessingId((prev) => (prev === itemId ? null : prev));
              const rejectedItem = initialItems[index];
              if (rejectedItem) revokeUrl(rejectedItem);
              setPreviews((prev) => prev.filter((old) => old.id !== itemId));
              log.warn("media/preview", `动图超过限制，已跳过: ${file.name}`, {
                data: { name: file.name, size: file.size, issue },
              });
              toast.error(`动图 ${file.name}：${issue.message}`);
              continue;
            }
            processed = await normalizeImageFile(file, meta);
            finalMeta = meta;
            if (issue?.level === "warn") {
              toast.warning(`动图 ${file.name}：${issue.message}`);
            }
            log.info("media/preview", "动图预览已保留，不做 canvas 压缩", {
              data: {
                name: file.name,
                size: file.size,
                format: meta.format,
                frames: meta.frames,
                durationMs: meta.durationMs,
                peakFps: meta.peakFps,
              },
            });
          } else {
            processed = await compressImageFile(file, PREVIEW_COMPRESS_TARGET_BYTES);
            finalMeta = await inspectImageFile(processed);
          }
          log.debug("media/preview", "读取预览图尺寸", {
            data: { name: file.name, compressedSize: processed.size },
          });
          const item = await createImageUploadItem(processed);
          item.imageMeta = finalMeta;
          log.info("media/preview", "预览图就绪", {
            data: {
              name: item.name,
              width: item.width,
              height: item.height,
              size: processed.size,
              format: finalMeta.format,
              animated: finalMeta.animated,
              frames: finalMeta.frames,
              peakFps: finalMeta.peakFps,
            },
          });
          if (progressTimer != null) window.clearInterval(progressTimer);
          setPreviewProcessingId((prev) => (prev === itemId ? null : prev));
          setPreviews((prev) =>
            prev.map((old) =>
              old.id === itemId ? { ...item, processing: false, progress: 100 } : old,
            ),
          );
        } catch (err) {
          if (progressTimer != null) window.clearInterval(progressTimer);
          setPreviewProcessingId((prev) => (prev === itemId ? null : prev));
          log.error("media/preview", `预览图处理失败: ${file.name}`, {
            data: { name: file.name, error: err },
          });
          toast.error(`图片处理失败：${file.name}`);
          setPreviews((prev) =>
            prev.map((old) =>
              old.id === itemId ? { ...old, processing: false, progress: 100 } : old,
            ),
          );
        }
      }
      log.debug("media/preview", "预览图批量处理完成");
    } finally {
      setPreviewProcessingId(null);
      setPreviewUploading(false);
    }
  };

  const handleIconUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const { rejected } = await partitionAllowedImages([file]);
    if (rejected.length > 0) {
      // 后缀没露馅但内容是 SVG 时，checkImageFormat 返回 null，
      // 这时退回通用文案，两种命中都说清原因与替代格式。
      const reason =
        checkImageFormat(file.name) ??
        `${BANNED_IMAGE_NOTICE}请改用 PNG / JPEG 后重新上传。`;
      log.warn("media/icon", "SVG 图标，已拒绝", {
        data: { name: file.name, reason },
      });
      toast.error(reason);
      return;
    }
    log.info("media/icon", "导入图标", {
      data: { name: file.name, size: file.size, type: file.type },
    });
    const iconMeta = await inspectImageFile(file);
    if (iconMeta.animated) {
      log.warn("media/icon", "图标不支持动图，已拒绝", {
        data: { name: file.name, format: iconMeta.format },
      });
      toast.error("图标不支持动图，请使用静态 PNG / JPEG / WebP。");
      return;
    }
    let originalDims: { width: number; height: number };
    try {
      originalDims = await getImageDimensions(file);
    } catch {
      log.warn("media/icon", "图标尺寸读取失败，已拒绝", {
        data: { name: file.name },
      });
      toast.error("图标无法读取，请重新上传。");
      return;
    }
    // 只拦软件修不好的情况：读不出尺寸或不是 1:1。
    // 超过 512px 交给 compressIconImage 等比缩放，不再让创作者自己改图。
    const iconError = checkIconShape(originalDims);
    if (iconError) {
      log.warn("media/icon", "图标规格不符，已拒绝", {
        data: {
          name: file.name,
          width: originalDims.width,
          height: originalDims.height,
          reason: iconError,
        },
      });
      toast.error(iconError);
      return;
    }
    const oversized =
      Math.max(originalDims.width, originalDims.height) > ICON_MAX_DIMENSION;
    setIconUploading(true);
    try {
      let processed = file;
      try {
        processed = await compressIconImage(
          file,
          ICON_COMPRESS_TARGET_BYTES,
          ICON_MAX_DIMENSION,
        );
        log.debug("media/icon", "图标处理完成", {
          data: {
            name: file.name,
            originalWidth: originalDims.width,
            originalHeight: originalDims.height,
            originalSize: file.size,
            compressedSize: processed.size,
          },
        });
        if (oversized) {
          log.info("media/icon", "图标超过尺寸上限，已自动缩放", {
            data: {
              name: file.name,
              originalWidth: originalDims.width,
              originalHeight: originalDims.height,
              maxDimension: ICON_MAX_DIMENSION,
            },
          });
        }
      } catch (err) {
        // 超限图缩不下来时不能回退原图：提交阶段仍会判定超限。
        if (oversized) {
          toast.error("图标处理失败，请更换图片后重试。");
          log.warn("media/icon", "图标缩放失败，已放弃导入", {
            data: { name: file.name, error: err },
          });
          return;
        }
        toast.error("图标处理失败，将使用原图");
        log.warn("media/icon", "图标压缩失败，使用原图", {
          data: { name: file.name, error: err },
        });
        // 即使压缩失败，也不能让 PNG 继续顶着 .webp 后缀进入 manifest。
        processed = await normalizeImageFile(file).catch(() => file);
      }
      const next = await createImageUploadItem(processed).catch(() =>
        createUploadItem(processed),
      );
      next.imageMeta = await inspectImageFile(processed);
      if (next.imageMeta.animated) {
        toast.error("图标不支持动图，请使用静态图片。");
        revokeUrl(next);
        return;
      }
      log.info("media/icon", "图标导入完成", {
        data: {
          name: next.name,
          width: next.width,
          height: next.height,
          size: next.file.size,
          format: next.imageMeta.format,
        },
      });
      setIcon((prev) => {
        revokeUrl(prev);
        return next;
      });
    } finally {
      setIconUploading(false);
    }
  };

  const handleCoverUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const { rejected } = await partitionAllowedImages([file]);
    if (rejected.length > 0) {
      const reason =
        checkImageFormat(file.name) ??
        `${BANNED_IMAGE_NOTICE}请改用 PNG / JPEG 后重新上传。`;
      log.warn("media/cover", "SVG 封面，已拒绝", {
        data: { name: file.name, reason },
      });
      toast.error(reason);
      return;
    }
    log.info("media/cover", "导入封面", {
      data: { name: file.name, size: file.size, type: file.type },
    });
    const coverMeta = await inspectImageFile(file);
    if (coverMeta.animated) {
      log.warn("media/cover", "封面不支持动图，已拒绝", {
        data: { name: file.name, format: coverMeta.format },
      });
      toast.error("封面不支持动图，请使用静态图片。");
      return;
    }
    const originalDims = await getImageDimensions(file);
    const coverRatioError = checkCoverRatio(originalDims);
    if (coverRatioError) {
      log.warn("media/cover", "封面宽高比保留两位小数不为 1.50，已拒绝", {
        data: {
          name: file.name,
          width: originalDims.width,
          height: originalDims.height,
          reason: coverRatioError,
        },
      });
      toast.error(coverRatioError);
      return;
    }
    let processed = file;
    try {
      processed = await compressImageFile(file, COVER_COMPRESS_TARGET_BYTES);
      log.debug("media/cover", "封面压缩完成", {
        data: {
          name: file.name,
          originalSize: file.size,
          compressedSize: processed.size,
        },
      });
    } catch (err) {
      toast.error("封面处理失败，将使用原图");
      log.warn("media/cover", "封面压缩失败，使用原图", {
        data: { name: file.name, error: err },
      });
      // 保持后缀与实际内容一致，避免压缩失败时把错名文件带进仓库。
      processed = await normalizeImageFile(file).catch(() => file);
    }
    const next = await createImageUploadItem(processed).catch(() =>
      createUploadItem(processed),
    );
    next.imageMeta = await inspectImageFile(processed);
    if (next.imageMeta.animated) {
      toast.error("封面不支持动图，请使用静态图片。");
      revokeUrl(next);
      return;
    }
    const coverSizeError = checkCoverFileSize(next.file.size);
    if (coverSizeError) {
      log.warn("media/cover", "封面体积过大，已拒绝", {
        data: { name: next.name, size: next.file.size },
      });
      toast.error(coverSizeError);
      revokeUrl(next);
      return;
    }
    log.info("media/cover", "封面导入完成", {
      data: {
        name: next.name,
        width: next.width,
        height: next.height,
        size: next.file.size,
      },
    });
    setCover((prev) => {
      revokeUrl(prev);
      return next;
    });
  };

  const handleRemovePreview = (id: string) => {
    const toRemove = previews.find((item) => item.id === id);
    if (toRemove) {
      log.info("media/preview", "移除预览图", {
        data: { name: toRemove.name },
      });
    }
    setPreviews((prev) => {
      const target = prev.find((item) => item.id === id);
      revokeUrl(target);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleReorderPreview = (fromId: string, toId: string) => {
    setPreviews((prev) => {
      const fromIndex = prev.findIndex((item) => item.id === fromId);
      const toIndex = prev.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleMovePreviewToSlot = (fromIndex: number, slot: number) => {
    setPreviews((prev) => moveToSlot(prev, fromIndex, slot));
  };

  const handleRemoveIcon = () => {
    if (icon) log.info("media/icon", "移除图标", { data: { name: icon.name } });
    revokeUrl(icon);
    setIcon(null);
  };

  const handleRemoveCover = () => {
    if (cover) {
      log.info("media/cover", "移除封面", { data: { name: cover.name } });
    }
    revokeUrl(cover);
    setCover(null);
  };

  const handleMediaDimensions = (
    kind: "preview" | "icon" | "cover",
    id: string,
    width: number,
    height: number,
  ) => {
    if (kind === "preview") {
      setPreviews((items) => items.map((item) => item.id === id ? { ...item, width, height } : item));
    } else if (kind === "icon") {
      setIcon((item) => item?.id === id ? { ...item, width, height } : item);
    } else {
      setCover((item) => item?.id === id ? { ...item, width, height } : item);
    }
  };


  const [authors, setAuthors] = useState<AuthorInput[]>([
    { name: "", bindABAccount: true },
  ]);
  const [links, setLinks] = useState<LinkInput[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [paidType, setPaidType] = useState("");
  const [enableAstroBoxCreatorFeatures, setEnableAstroBoxCreatorFeatures] =
    useState(false);
  /**
   * 该资源是否已配置付费平台映射。数据来自下载行里付费映射弹窗加载到的
   * 服务端配置，弹窗没打开过时为 undefined，校验时不据此拦截。
   */
  const [hasPaidPlatformMapping, setHasPaidPlatformMapping] = useState<
    boolean | undefined
  >(undefined);
  const effectivePaidType = paidType;
  const tags = useMemo(() => parseTagText(tagsInput), [tagsInput]);
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [isDeviceLoading, setIsDeviceLoading] = useState(true);
  /** 全部设备按名称排序，下拉里完整展示；受限厂商置灰而不是直接隐藏。 */
  const allSortedDeviceOptions = useMemo(
    () =>
      [...deviceOptions].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hans", { sensitivity: "base" }),
      ),
    [deviceOptions],
  );
  /** 资源包与模块只允许小米设备，其他类型保持完整设备列表。 */
  const supportedDeviceOptions = useMemo(
    () =>
      filterDeviceOptionsByResourceType(allSortedDeviceOptions, resourceType),
    [allSortedDeviceOptions, resourceType],
  );
  const sortedDeviceOptions = supportedDeviceOptions;
  // manifest 的 downloads key 可能是规范化 id，也可能是机型号，两者都要能查厂商。
  // 统一转小写，避免旧数据里 M2345B1 / m2345b1 这类大小写差异导致漏检。
  const deviceVendorById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const option of deviceOptions) {
      map.set(option.id.trim().toLowerCase(), option.vendor);
      for (const alias of option.aliases ?? []) {
        map.set(alias.trim().toLowerCase(), option.vendor);
      }
    }
    return map;
  }, [deviceOptions]);
  /** 受限资源类型下，下拉里保留非小米设备但置灰，悬浮时用系统气泡说明原因。 */
  const disabledDeviceTitle = isXiaomiOnlyResourceType(resourceType)
    ? `${formatResourceType(resourceType)}只支持 Vela 设备`
    : undefined;

  const [downloads, setDownloads] =
    useState<DownloadInput[]>(DEFAULT_DOWNLOADS);
  const [trialDownloads, setTrialDownloads] =
    useState<DownloadInput[]>(DEFAULT_DOWNLOADS);
  /**
   * 任意正式包体开启加密上传后，「启用购买与资源加密相关功能」必须同步打开：
   * 客户端只有看到这个开关才会请求解密密钥，否则安装加密包体会失败。
   * 只自动打开、不自动关闭，避免把付费映射等其它依赖一起关掉。
   */
  useEffect(() => {
    if (!downloads.some((row) => row.encryptOnUpload)) return;
    setEnableAstroBoxCreatorFeatures(true);
  }, [downloads]);

  const [extRaw, setExtRaw] = useState("{}");
  const [bundledResources, setBundledResources] = useState<
    BundledResourceInput[]
  >([]);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repoStatus, setRepoStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [repoMessage, setRepoMessage] = useState("");
  /** 仓库被已入索引的资源占用时记录该资源，供错误提示渲染可点击链接。 */
  const [repoOccupiedResource, setRepoOccupiedResource] = useState<{
    id?: string;
    name?: string;
  } | null>(null);
  const [prStatus, setPrStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [prMessage, setPrMessage] = useState("");
  /** 重复提交守卫命中的开放 PR；用于在步骤 3 提供「继续编辑原 PR」入口。 */
  const [pendingConflictPr, setPendingConflictPr] = useState<{
    number: number;
    title: string;
    samePath: boolean;
  } | null>(null);
  const [prBody, setPrBody] = useState("");
  const [versionReset, setVersionReset] = useState<VersionResetOptions>(
    DEFAULT_VERSION_RESET_OPTIONS,
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [versionCodeWarningRows, setVersionCodeWarningRows] = useState<
    DownloadInput[] | null
  >(null);
  const [versionIncrementWarning, setVersionIncrementWarning] = useState<
    DownloadInput[] | null
  >(null);
  /** 作者一个都没关联 AstroBox 账号时的提醒；记下原本要去的步骤以便「仍要继续」后补跳。 */
  const [unboundAuthorNoticeDialog, setUnboundAuthorNoticeDialog] = useState<{
    detail: string;
    target: number;
  } | null>(null);
  // 「仍要继续」时跳过一次提醒，避免确认后立刻又弹回来。只在一次跳转内有效。
  const skipAuthorNoticeOnceRef = useRef(false);
  const [unpaidEncryptionWarning, setUnpaidEncryptionWarning] = useState<Exclude<
    UnpaidEncryptionCheck,
    { status: "ok" }
  > | null>(null);
  const [repoNameInput, setRepoNameInput] = useState("");
  const [userRepos, setUserRepos] = useState<ExistingRepoOption[]>([]);
  const [userReposLoading, setUserReposLoading] = useState(false);
  const userReposFetchIdRef = useRef(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  const [editContext, setEditContext] = useState<ResourceEditContext | null>(
    () => {
      if (!isEditMode) {
        return null;
      }
      const state =
        (location.state as { editContext?: ResourceEditContext } | null) ||
        null;
      return state?.editContext ?? null;
    },
  );
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [lastManifest, setLastManifest] = useState<ManifestBuildResult | null>(
    null,
  );
  const [wallpaperPayload, setWallpaperPayload] = useState<{
    configJson: string;
    assets: WallpaperAssetFile[];
  }>({ configJson: "", assets: [] });
  const [wallpaperInitial, setWallpaperInitial] = useState<{
    config: WallpaperConfigRaw;
    assets: WallpaperAssetFile[];
    baseUrl: string;
  } | null>(null);
  const wallpaperResultRef = useRef<{
    configJson: string;
    assets: WallpaperAssetFile[];
    config: WallpaperConfigRaw;
    baseUrl: string;
  } | null>(null);
  const restoredFromSessionRef = useRef(false);

  // 资源流程会话日志：进入向导即新建会话文件，离开未完成自动标记 abandoned。
  usePublishFlowSession({
    mode: isEditMode ? "edit" : "publish",
    meta: () => {
      const context = editContext;
      return {
        flow: "staging",
        repoEnv: `${REPO_ENVS[repoEnvId]?.label ?? repoEnvId}`,
        itemId: context?.catalog.entry.id,
        itemName: context?.catalog.entry.name,
        repoOwner: context?.prHead?.owner,
        repoName: context?.prHead?.repo,
        prNumber: context?.prNumber,
      };
    },
  });

  useEffect(() => {
    if (!isEditMode) return;
    const state =
      (location.state as { editContext?: ResourceEditContext } | null) || null;
    setEditContext(state?.editContext ?? null);
  }, [isEditMode, location.state]);

  // Restore wizard form + wallpaper config after returning from the wallpaper editor page.
  useEffect(() => {
    const state = (location.state as { wallpaperResult?: { configJson: string; assets: WallpaperAssetFile[]; config: WallpaperConfigRaw; baseUrl: string } } | null) || null;
    const result = state?.wallpaperResult;
    if (result) {
      wallpaperResultRef.current = result;
      setWallpaperPayload({ configJson: result.configJson, assets: result.assets });
      setWallpaperInitial({
        config: result.config,
        assets: result.assets,
        baseUrl: result.baseUrl,
      });
    }
    const session = takeWizardSession();
    if (session?.wallpaperPayload && !result) {
      setWallpaperPayload(session.wallpaperPayload);
    }
    if (session?.form) {
      restoredFromSessionRef.current = true;
      const form = session.form;
      setItemId(form.itemId);
      idsByTypeRef.current[form.resourceType] = form.itemId;
      setItemName(form.itemName);
      setDescription(form.description);
      setResourceType(form.resourceType);
      setTagsInput(form.tagsInput);
      setPaidType(form.paidType);
      setAuthors(withBoundFirstAuthor(form.authors));
      setLinks(form.links);
      setPreviews(form.previews);
      setIcon(form.icon);
      setCover(form.cover);
      setDownloads(form.downloads);
      setTrialDownloads(form.trialDownloads);
      setEnableAstroBoxCreatorFeatures(form.enableAstroBoxCreatorFeatures);
      setExtRaw(form.extRaw);
      if (!isEditMode) void clearAutoSavedDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isEditMode]);

  const isEditing = isEditMode || Boolean(editContext);
  // 尚未进入已合入目录 index_v2.csv 的资源（全新发布 / 首次提交的进行中 PR）
  // 允许改 ID 与类型；已合入目录的资源锁定（目录列表未加载时同样锁定）。
  const canEditIdentity = canEditResourceIdentity({
    editContext,
    catalogIds: existingCatalogIds,
  });
  // 已合入目录的资源可以改类型；ID 只有改了类型才放开（表盘、模块等的 ID 格式不同，
  // 换类型往往只能连 ID 一起换）。换了 ID 的提交在 PR 前登记迁移，合入后服务端搬数据。
  const listedResourceId = listedResourceIdOf(editContext);
  const listedType =
    isEditing && !canEditIdentity && editContext?.catalog.entry.restype
      ? normalizeResourceType(editContext.catalog.entry.restype)
      : null;
  const identityLocks = resolveIdentityLocks({
    isEditing,
    canEditIdentity,
    listedType,
    resourceType,
  });
  const idMigration = useMemo(
    () => resolveIdMigration({ editContext, itemId }),
    [editContext, itemId],
  );
  const missingEditContext = isEditMode && !editContext;

  useEffect(() => {
    if (mode !== "new") return;
    const username = accountState.astrobox?.username?.trim();
    if (!username) return;
    setAuthors((prev) => {
      if (prev.length === 1 && !prev[0].name.trim()) {
        return [{ name: username, bindABAccount: true }];
      }
      return prev;
    });
  }, [accountState.astrobox?.username, mode]);

  useEffect(() => {
    let cancelled = false;
    const fetchDevices = async () => {
      try {
        setIsDeviceLoading(true);
        setDeviceError("");
        const options = await loadDeviceOptions();
        if (!cancelled) {
          setDeviceOptions(options);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setDeviceError("设备列表获取失败，请稍后再试。");
          setDeviceOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsDeviceLoading(false);
        }
      }
    };

    fetchDevices();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sortedDeviceOptions.length === 0) return;
    setDownloads((prev) => {
      if (prev.length === 0) {
        return [];
      }
      let changed = false;
      const used = new Set<string>();
      const next = prev.map((item) => {
        if (item.platformId) {
          used.add(item.platformId);
          return item;
        }
        const fallback = sortedDeviceOptions.find((opt) => !used.has(opt.id));
        if (fallback) {
          changed = true;
          used.add(fallback.id);
          return { ...item, platformId: fallback.id };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [sortedDeviceOptions]);

  useEffect(() => {
    let active = true;
    const loadIds = async () => {
      const token = loadAccountState().github?.token;
      if (!token) return;
      try {
        const ids = await fetchExistingCatalogIds(token);
        if (active) setExistingCatalogIds(ids);
      } catch (error) {
        console.error("load catalog ids failed", error);
      }
    };
    loadIds();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      resourceType === "watchface" &&
      !itemId.trim() &&
      existingCatalogIds
    ) {
      setItemId(generateUniqueWatchfaceId(existingCatalogIds));
    }
  }, [resourceType, itemId, existingCatalogIds]);

  // 未合入目录前允许改资源 ID / 类型：改完之后用户资源仓库里的 manifest 与
  // 包体就对不上了，必须重跑步骤 2 重传；这里把已成功的上传状态作废并给出提示，
  // 步骤 3 的 ID 一致性守卫（uploadedId 校验）仍会兜底。
  const invalidateUploadedAssets = useCallback(
    (reason: string) => {
      if (repoStatus !== "success") return;
      setRepoStatus("idle");
      setRepoMessage(`${reason}，请重新执行步骤 2 上传仓库文件后再提交 PR。`);
      setRepoOccupiedResource(null);
      setLastManifest(null);
    },
    [repoStatus],
  );

  const handleResourceTypeChange = useCallback(
    (next: ResourceType) => {
      if (identityLocks.typeLocked || next === resourceType) return;
      idsByTypeRef.current[resourceType] = itemIdRef.current;
      const cached = idsByTypeRef.current[next];
      // 已上架资源换类型时，原 ID 也符合新类型的格式就先沿用：不换 ID 就不用迁移数据。
      const keptListedId =
        isEditing &&
        !canEditIdentity &&
        listedResourceId &&
        !resourceIdFormatError(next, listedResourceId)
          ? listedResourceId
          : undefined;
      const suggested =
        next === "res_pack" ? normalizeResPackIdInput(itemName) : "";
      setItemId(
        cached !== undefined ? cached : (keptListedId ?? suggested),
      );
      setResourceType(next);
      // 已上架资源离开目录里的类型：旧类型包体的 versionCode 不能当新包体的基线
      // （表盘的版本号和新模块的毫无关系），先收起来，切回原类型时再放回去。
      let baseDownloads = downloads;
      let baseTrialDownloads = trialDownloads;
      if (listedType && resourceType === listedType) {
        const saved = new Map<string, number | undefined>();
        const strip = (rows: DownloadInput[]) =>
          rows.map((row) => {
            saved.set(row.uid, row.previousVersionCode);
            return { ...row, previousVersionCode: undefined };
          });
        baseDownloads = strip(downloads);
        baseTrialDownloads = strip(trialDownloads);
        versionBaselinesRef.current = saved;
      } else if (listedType && next === listedType && versionBaselinesRef.current) {
        const saved = versionBaselinesRef.current;
        const restore = (rows: DownloadInput[]) =>
          rows.map((row) =>
            saved.has(row.uid)
              ? { ...row, previousVersionCode: saved.get(row.uid) }
              : row,
          );
        baseDownloads = restore(downloads);
        baseTrialDownloads = restore(trialDownloads);
        versionBaselinesRef.current = null;
      }
      if (baseDownloads !== downloads) setDownloads(baseDownloads);
      if (baseTrialDownloads !== trialDownloads) {
        setTrialDownloads(baseTrialDownloads);
      }
      // 切到小米专属类型时清掉已选的非小米设备行。厂商未知（设备库尚未
      // 加载完）的行先保留，提交前还有一层校验兜底。
      if (isXiaomiOnlyResourceType(next)) {
        const prune = (rows: DownloadInput[]) =>
          rows.filter((row) => {
            if (!row.platformId) return true;
            const vendor = deviceVendorById.get(
              row.platformId.trim().toLowerCase(),
            );
            return (
              vendor === undefined ||
              isDeviceVendorSupportedByResourceType(next, vendor)
            );
          });
        const nextDownloads = prune(baseDownloads);
        const nextTrialDownloads = prune(baseTrialDownloads);
        if (nextDownloads.length !== downloads.length) {
          setDownloads(nextDownloads);
        }
        if (nextTrialDownloads.length !== trialDownloads.length) {
          setTrialDownloads(nextTrialDownloads);
        }
        const removed =
          downloads.length -
          nextDownloads.length +
          (trialDownloads.length - nextTrialDownloads.length);
        if (removed > 0) {
          toast.warning(
            `${formatResourceType(next)}仅支持小米设备，已移除 ${removed} 个非小米设备的下载配置。`,
          );
        }
      }
      invalidateUploadedAssets("资源类型已变更");
    },
    [
      resourceType,
      isEditing,
      canEditIdentity,
      identityLocks.typeLocked,
      listedResourceId,
      listedType,
      itemName,
      deviceVendorById,
      downloads,
      trialDownloads,
      invalidateUploadedAssets,
    ],
  );

  const handleItemIdChange = useCallback(
    (value: string) => {
      if (identityLocks.idLocked) return;
      // 资源 ID 不做任何自动改写：创作者填什么就存什么，不合规只提示。
      // 自动替换非法字符会打断输入法组字（拼音中间的组字符会被替成 '-'），
      // 也会让 CSV id 与包内 themeId 悄悄分叉。
      setItemId(value);
      invalidateUploadedAssets("资源 ID 已变更");
    },
    [identityLocks.idLocked, invalidateUploadedAssets],
  );

  useEffect(() => {
    const trimmed = itemId.trim();
    if (!trimmed) {
      setIdError("");
      return;
    }
    const ownedId = editContext?.catalog.entry.id.trim();
    if (resourceType === "watchface") {
      const formatError = validateWatchfaceIdFormat(trimmed);
      if (formatError) {
        setIdError(formatError);
        return;
      }
    } else if (resourceType === "canopus") {
      const formatError = validateCanopusIdFormat(trimmed);
      if (formatError) {
        setIdError(formatError);
        return;
      }
    } else if (resourceType === "res_pack") {
      const formatError = validateResPackIdFormat(trimmed);
      if (formatError) {
        setIdError(formatError);
        return;
      }
    }
    const existingName = existingCatalogIds?.get(trimmed);
    if (existingName && trimmed !== ownedId) {
      setIdError(`该 ID 已被资源「${existingName}」占用，请更换一个`);
      return;
    }
    setIdError("");
  }, [itemId, resourceType, existingCatalogIds, editContext]);

  useEffect(() => {
    if (!isEditMode || !editContext) return;
    if (restoredFromSessionRef.current) return;
    let active = true;
    const load = async () => {
      setEditLoading(true);
      setEditError("");
      setUploadLogs([]);
      setRepoStatus("idle");
      setPrStatus("idle");
      setLastManifest(null);
      if (!wallpaperResultRef.current) {
        setWallpaperPayload({ configJson: "", assets: [] });
        setWallpaperInitial(null);
      }
      try {
        const token = loadAccountState().github?.token;
        if (!token) {
          throw new Error("GitHub 未登录，无法加载资源。");
        }
        const catalogEntry = editContext.catalog.entry;
        const ref = catalogEntry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
        const { manifest, repo } = await fetchManifestForCatalogEntry({
          entry: catalogEntry,
          token,
          ref,
        });

        const resourceIdForCrypto = manifest.item.id || catalogEntry.id || "";
        const fileKeys = resourceIdForCrypto
          ? await listSellerResourceFileKeys({
              resourceId: resourceIdForCrypto,
              limit: 500,
            }).catch(() => [])
          : [];
        const encryptedDeviceSet = new Set(fileKeys.map((item) => item.deviceId));
        if (!active) return;

        setItemId(manifest.item.id || catalogEntry.id || "");
        idsByTypeRef.current[normalizeResourceType(manifest.item.restype)] =
          manifest.item.id || catalogEntry.id || "";
        setItemName(manifest.item.name || catalogEntry.name || "");
        setDescription(manifest.item.description || "");
        setResourceType(
          normalizeResourceType(manifest.item.restype),
        );
        setTagsInput(catalogEntry.tags || "");
        setPaidType(catalogEntry.paid_type || "");
        setAuthors(
          withBoundFirstAuthor(
            manifest.item.author?.map((a) => ({
              name: a.name || "",
              bindABAccount: Boolean(a.bindABAccount),
            })) || [{ name: "", bindABAccount: true }],
          ),
        );
        setLinks(
          manifest.links?.map((link) => ({
            title: link.title || "",
            url: link.url || "",
            icon: normalizeLinkIconName(link.icon || ""),
          })) || [],
        );

        const previewItems: UploadItem[] = await Promise.all(
          (manifest.item.preview || []).map((path, index) =>
            loadRemoteMediaItem(
              path,
              buildRawFileUrl(repo.owner, repo.name, ref, path),
            ).catch(() =>
              createExistingUploadItem(
                path.split("/").pop() || `preview-${index + 1}`,
                buildRawFileUrl(repo.owner, repo.name, ref, path),
                path,
              ),
            ),
          ),
        );
        setPreviews(previewItems);

        const iconPath = manifest.item.icon;
        setIcon(
          iconPath
            ? await loadRemoteMediaItem(
                iconPath,
                buildRawFileUrl(repo.owner, repo.name, ref, iconPath),
              )
            : null,
        );

        const coverPath = manifest.item.cover;
        setCover(
          coverPath
            ? await loadRemoteMediaItem(
                coverPath,
                buildRawFileUrl(repo.owner, repo.name, ref, coverPath),
              )
            : null,
        );

        const ext = isManifestExtObject(manifest.ext) ? manifest.ext : {};
        let downloadRows = buildDownloadInputsFromManifest({
          downloads: manifest.downloads,
          owner: repo.owner,
          repo: repo.name,
          ref,
          encryptedDeviceSet,
        });
        let trialDownloadRows = buildDownloadInputsFromManifest({
          downloads: ext.trialDownloads,
          owner: repo.owner,
          repo: repo.name,
          ref,
        });
        // 编辑未合入的 PR 时，上面读到的 manifest 属于 PR 分支上尚未发布的状态，
        // previousVersionCode 是「上次提交进这个 PR 的值」。拿它当基线的后果是：
        // 每替换一次包体就被要求再涨一次版本号，而这次提交根本还没上线。
        // 递增要求的唯一合法基准是索引指向的已合入版本，因此这里用已发布 manifest
        // 覆盖基线；索引里没有该资源（首次发布）则清空基线，递增检查不参与。
        if (editContext.mode === "in_progress") {
          const baselineResourceId =
            editContext.submission?.request.original_id?.trim() ||
            catalogEntry.id;
          try {
            const published = await fetchPublishedBaselinesForResourceId({
              token,
              resourceId: baselineResourceId,
            });
            // 这个 PR 改了资源类型（例如表盘改成模块）：旧类型包体的版本号与新包体无关，不当基线
            const baselines =
              published?.restype &&
              normalizeResourceType(published.restype) !==
                normalizeResourceType(catalogEntry.restype)
                ? undefined
                : published;
            downloadRows = applyPublishedBaseline(
              downloadRows,
              baselines?.downloads,
            );
            trialDownloadRows = applyPublishedBaseline(
              trialDownloadRows,
              baselines?.trialDownloads,
            );
            log.info("publish/baseline", "按已合入索引重算 versionCode 基线", {
              data: {
                resourceId: baselineResourceId,
                prNumber: editContext.prNumber ?? null,
                found: Boolean(baselines),
              },
            });
          } catch (error) {
            // 读不到索引时不回退到 PR 内基线：那正是本次要修掉的误拦来源。
            // 宁可不判（放过一个未合入版本，审核侧仍会把关），也不误拦。
            downloadRows = applyPublishedBaseline(downloadRows, undefined);
            trialDownloadRows = applyPublishedBaseline(trialDownloadRows, undefined);
            log.warn("publish/baseline", "读取已合入基线失败，本次不参与递增判定", {
              data: {
                resourceId: baselineResourceId,
                error: (error as Error)?.message ?? String(error),
              },
            });
          }
        }
        setDownloads(downloadRows);
        setTrialDownloads(trialDownloadRows);
        setEnableAstroBoxCreatorFeatures(
          Boolean(ext.enableAstroBoxCreatorFeatures),
        );
        setBundledResources(
          normalizeBundledResources(ext.bundledResources).map((item) => ({
            mode: item.mode,
            type: item.type,
            id: item.id ?? item.name ?? "",
            name: item.name,
          })),
        );
        setExtRaw(JSON.stringify(extractCustomExt(ext), null, 2));
        setRepoInfo({ ...repo });
        setRepoNameInput(repo.name);

        const wallpaperConfigUrl = getWallpaperConfigUrl(manifest);
        if (wallpaperConfigUrl && !wallpaperResultRef.current) {
          try {
            const wallpaperFile = await fetchWallpaperConfigForCatalogEntry({
              entry: catalogEntry,
              token,
              ref,
            });
            if (!active) return;
            setWallpaperInitial({
              config: wallpaperFile.config,
              assets: wallpaperFile.assets,
              baseUrl: wallpaperFile.baseUrl,
            });
          } catch (error) {
            console.warn("[edit-wallpaper] 壁纸配置加载失败", error);
            setWallpaperInitial(null);
          }
        }

        setActiveStepIndex(0);
      } catch (error) {
        if (!active) return;
        setEditError((error as Error).message);
      } finally {
        if (active) setEditLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [editContext, isEditMode]);

  const { parsedExt, extError } = useMemo(() => {
    try {
      const trimmed = extRaw.trim();
      if (!trimmed) {
        return { parsedExt: {}, extError: "" };
      }
      const parsed = JSON.parse(trimmed);
      if (!isManifestExtObject(parsed)) {
        return {
          parsedExt: {},
          extError: "ext 字段需要合法的 JSON 对象",
        };
      }
      return {
        parsedExt: parsed,
        extError: "",
      };
    } catch {
      return { parsedExt: {}, extError: "ext 字段需要合法的 JSON 对象" };
    }
  }, [extRaw]);

  const wallpaperConfigUrl = useMemo(() => {
    if (!wallpaperPayload.configJson.trim()) return "";
    const entry = editContext?.catalog.entry;
    if (entry?.repo_owner && entry?.repo_name) {
      return `https://raw.githubusercontent.com/${entry.repo_owner}/${entry.repo_name}/${MAIN_RESOURCE_BRANCH}/wallpaper/wallpaper.json`;
    }
    const username = accountState.github?.username?.trim() || "";
    const repoName = buildRepoName(itemId || itemName || "resource");
    return `https://raw.githubusercontent.com/${username}/${repoName}/${MAIN_RESOURCE_BRANCH}/wallpaper/wallpaper.json`;
  }, [
    accountState.github?.username,
    editContext?.catalog.entry,
    itemId,
    itemName,
    wallpaperPayload.configJson,
  ]);

  const manifestResult: ManifestBuildResult = useMemo(
    () =>
      buildManifest({
        itemId,
        itemName,
        description,
        resourceType,
        previews,
        icon,
        cover,
        usePreviewAsCover: false,
        coverPreviewId: null,
        authors,
        links,
        downloads,
        trialDownloads,
        enableAstroBoxCreatorFeatures,
        bundledResources,
        ext: parsedExt,
        wallpaper: wallpaperPayload.configJson.trim()
          ? {
              configJson: wallpaperPayload.configJson,
              configUrl: wallpaperConfigUrl,
              assets: wallpaperPayload.assets,
            }
          : undefined,
      }),
    [
      authors,
      bundledResources,
      cover,
      description,
      downloads,
      enableAstroBoxCreatorFeatures,
      icon,
      itemId,
      itemName,
      links,
      parsedExt,
      previews,
      resourceType,
      trialDownloads,
      wallpaperConfigUrl,
      wallpaperPayload,
    ],
  );

  const publishValidation = useMemo(
    () =>
      validatePublish({
        itemId,
        itemName,
        description,
        tags,
        authors,
        resourceType,
        previews,
        icon,
        cover,
        usePreviewAsCover: false,
        coverPreviewId: null,
        downloads: downloads.map((row) => ({
          ...row,
          vendor: deviceVendorById.get(row.platformId.trim().toLowerCase()),
        })),
        trialDownloads: trialDownloads.map((row) => ({
          ...row,
          vendor: deviceVendorById.get(row.platformId.trim().toLowerCase()),
        })),
        links,
        enableAstroBoxCreatorFeatures,
        hasPaidPlatformMapping,
      }),
    [
      itemId,
      itemName,
      description,
      tags,
      authors,
      resourceType,
      previews,
      icon,
      cover,
      downloads,
      trialDownloads,
      deviceVendorById,
      links,
      enableAstroBoxCreatorFeatures,
      hasPaidPlatformMapping,
    ],
  );

  /** 已上传包体但未填写 versionCode 的行。versionCode 为强制项，缺失时不允许进入后续步骤。 */
  const missingVersionCodeRows = useMemo(
    () => rowsMissingVersionCode(downloads),
    [downloads],
  );

  /**
   * 付费映射弹窗回报资源级状态。列表接口返回的是整个资源的 products/skus，
   * 所以任意一行的弹窗都能判定资源有没有映射；每次回报都是当时的真相，
   * 直接覆盖即可（清空映射后要能重新变成「无映射」）。弹窗没打开过就保持 undefined。
   */
  const handlePaidMappingStateChange = useCallback((hasMapping: boolean) => {
    setHasPaidPlatformMapping(hasMapping);
  }, []);

  const addDownloadRow = () => {
    const buildRow = (platformId?: string): DownloadInput => ({
      uid: crypto.randomUUID?.() ?? Math.random().toString(36),
      platformId: platformId ?? "",
      version: "",
      file: null,
      encryptOnUpload: false,
    });

    setDownloads((prev) => {
      const used = new Set(prev.map((d) => d.platformId));
      const next =
        sortedDeviceOptions.find((opt) => !used.has(opt.id)) ||
        sortedDeviceOptions[0];
      log.info("download/row", "添加下载配置行", {
        data: {
          deviceId: next?.id,
          deviceName: next?.name,
        },
      });
      return [...prev, buildRow(next?.id)];
    });
  };

  const removeDownloadRow = (uid: string) => {
    const removed = downloads.find((d) => d.uid === uid);
    if (removed) {
      log.info("download/row", "移除下载配置行", {
        data: {
          deviceId: removed.platformId,
          fileName: removed.file?.name ?? removed.existingFileName ?? null,
        },
      });
    }
    setDownloads((prev) => prev.filter((d) => d.uid !== uid));
  };

  const updateDownloadRow = (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => {
    setDownloads((prev) =>
      prev.map((row) => (row.uid === uid ? updater(row) : row)),
    );
  };

  const batchSetDownloadDevices = (selectedIds: string[]) => {
    log.info("download/row", `批量选择设备（${selectedIds.length} 台）`, {
      data: { deviceIds: selectedIds },
    });
    setDownloads((prev) => {
      const existingMap = new Map(
        prev.filter((d) => d.platformId).map((d) => [d.platformId, d]),
      );
      return selectedIds.map((id) => {
        if (existingMap.has(id)) return existingMap.get(id)!;
        return {
          uid: crypto.randomUUID?.() ?? Math.random().toString(36),
          platformId: id,
          version: "",
          file: null,
          encryptOnUpload: false,
        };
      });
    });
  };

  const fillAllDownloads = (template: {
    version: string;
    file: UploadItem | null;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
    versionLocked?: boolean;
    versionSource?: DownloadInput["versionSource"];
    packageHash?: string;
    packageIdentity?: string;
    packageIdentityKind?: DownloadInput["packageIdentityKind"];
    packageWritable?: boolean;
    canopus?: DownloadInput["canopus"];
  }) => {
    log.info("download/row", "一键填充下载配置", {
      data: {
        version: template.version,
        fileName: template.file?.name ?? null,
        encryptOnUpload: template.encryptOnUpload,
        versionCode: template.versionCode ?? null,
        updateLogCount: template.updatelogs?.length ?? 0,
      },
    });
    setDownloads((prev) =>
      prev.map((row) => ({
        ...row,
        version: template.version,
        file: template.file,
        // 带入新包体时必须清掉旧文件名：编辑模式下各行都带existingFileName，
        // 不清会与新file 并存，导致加密开关被禁用（disabled 依据 existingFileName）。
        // 手动挑包体（pickDownloadFile）同样会清，此处保持一致。
        existingFileName: template.file ? undefined : row.existingFileName,
        encryptOnUpload: template.encryptOnUpload ?? row.encryptOnUpload,
        versionCode: template.versionCode,
        versionLocked: template.versionLocked,
        versionSource: template.versionSource,
        packageHash: template.packageHash,
        packageIdentity: template.packageIdentity,
        packageIdentityKind: template.packageIdentityKind,
        packageWritable: template.packageWritable,
        canopus: template.canopus,
        updatelogs: template.updatelogs
          ? template.updatelogs.map((log) => ({ ...log }))
          : undefined,
      })),
    );
  };

  const addTrialDownloadRow = () => {
    setTrialDownloads((prev) => {
      const used = new Set(prev.map((d) => d.platformId));
      const next =
        sortedDeviceOptions.find((opt) => !used.has(opt.id)) ||
        sortedDeviceOptions[0];
      log.info("download/trial/row", "添加试用下载配置行", {
        data: {
          deviceId: next?.id,
          deviceName: next?.name,
        },
      });
      return [
        ...prev,
        {
          uid: crypto.randomUUID?.() ?? Math.random().toString(36),
          platformId: next?.id ?? "",
          version: "",
          file: null,
          encryptOnUpload: false,
        },
      ];
    });
  };

  const removeTrialDownloadRow = (uid: string) => {
    const removed = trialDownloads.find((d) => d.uid === uid);
    if (removed) {
      log.info("download/trial/row", "移除试用下载配置行", {
        data: {
          deviceId: removed.platformId,
          fileName: removed.file?.name ?? removed.existingFileName ?? null,
        },
      });
    }
    setTrialDownloads((prev) => prev.filter((d) => d.uid !== uid));
  };

  const updateTrialDownloadRow = (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => {
    setTrialDownloads((prev) =>
      prev.map((row) => (row.uid === uid ? updater(row) : row)),
    );
  };

  const batchSetTrialDownloadDevices = (selectedIds: string[]) => {
    log.info("download/trial/row", `批量选择试用设备（${selectedIds.length} 台）`, {
      data: { deviceIds: selectedIds },
    });
    setTrialDownloads((prev) => {
      const existingMap = new Map(
        prev.filter((d) => d.platformId).map((d) => [d.platformId, d]),
      );
      return selectedIds.map((id) => {
        if (existingMap.has(id)) return existingMap.get(id)!;
        return {
          uid: crypto.randomUUID?.() ?? Math.random().toString(36),
          platformId: id,
          version: "",
          file: null,
          encryptOnUpload: false,
        };
      });
    });
  };

  const fillAllTrialDownloads = (template: {
    version: string;
    file: UploadItem | null;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
    versionLocked?: boolean;
    versionSource?: DownloadInput["versionSource"];
    packageHash?: string;
    packageIdentity?: string;
    packageIdentityKind?: DownloadInput["packageIdentityKind"];
    packageWritable?: boolean;
    canopus?: DownloadInput["canopus"];
  }) => {
    log.info("download/trial/row", "一键填充试用下载配置", {
      data: {
        version: template.version,
        fileName: template.file?.name ?? null,
        versionCode: template.versionCode ?? null,
        updateLogCount: template.updatelogs?.length ?? 0,
      },
    });
    setTrialDownloads((prev) =>
      prev.map((row) => ({
        ...row,
        version: template.version,
        file: template.file,
        // 同 fillAllDownloads：带入新包体时清掉旧文件名
        existingFileName: template.file ? undefined : row.existingFileName,
        versionCode: template.versionCode,
        versionLocked: template.versionLocked,
        versionSource: template.versionSource,
        packageHash: template.packageHash,
        packageIdentity: template.packageIdentity,
        packageIdentityKind: template.packageIdentityKind,
        packageWritable: template.packageWritable,
        canopus: template.canopus,
        updatelogs: template.updatelogs
          ? template.updatelogs.map((log) => ({ ...log }))
          : undefined,
      })),
    );
  };

  const goToStep = (index: number) => {
    const target = Math.max(0, Math.min(2, index));
    // 先切回第 1 步再定位：表单是条件渲染的，不切回去元素根本不在 DOM 里。
    const backToForm = () => {
      setActiveStepIndex(0);
    };
    // 一个作者都没关联 AstroBox 账号时只提醒、不阻拦。
    // 放在这里（而不是提交 PR 时）是因为到那一步仓库文件已经传完，回退成本高。
    // 正常情况下第一个作者恒为绑定状态，只在历史 manifest 缺字段、
    // 或创作者删掉第一个作者后剩下的人都没绑定时才会触发。
    const authorNotice = unboundAuthorNotice(authors);
    // 简介与标签参与推荐推流，各自独立提示：
    // 合并成一条会让「只有标签有问题」的创作者看到自己没填简介的误报。
    if (target > 0) {
      const pushIssues = validatePushQuality(description, tags);
      if (pushIssues.length > 0) {
        for (const issue of pushIssues) toast.error(issue.message);
        backToForm();
        for (const issue of pushIssues) flashPublishField(issue.field);
        return;
      }
    }
    // versionCode 为强制项。校验放在 goToStep 而非「下一步」按钮上，
    // 否则侧边 StepList 直接点第 2/3 步会绕过检查。
    if (target > 0 && missingVersionCodeRows.length > 0) {
      setVersionCodeWarningRows(missingVersionCodeRows);
      backToForm();
      return;
    }
    if (target > 0 && authorNotice && !skipAuthorNoticeOnceRef.current) {
      skipAuthorNoticeOnceRef.current = true;
      setUnboundAuthorNoticeDialog({ detail: authorNotice, target });
      backToForm();
      return;
    }
    // 走到这里说明本次跳转要么没有提醒，要么用户已确认过；消费掉这个跳过标记。
    skipAuthorNoticeOnceRef.current = false;
    const firstIssue = publishValidation.issues[0];
    if (target > 0 && firstIssue) {
      toast.error(firstIssue.message);
      backToForm();
      flashPublishIssue(firstIssue);
      return;
    }
    if (target > 1 && (repoStatus !== "success" || !repoInfo?.commitSha)) {
      toast.error("请先完成资源仓库上传并获取提交哈希。");
      setActiveStepIndex(1);
      return;
    }
    if (target === 1) {
      setRepoStatus("idle");
      setRepoMessage("");
      setRepoOccupiedResource(null);
      setUploadLogs([]);
    }
    setActiveStepIndex(target);
  };

  const handleNextFromDownloadConfig = () => {
    // 已上架资源换了类型：旧类型的包体不能沿用到新类型上，每个设备都要重新导入。
    if (listedType && resourceType !== listedType) {
      const stale = [...downloads, ...trialDownloads].filter((row) =>
        Boolean(row.existingFileName),
      );
      if (stale.length > 0) {
        toast.error(
          `资源类型已从「${formatResourceType(listedType)}」改为「${formatResourceType(resourceType)}」，旧类型的包体不能沿用，请重新导入（${stale
            .map(
              (d) =>
                sortedDeviceOptions.find((opt) => opt.id === d.platformId)
                  ?.name ||
                d.platformId ||
                "未选设备",
            )
            .join("、")}）。`,
        );
        return;
      }
    }
    const withoutCanopus = rowsWithoutCanopusMeta(
      [...downloads, ...trialDownloads],
      resourceType,
    );
    if (withoutCanopus.length > 0) {
      toast.error(
        `不是有效的 .canopus 模块包（${withoutCanopus
          .map(
            (d) =>
              sortedDeviceOptions.find((opt) => opt.id === d.platformId)?.name ||
              d.platformId ||
              "未选设备",
          )
          .join("、")}），请用 canopus package 重新打包后导入。`,
      );
      return;
    }
    const identityMismatch = rowsWithIdentityMismatch(
      [...downloads, ...trialDownloads],
      itemId,
    );
    if (identityMismatch.length > 0) {
      toast.error(
        `包体包名与资源 ID 不一致（${identityMismatch
          .map(
            (d) =>
              `${sortedDeviceOptions.find((opt) => opt.id === d.platformId)?.name || d.platformId || "未选设备"}: ${d.packageIdentity}`,
          )
          .join("、")}），将无法自动检查更新，请先统一 ID。`,
      );
      return;
    }
    const nonIncrement = rowsWithNonIncrementedVersionCode([
      ...downloads,
      ...trialDownloads,
    ]);
    if (nonIncrement.length > 0) {
      setVersionIncrementWarning(nonIncrement);
      return;
    }
    goToStep(1);
  };


  const handleGenerateId = useCallback(async () => {
    if (resourceType !== "watchface" || idGenerating) return;
    setIdGenerating(true);
    try {
      // 优先复用进入页面时预取的目录 ID，避免每次点击都重新走网络。
      let ids = existingCatalogIds;
      if (!ids || ids.size === 0) {
        const token = loadAccountState().github?.token;
        if (!token) throw new Error("GitHub 未登录，无法检查 ID 是否重复");
        ids = await fetchExistingCatalogIds(token);
        setExistingCatalogIds(ids);
      }
      const finalId = generateUniqueWatchfaceId(ids);
      // 随机生成时给一段数字滚动的过渡动画（后段逐渐变慢，最后定格）。
      const digitCount = finalId.length - WATCHFACE_ID_PREFIX.length;
      for (let frame = 0; frame < 10; frame += 1) {
        const random = Array.from({ length: digitCount }, () =>
          Math.floor(Math.random() * 10),
        ).join("");
        setItemId(`${WATCHFACE_ID_PREFIX}${random}`);
        await new Promise((resolve) => setTimeout(resolve, 20 + frame * 6));
      }
      setItemId(finalId);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIdGenerating(false);
    }
  }, [resourceType, idGenerating, existingCatalogIds]);

  const addTag = () => {
    const nextTag = tagInput.trim();
    if (!nextTag) return;
    if (tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      setTagInput("");
      return;
    }
    log.info("form/tags", `添加标签: ${nextTag}`);
    setTagsInput((prev) => {
      const existing = parseTagText(prev);
      return [...existing, nextTag].join(";");
    });
    setTagInput("");
  };

  const removeTag = (index: number) => {
    const removed = tags[index];
    if (removed) log.info("form/tags", `移除标签: ${removed}`);
    setTagsInput((prev) => {
      const next = parseTagText(prev);
      next.splice(index, 1);
      return next.join(";");
    });
  };

  const wallpaperTemplateCount = useMemo(() => {
    if (!wallpaperPayload.configJson.trim()) return 0;
    try {
      const parsed = JSON.parse(wallpaperPayload.configJson) as { templates?: unknown[] };
      return Array.isArray(parsed.templates) ? parsed.templates.length : 0;
    } catch {
      return 0;
    }
  }, [wallpaperPayload.configJson]);

  const handleOpenWallpaperEditor = useCallback(async () => {
    const editorInitial = resolveWallpaperEditorInitial(
      wallpaperPayload,
      wallpaperInitial,
    );
    const session: WizardSession = {
      form: {
        itemId,
        itemName,
        description,
        resourceType,
        tagsInput,
        paidType,
        authors,
        links,
        previews,
        icon,
        cover,
        downloads,
        trialDownloads,
        enableAstroBoxCreatorFeatures,
        extRaw,
      },
      wallpaperPayload,
    };
    saveWizardSession(session);
    navigate("/publish/wallpaper", {
      state: {
        wallpaperInitial: editorInitial,
        title: itemName,
        returnPath: isEditMode ? "/publish/edit" : "/new-resource",
        editContext,
      },
    });
  }, [
    authors,
    cover,
    description,
    downloads,
    editContext,
    enableAstroBoxCreatorFeatures,
    extRaw,
    icon,
    isEditMode,
    itemId,
    itemName,
    links,
    navigate,
    paidType,
    previews,
    resourceType,
    tagsInput,
    trialDownloads,
    wallpaperInitial,
    wallpaperPayload,
  ]);

  const steps = useMemo(() => {
    const step1Done = repoStatus === "success" || prStatus === "success";
    const step2Done = repoStatus === "success" || prStatus === "success";
    const step3Done = prStatus === "success";

    return [
      {
        label: "填写基础信息",
        status: step1Done
          ? "done"
          : activeStepIndex === 0
            ? "active"
            : "pending",
      },
      {
        label: "创建发布仓库",
        status: step3Done
          ? "done"
          : step2Done
            ? "done"
            : activeStepIndex === 1
              ? "active"
              : "pending",
      },
      {
        label: "提交 Pull Request",
        status: step3Done
          ? "done"
          : activeStepIndex === 2
            ? "active"
            : "pending",
      },
    ] as const;
  }, [activeStepIndex, prStatus, repoStatus]);

  useEffect(() => {
    if (isEditing || activeStepIndex !== 1) return;
    if (userReposLoading || userRepos.length > 0) return;
    const token = loadAccountState().github?.token;
    const username = loadAccountState().github?.username;
    if (!token) return;
    const fetchId = ++userReposFetchIdRef.current;
    setUserReposLoading(true);
    listCurrentUserRepos(token, username)
      .then((repos) => {
        if (fetchId !== userReposFetchIdRef.current) return;
        setUserRepos(
          [...repos].sort((a, b) => {
            const aResource = isAstroBoxResourceRepo(a) ? 0 : 1;
            const bResource = isAstroBoxResourceRepo(b) ? 0 : 1;
            if (aResource !== bResource) return aResource - bResource;
            return b.updatedAt.localeCompare(a.updatedAt);
          }),
        );
      })
      .catch(() => {
        if (fetchId === userReposFetchIdRef.current) setUserRepos([]);
      })
      .finally(() => {
        if (fetchId === userReposFetchIdRef.current) {
          setUserReposLoading(false);
        }
      });
  }, [activeStepIndex, isEditing, userRepos.length, userReposLoading]);

  const addLog = (message: string) => {
    setUploadLogs((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} ${message}`,
    ]);
    log.info("upload/progress", message);
  };

  const handleUploadToRepo = async (
    options: { skipUnpaidEncryptionCheck?: boolean } = {},
  ) => {
    if (missingEditContext) {
      setRepoStatus("error");
      setRepoMessage("缺少编辑上下文，请从资源列表重新进入。");
      setRepoOccupiedResource(null);
      reportFailure("publish/upload", "缺少编辑上下文，请从资源列表重新进入。");
      return;
    }
    const mode = editContext?.mode ?? "new";
    setRepoStatus("loading");
    setRepoMessage(
      mode === "new" ? "正在创建仓库并上传文件..." : "正在更新仓库文件...",
    );
    setRepoOccupiedResource(null);
    setUploadLogs([]);
    log.info("upload/repo", `开始${mode === "new" ? "创建仓库并上传" : "更新仓库文件"}`, {
      data: { itemId, itemName, resourceType },
    });
     try {
       if (extError) {
         throw new Error(extError);
       }
       if (publishValidation.errors.length) {
         throw new Error(publishValidation.errors[0]);
       }
       if (!manifestResult.manifestJson) {
        throw new Error("缺少 manifest 数据，请先填写必要字段。");
      }

      const token = loadAccountState().github?.token;
      if (!token) {
        throw new Error("GitHub 未登录，无法上传文件。");
      }

      // 加密了却没在同一资源 ID 下配 SKU，服务端会当成免费资源发放密钥，先让创作者确认。
      if (!options.skipUnpaidEncryptionCheck) {
        setRepoMessage("正在检查加密包体的付费配置...");
        const unpaid = await checkUnpaidEncryption(
          itemId,
          encryptedDownloadDevices(downloads),
          { migratingFromId: idMigration?.fromId },
        );
        if (unpaid.status !== "ok") {
          log.warn("upload/repo", "加密包体未配置 SKU，等待确认", {
            data: {
              itemId,
              status: unpaid.status,
              deviceIds: unpaid.deviceIds,
            },
          });
          setUnpaidEncryptionWarning(unpaid);
          setRepoStatus("idle");
          setRepoMessage("");
          return;
        }
      }

      if (resourceType === "watchface") {
        const formatError = validateWatchfaceIdFormat(itemId);
        if (formatError) throw new Error(formatError);
      }

      // 目录 ID 占用校验：所有资源类型都查（表盘原来就有；其余类型在
      // 「改 ID 后重传」场景同样可能撞上目录里已合入的资源）。自身的
      // 原 ID 不算冲突，这样已发布资源正常更新不会被误拦。
      //
      // 每次上传前都重新拉一次 index_v2.csv（githubFetch 已对 GET 禁用
      // HTTP 缓存），不复用组件挂载时的 existingCatalogIds 状态——创作者
      // 可能长时间停留在页面上，期间目录里的资源被删掉后，旧缓存会误判
      // 成仍被占用。这份数据随后也用于判断同名仓库是不是历史残留。
      const nextId = itemId.trim();
      const catalogIds = await fetchExistingCatalogIds(token);
      setExistingCatalogIds(catalogIds);
      if (nextId) {
        const existingName = catalogIds.get(nextId);
        if (existingName && nextId !== editContext?.catalog.entry.id.trim()) {
          throw new Error(
            `资源 ID "${nextId}" 已被「${existingName}」占用，请更换一个。`,
          );
        }
      }

      if (mode === "new") {
        setRepoMessage("正在检查目标仓库是否已包含资源配置...");
        const repoName =
          repoNameInput.trim() ||
          buildRepoName(itemId || itemName || "resource");
        const existingManifest = await findExistingResourceManifest(
          token,
          repoName,
        );
        if (existingManifest) {
          const occupiedId = existingManifest.id?.trim() ?? "";
          // 仓库里的 manifest 只是历史残留：资源已经从 index_v2.csv
          // 删除后，同名仓库不应再拦新资源。没有 id 无法核对时保守拦截。
          const stillIndexed = occupiedId
            ? Array.from(catalogIds.keys()).some(
                (id) => id.toLowerCase() === occupiedId.toLowerCase(),
              )
            : true;
          if (stillIndexed) {
            const label = formatOccupiedResourceLabel(existingManifest);
            throw new RepoOccupiedError(
              `仓库 ${repoName} 已经在 AstroBox 的软件索引里，被资源「${label}」占用，请更换仓库名。`,
              { id: existingManifest.id, name: existingManifest.name },
            );
          }
          log.info(
            "upload/repo",
            `仓库 ${repoName} 的旧资源 ${occupiedId} 已不在索引中，允许复用`,
            { data: { repoName, occupiedId } },
          );
        }
        const repo = await flowSpan("upload/repo", "创建仓库并上传 manifest 与资产", () =>
          uploadManifestAndAssets({
            manifest: manifestResult,
            itemId,
            itemName,
            description,
            token,
            repoNameOverride: repoNameInput.trim() || undefined,
            onProgress: addLog,
          }),
        );
        setRepoInfo(repo);
        setLastManifest(manifestResult);
        setRepoStatus("success");
        setRepoMessage("");
        setRepoOccupiedResource(null);
        toast.success("仓库创建成功，文件已上传。");
        addLog(`仓库：${repo.owner}/${repo.name} @ ${repo.commitSha.slice(0, 7)}`);
        addLog(`仓库地址：${repo.htmlUrl}`);
        log.info("upload/repo", "仓库上传完成", {
          data: { owner: repo.owner, name: repo.name, commitSha: repo.commitSha },
        });
        return;
      }

      const targetRepo: RepoInfo | null =
        repoInfo ||
        (editContext
          ? {
              owner: editContext.catalog.entry.repo_owner,
              name: editContext.catalog.entry.repo_name,
              branch: MAIN_RESOURCE_BRANCH,
            }
          : null);
      if (!targetRepo) {
        throw new Error("未找到可更新的仓库信息。");
      }

      const repo = await flowSpan("upload/repo", "更新仓库 manifest 与资产", () =>
        upsertManifestAndAssets({
          manifest: manifestResult,
          repo: targetRepo,
          token,
          onProgress: addLog,
        }),
      );
      setRepoInfo(repo);
      setLastManifest(manifestResult);
      setRepoStatus("success");
      setRepoMessage("");
      setRepoOccupiedResource(null);
      toast.success("仓库文件更新成功。");
      log.info("upload/repo", "仓库更新完成", {
        data: { owner: repo.owner, name: repo.name, commitSha: repo.commitSha },
      });
    } catch (error) {
      setRepoStatus("error");
      setRepoMessage((error as Error).message);
      setRepoOccupiedResource(
        error instanceof RepoOccupiedError ? error.resource : null,
      );
      reportFailure("publish/upload", `上传失败：${(error as Error).message}`, error, {
        data: { step: "uploadToRepo", itemId, resourceType },
      });
    }
  };

  const offerVersionReset = canOfferVersionReset(editContext);

  // PR 创建 / 更新成功后登记本次推送的新版本选项，绑定这次会上线的 commit。
  // 每次推送都同步一次（两项都不选即撤销之前登记的）；登记失败不影响已提交的 PR。
  const registerVersionResetForPush = async (commitSha: string) => {
    if (!offerVersionReset) return;
    const selected = hasVersionResetSelection(versionReset);
    try {
      await flowSpan("pr/version-reset", "登记新版本选项", () =>
        registerVersionResetIntent({
          // 换了 ID 时登记在旧 ID 上：新 ID 合入前服务端还认不出作者，
          // 合入后这条登记会随迁移一起搬到新 ID。
          id: idMigration?.fromId ?? itemId.trim(),
          commitSha,
          resetRatings: versionReset.resetRatings,
          foldComments: versionReset.foldComments,
        }),
      );
      if (selected) {
        toast.success("已登记新版本选项，审核通过、新版本上线后执行。");
      }
    } catch (error) {
      log.warn("pr/version-reset", `登记新版本选项失败：${(error as Error).message}`, {
        data: { itemId, commitSha, ...versionReset },
      });
      if (selected) {
        toast.error(
          `新版本选项登记失败：${(error as Error).message}。PR 已提交，可重新进入编辑并更新 PR 以重试。`,
        );
      }
    }
  };

  const handleCreatePR = async () => {
    if (missingEditContext) {
      setPrStatus("error");
      setPrMessage("缺少编辑上下文，请从资源列表重新进入。");
      reportFailure("publish/pr", "缺少编辑上下文，请从资源列表重新进入。");
      return;
    }
     const mode = editContext?.mode ?? "new";
     if (publishValidation.errors.length) {
       setPrStatus("error");
       setPrMessage(publishValidation.errors[0]);
       reportFailure("publish/pr", publishValidation.errors[0]);
       return;
     }
     if (!repoInfo) {
      setPrStatus("error");
      setPrMessage("请先完成仓库创建与文件上传。");
      reportFailure("publish/pr", "请先完成仓库创建与文件上传。");
      return;
    }
    if (!repoInfo.commitSha) {
      setPrStatus("error");
      setPrMessage("未获取到仓库提交哈希，请重新执行步骤 2。");
      reportFailure("publish/pr", "未获取到仓库提交哈希，请重新执行步骤 2。");
      return;
    }
    setPrStatus("loading");
    setPendingConflictPr(null);
    setPrMessage(
      mode === "in_progress"
        ? "正在更新已有 PR..."
        : "正在创建 Pull Request...",
    );
    log.info("pr/submit", `开始${mode === "in_progress" ? "更新已有 PR" : "创建 Pull Request"}`, {
      data: {
        itemId,
        itemName,
        repoOwner: repoInfo.owner,
        repoName: repoInfo.name,
        commitSha: repoInfo.commitSha,
      },
    });
    try {
      const token = loadAccountState().github?.token;
      if (!token) throw new Error("GitHub 未登录，无法提交 PR。");

      if (resourceType === "watchface") {
        const formatError = validateWatchfaceIdFormat(itemId);
        if (formatError) throw new Error(formatError);
      }

      // 继续编辑首次提交 PR 时允许改资源 ID：提交前确认新 ID 没有撞上
      // 目录里已合入的资源（步骤 2 的校验只覆盖了重传路径）。
      if (
        mode === "in_progress" &&
        editContext &&
        itemId.trim() !== editContext.catalog.entry.id.trim()
      ) {
        const ids = await fetchExistingCatalogIds(token);
        setExistingCatalogIds(ids);
        const existingName = ids.get(itemId.trim());
        if (existingName) {
          throw new Error(
            `资源 ID "${itemId.trim()}" 已被「${existingName}」占用，请更换一个。`,
          );
        }
      }
      const uploadedId = JSON.parse(
        (lastManifest ?? manifestResult).manifestJson,
      ).item?.id?.trim();
      if (uploadedId !== itemId.trim()) {
        throw new Error("资源 ID 已变更，请重新上传仓库文件后再提交 PR。");
      }

      // 用 parseTagText 而非只按分号切分：与界面上展示的标签保持一致，
      // 否则含逗号的标签进目录条目时会被拆成两个。
      const tags = parseTagText(tagsInput);
      const pushIssues = validatePushQuality(description, tags);
      if (pushIssues.length > 0) {
        throw new Error(pushIssues.map((issue) => issue.message).join("；"));
      }

      // 试用包体也代表资源支持的设备，必须一起写进目录 CSV 的 devices；
      // 只取正式下载会把只在试用包里出现的设备漏掉。
      const selectedDevices = collectCatalogDevices(
        [downloads, trialDownloads],
        deviceVendorById,
      );

      const manifestForCatalog = lastManifest ?? manifestResult;
      const useStaging = true;
      const prBodyContent = prBody.trim();
      const catalogEntry = {
        id: itemId.trim(),
        name: itemName.trim(),
        restype: resourceType,
        repo_owner: repoInfo.owner,
        repo_name: repoInfo.name,
        repo_commit_hash: repoInfo.commitSha.slice(0, 7),
        icon: manifestForCatalog.iconPath,
        cover: manifestForCatalog.coverPath,
        tags: tags.join(";"),
        device_vendors: Array.from(
          new Set(selectedDevices.map((d) => d.vendor).filter(Boolean)),
        ).join(";"),
        devices: Array.from(new Set(selectedDevices.map((d) => d.id))).join(
          ";",
        ),
        paid_type: effectivePaidType?.trim() ?? "",
      };

      // 已上架资源换了 ID：先在服务端登记，PR 合入后旧 ID 上的下载量、评分、评论、付费配置
      // 与购买记录才会搬到新 ID。登记不上就不提交，免得合入后这些数据全留在旧 ID 上。
      if (idMigration) {
        try {
          await flowSpan("pr/id-migration", "登记资源 ID 迁移", () =>
            registerIdMigrationIntent(idMigration),
          );
        } catch (error) {
          throw new Error(
            `资源 ID 迁移登记失败（${idMigration.fromId} → ${idMigration.toId}）：${(error as Error).message}`,
          );
        }
      }

      if (mode === "in_progress") {
        const prHead = editContext?.prHead;
        if (!editContext || !prHead) {
          throw new Error("缺少 PR 分支信息，无法更新。");
        }
        const submission = editContext.submission;

        // 更新已关闭的 PR 之前必须先让它重新打开。
        // 组织成员可以直接重开；外部贡献者对目标仓库只有读权限，GitHub 会返回一个
        // 不含任何明细的 422，此时改为发 [ABCC_REOPEN] 评论，由仓库侧 GitHub Actions
        // 用仓库自己的 token 代为重开（见 AstroBox-Repo 的 resource-submissions.yml）。
        // 万一 Actions 没能在超时内完成（服务异常等），退化为用同一分支新建一个 PR，
        // 避免这次提交丢失，也避免让创作者反复手动重开。
        let prNumber = editContext.prNumber;
        let reuseExistingPr = true;
        let createdNewPr = false;
        // 需要等仓库代重开的 PR 编号。真正的确认放到分支更新之后再做，
        // 让「同步分支 + 更新提交条目」这段时间去覆盖 Action 的重开耗时。
        let pendingReopenPr: number | null = null;
        if (editContext.prState === "closed" && prNumber) {
          const closedPrNumber = prNumber;
          let reopenedBySelf = false;
          try {
            await flowSpan("pr/reopen", "重新打开已关闭的 PR", () =>
              reopenPullRequest(closedPrNumber),
            );
            reopenedBySelf = true;
          } catch (error) {
            // 422 表示服务端拒绝：多数情况是没有写权限，也可能是分支被强推或删除
            // 导致该 PR 不可重开。两种情况都先交给仓库侧 Action 试一次。
            if (!isGithubStatus(error, 422)) throw error;
            log.warn("pr/reopen", "无法直接重开该 PR，改为请求仓库代重开", {
              data: { prNumber: closedPrNumber, status: 422 },
            });
          }

          await flowSpan("pr/comment", "发送 [ABCC_REOPEN] 评论", () =>
            createPullRequestComment(
              closedPrNumber,
              reopenedBySelf
                ? "[ABCC_REOPEN] 创作者已重新打开此 PR 并提交更新。"
                : "[ABCC_REOPEN] 创作者请求重新打开此 PR 并提交更新。",
            ),
          );

          if (!reopenedBySelf) {
            // 这里只登记、不等待：确认挪到分支更新之后（见下方 pr/reopen-wait）。
            pendingReopenPr = closedPrNumber;
          }
        }

        await flowSpan("pr/sync", "同步 PR 分支与上游", () =>
          syncBranchWithUpstream({
            token,
            forkOwner: prHead.owner,
            forkRepo: prHead.repo,
            targetBranch: prHead.ref,
          }),
        );

        if (useStaging) {
          if (!submission) {
            throw new Error("缺少新流程提交信息，无法更新现有 PR。");
          }
          await flowSpan("pr/update-entry", "更新分支上的提交明细", () =>
            updateSubmissionEntryOnBranch({
              token,
              owner: prHead.owner,
              repo: prHead.repo,
              branch: prHead.ref,
              entry: catalogEntry,
              request: submission.request,
              submissionPath: submission.path,
            }),
          );
        } else {
          await flowSpan("pr/update-entry", "更新分支上的目录条目", () =>
            updateCatalogEntryOnBranch({
              token,
              owner: prHead.owner,
              repo: prHead.repo,
              branch: prHead.ref,
              intent: {
                mode: "edit",
                originalId: editContext.catalog.entry.id,
              },
              entry: catalogEntry,
            }),
          );
        }

        // 更新已经写进分支，这时再确认 PR 是否已被仓库重开。开火发生在上传之前，
        // 中间的「同步分支 + 更新条目」已经耗掉几秒，正常情况这里第一次查询就是 open，
        // 用户几乎不用等；只有 Action 真的异常才用满 20s 预算并落到下面的新建 PR 兜底。
        if (pendingReopenPr) {
          const reopened = await flowSpan(
            "pr/reopen-wait",
            "确认 PR 已被重新打开",
            () =>
              waitForPullRequestOpen(pendingReopenPr as number, {
                timeoutMs: 20_000,
              }),
          );
          if (!reopened) {
            log.warn("pr/reopen", "仓库未能在超时内重开 PR，改为新建 PR", {
              data: { prNumber: pendingReopenPr },
            });
            reuseExistingPr = false;
          }
        }

        // Actions 未能在超时内重开原 PR：用同一分支新建 PR 兜底，保证更新可被审核。
        if (!reuseExistingPr) {
          const nextPrTitle = buildResourcePrTitle({
            currentTitle: editContext.prTitle,
            itemName,
            itemId,
          });
          const created = await flowSpan("pr/create", "用同一分支新建 PR", () =>
            createSubmissionPullRequest({
              forkOwner: prHead.owner,
              forkRepo: prHead.repo,
              branch: prHead.ref,
              token,
              title: nextPrTitle,
              body: prBodyContent || undefined,
            }),
          );
          prNumber = created?.number;
          if (!prNumber) {
            throw new Error("原 PR 无法重开，新建 PR 也未返回编号。");
          }
          createdNewPr = true;
          log.info("pr/create", `原 PR 无法重开，已新建 PR #${prNumber}`, {
            data: { prNumber, prUrl: created?.html_url, branch: prHead.ref },
          });
        }

        // 资源标题可能已被修改：同步刷新 PR 标题，避免评审列表仍显示旧名称。
        // 保留原 PR 的「Add new resource / Update resource」动作前缀语义。
        // 退化为新建 PR 时，标题在上面建 PR 时就已给定，这里只处理复用原 PR 的情况。
        const previousName = (editContext.catalog.entry.name || "").trim();
        if (
          reuseExistingPr &&
          itemName.trim() &&
          itemName.trim() !== previousName &&
          prNumber
        ) {
          const nextPrTitle = buildResourcePrTitle({
            currentTitle: editContext.prTitle,
            itemName,
            itemId,
          });
          if (nextPrTitle !== editContext.prTitle?.trim()) {
            await flowSpan("pr/retitle", "同步 PR 标题为最新资源标题", () =>
              updatePullRequestTitle(prNumber as number, nextPrTitle),
            );
            log.info("pr/retitle", "PR 标题已同步资源名称", {
              data: {
                prNumber,
                prTitle: nextPrTitle,
              },
            });
          }
        }

        if (editContext.mode === "in_progress" && prNumber) {
          for (const item of needFixItems) {
            if (!fixedSelections[item.id]) continue;
            const note = (fixedNotes[item.id] || "").trim();
            const tag = `[ABCC_FIXED_${item.id}] ${note}`.trim();
            let body = tag;
            if (item.commentId || item.commentBody) {
              const quoted = (
                item.commentBody ||
                item.message ||
                ""
              )
                .trim()
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n");
              body = `${tag}\n\n> @${item.author?.login || "reviewer"} · 评论 #${
                item.commentId || "?"
              }\n${quoted}`;
            }
            await flowSpan("pr/comment", `发送整改说明评论 [${item.id}]`, () =>
              createPullRequestComment(prNumber as number, body),
            );
          }
        }

        await registerVersionResetForPush(repoInfo.commitSha);
        setPrStatus("success");
        if (createdNewPr) {
          setPrMessage("原 PR 暂时无法重开，已改用新 PR 提交更新。");
          toast.success("更新完成，已提交到新的 PR，记得查看AstroBox信箱和待审核列表。");
          log.info("pr/submit", "已新建 PR 提交更新", { data: { prNumber } });
          reportSuccess("publish/pr", "已新建 PR 提交更新。");
        } else {
          setPrMessage("已更新现有 PR。");
          toast.success("更新完成，记得查看AstroBox信箱和待审核列表查看待审状态。");
          log.info("pr/submit", "已更新现有 PR", { data: { prNumber } });
          reportSuccess("publish/pr", "已更新现有 PR。");
        }
        await endResourceSession(
          "completed",
          `${createdNewPr ? "已新建 PR" : "已更新现有 PR"} #${prNumber ?? "?"}`,
        );
        navigate("/publish", { replace: true });
        return;
      }

      const repoSnapshot = { ...repoInfo, commitSha: repoInfo.commitSha };
      let createdPr: { number?: number; html_url?: string } | undefined;
      if (useStaging) {
        const branchInfo = await flowSpan("pr/branch", "创建提交分支（fork + 同步 + 建分支）", () =>
          createSubmissionBranch({
            repoInfo: repoSnapshot,
            iconPath: manifestForCatalog.iconPath,
            coverPath: manifestForCatalog.coverPath,
            tags,
            devices: selectedDevices,
            itemId,
            itemName,
            restype: resourceType,
            paidType: effectivePaidType,
            intent: editContext
              ? { mode: "edit", originalId: editContext.catalog.entry.id }
              : { mode: "create" },
          }),
        );
        log.info("pr/branch", "提交分支已创建", {
          data: {
            forkOwner: branchInfo.forkOwner,
            forkRepo: branchInfo.forkRepo,
            branch: branchInfo.branch,
          },
        });
        const pr = await flowSpan("pr/create", "创建 Pull Request", () =>
          createSubmissionPullRequest({
            forkOwner: branchInfo.forkOwner,
            forkRepo: branchInfo.forkRepo,
            branch: branchInfo.branch,
            token,
            title: `${editContext ? "[ABCC] Update resource" : "[ABCC] Add new resource"}: ${
              itemName || itemId || "资源"
            }`,
            body: prBodyContent || undefined,
          }),
        );
        createdPr = pr;
        log.info("pr/create", `PR 已创建 #${pr?.number ?? "?"}`, {
          data: { prNumber: pr?.number, prUrl: pr?.html_url, branch: branchInfo.branch },
        });
      } else {
        const branchInfo = await flowSpan("pr/branch", "创建提交分支（legacy 目录）", () =>
          updateCatalogCsv({
            repoInfo: repoSnapshot,
            iconPath: manifestForCatalog.iconPath,
            coverPath: manifestForCatalog.coverPath,
            tags,
            devices: selectedDevices,
            itemId,
            itemName,
            restype: resourceType,
            paidType: effectivePaidType,
            intent: editContext
              ? { mode: "edit", originalId: editContext.catalog.entry.id }
              : { mode: "create" },
          }),
        );

        const pr = await flowSpan("pr/create", "创建目录 PR（legacy）", () =>
          createCatalogPullRequest({
            forkOwner: branchInfo.forkOwner,
            forkRepo: branchInfo.forkRepo,
            branch: branchInfo.branch,
            token,
            title: `${editContext ? "[ABCC] Update resource" : "[ABCC] Add new resource"}: ${
              itemName || itemId || "资源"
            }`,
            body: prBodyContent || undefined,
          }),
        );
        createdPr = pr;
        log.info("pr/create", `PR 已创建 #${pr?.number ?? "?"}`, {
          data: { prNumber: pr?.number, prUrl: pr?.html_url, branch: branchInfo.branch },
        });
      }

      await registerVersionResetForPush(repoInfo.commitSha);
      setPrStatus("success");
      setPrMessage("PR 已创建，请在 GitHub 查看。");
      toast.success("更新完成，记得查看AstroBox信箱和待审核列表查看待审状态。");
      reportSuccess("publish/pr", "PR 已创建，可在审核列表中跟踪进度。");
      await endResourceSession(
        "pr_created",
        `PR #${createdPr?.number ?? "?"}${createdPr?.html_url ? ` ${createdPr.html_url}` : ""}`,
      );
      navigate("/publish", { replace: true });
    } catch (error) {
      setPrStatus("error");
      setPrMessage((error as Error).message);
      setPendingConflictPr(
        error instanceof PendingSubmissionConflictError
          ? {
              number: error.conflict.prNumber,
              title: error.conflict.prTitle,
              samePath: error.conflict.samePath,
            }
          : null,
      );
      reportFailure("publish/pr", `提交失败：${(error as Error).message}`, error, {
        data: { step: "createPR", itemId, resourceType, mode },
      });
    }
  };

  /** 打开冲突 PR 继续编辑；同路径重复提交时直接回到原 PR 的编辑流程。 */
  const handleOpenPendingConflictPr = async () => {
    const target = pendingConflictPr;
    if (!target) return;
    const token = loadAccountState().github?.token;
    if (!token) {
      toast.error("GitHub 未登录，无法打开该 PR。");
      return;
    }
    try {
      const opened = await buildInProgressEditContextFromPr({
        prNumber: target.number,
        token,
      });
      const username = loadAccountState().github?.username?.trim().toLowerCase();
      const author = opened.authorLogin?.trim().toLowerCase();
      if (username && author && author !== username) {
        toast.warning(
          `PR #${target.number} 由 ${opened.authorLogin} 提交，请等待其处理完成后再编辑。`,
        );
        return;
      }
      toast.info("你正在编辑一个处于审核队列中的资源，提交后会更新原 PR。");
      navigate("/publish/edit", { state: { editContext: opened } });
    } catch (error) {
      toast.error((error as Error).message || "打开 PR 失败");
    }
  };


  // --- Draft system ---
  const handleAddBundledResources = useCallback(
    (items: BundledResourceInput[]) => {
      setBundledResources((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        for (const item of items) {
          const id = item.id.trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          merged.push({
            mode: item.mode === "recommend" ? "recommend" : "required",
            type: item.type === "plugin" ? "plugin" : "resource",
            id,
            name: item.name,
          });
        }
        return merged;
      });
    },
    [],
  );

  const handleToggleBundledResourceMode = useCallback(
    (id: string, mode: BundledResourceInput["mode"]) => {
      setBundledResources((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, mode: mode === "recommend" ? "recommend" : "required" }
            : item,
        ),
      );
    },
    [],
  );

  const handleRemoveBundledResource = useCallback((id: string) => {
    setBundledResources((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const [draftList, setDraftList] = useState<PublishDraft[]>([]);
  const [draftPopoverOpen, setDraftPopoverOpen] = useState(false);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [autoSavePromptOpen, setAutoSavePromptOpen] = useState(false);
  const [autoSavedData, setAutoSavedData] = useState<{
    formData: PublishDraftFormData;
    savedAt: number;
  } | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildFormData = useCallback(async (): Promise<PublishDraftFormData> => {
    const [
      serializedPreviews,
      serializedIcon,
      serializedCover,
      serializedDownloads,
      serializedTrialDownloads,
    ] = await Promise.all([
      Promise.all(previews.map(serializeMediaItem)).then((items) =>
        items.filter((item): item is DraftMediaItem => item !== null),
      ),
      serializeMediaItem(icon),
      serializeMediaItem(cover),
      serializeDownloadInputs(downloads),
      serializeDownloadInputs(trialDownloads),
    ]);
    const draftWallpaperInitial = resolveWallpaperEditorInitial(
      wallpaperPayload,
      wallpaperInitial,
    );
    const draftWallpaperConfigJson = wallpaperPayload.configJson.trim()
      ? wallpaperPayload.configJson
      : draftWallpaperInitial
        ? JSON.stringify(draftWallpaperInitial.config, null, 2)
        : "";
    const draftWallpaperAssets = wallpaperPayload.configJson.trim()
      ? wallpaperPayload.assets
      : (draftWallpaperInitial?.assets ?? []);
    return {
      sessionFile: getActiveResourceSession()?.fileName,
      itemId,
      itemName,
      description,
      resourceType,
      tagsInput,
      paidType,
      authors,
      links,
      previews: serializedPreviews,
      icon: serializedIcon,
      cover: serializedCover,
      downloads: serializedDownloads,
      trialDownloads: serializedTrialDownloads,
      bundledResources,
      enableAstroBoxCreatorFeatures,
      extRaw,
      wallpaperConfigJson: draftWallpaperConfigJson,
      wallpaperAssets: await Promise.all(
        draftWallpaperAssets.map(serializeWallpaperAsset),
      ),
      wallpaperBaseUrl: draftWallpaperInitial?.baseUrl ?? "",
    };
  }, [itemId, itemName, description, resourceType, tagsInput, paidType, authors, links, downloads, trialDownloads, bundledResources, enableAstroBoxCreatorFeatures, extRaw, previews, icon, cover, wallpaperInitial, wallpaperPayload]);

  /**
   * 包体导入：校验结构，并把包内 ID 改写成资源 ID。
   *
   * 改写放在导入而不是发布有两个原因：创作者在导入那一刻还能换包，等包体
   * 已经在上传就来不及了；行里存改写后的包体，发布时只剩上传，不会二次改写
   * 产生与导入时不同的字节。
   *
   * themeId 与资源 ID 不一致不算错——那正是要改写的内容，真正的拦截点是结构
   * 合法性、legacy 清单名与 TSV 预算。但预算必须按目标 themeId 复算一遍：
   * id 变长会推高每条规则开销，可能从「不超」变成「超」。
   */
  const validateSelectedPackage = useCallback(
    async (file: File): Promise<ValidatedPackage> => {
      const info = await readPackageVersion(file);
      const target = itemId.trim();
      if (resourceType === "res_pack") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const current = readCrpackThemeId(bytes);
        const expect = target || current;
        const probe =
          expect && current !== expect
            ? rewriteCrpackCorona(bytes, { themeId: expect })
            : bytes;
        const errors = validateCrpack(probe, expect || undefined);
        if (errors.length > 0) {
          // toast 不保留换行，且畸形包可能有几十条错误，这里只列前几条。
          const shown = errors.slice(0, 3).join("；");
          const rest = errors.length > 3 ? `；另有 ${errors.length - 3} 项` : "";
          const scope = expect && current !== expect ? `按资源 ID「${expect}」复算后` : "";
          throw new Error(`资源包 ${file.name} ${scope}校验不通过：${shown}${rest}`);
        }
        // 目标 ID 为空（创作者还没填资源 ID）时不改写，留给发布时兜底。
        if (current && target && current !== target) {
          const rewritten = rewriteCrpackCorona(bytes, { themeId: target });
          const rewrittenFile = new File([rewritten as BlobPart], file.name, {
            type: file.type || "application/octet-stream",
            lastModified: file.lastModified,
          });
          toast.warning(
            `包体 ${file.name} 内资源包 ID 已从「${current}」改为「${target}」，请确认上传的是本资源对应的包体。`,
            { duration: 8000 },
          );
          return { info: await readPackageVersion(rewrittenFile), file: rewrittenFile };
        }
        return { info, file };
      }
      // 表盘的包内 ID 也在导入时改写，发布时只剩上传。
      if (resourceType === "watchface" && target) {
        const inPackId = info.identityKind === "watchface-id" ? info.identity : undefined;
        if (inPackId && inPackId !== target) {
          const rewritten = await replaceWatchfaceIdInPackage(file, target);
          const after = await readPackageVersion(rewritten);
          toast.warning(
            `包体 ${file.name} 内表盘 ID 已从「${inPackId}」改为「${target}」，请确认上传的是本资源对应的包体。`,
            { duration: 8000 },
          );
          return { info: after, file: rewritten };
        }
      }
      return { info, file };
    },
    [resourceType, itemId],
  );

  const refreshPackageVersions = useCallback(
    async (rows: DownloadInput[]): Promise<DownloadInput[]> =>
      Promise.all(
        rows.map(async (row) => {
          const upload = row.file;
          if (!upload || upload.skipUpload || !upload.file?.size) return row;
          const info = await readPackageVersion(upload.file);
          if (!info.readable) return row;
          return {
            ...row,
            version: info.version ?? row.version,
            versionCode: info.versionCode ?? row.versionCode,
            versionLocked: true,
            versionSource: "package" as const,
            packageHash: await computePackageHash(upload.file),
            packageIdentity: info.identity,
            packageIdentityKind: info.identityKind,
            packageWritable: info.writable,
            canopus: info.canopus,
          };
        }),
      ),
    [],
  );

  const restoreFormData = useCallback((data: PublishDraftFormData) => {
    setItemId(data.itemId);
    idsByTypeRef.current[data.resourceType] = data.itemId;
    setItemName(data.itemName);
    setDescription(data.description);
    setResourceType(data.resourceType);
    setTagsInput(data.tagsInput);
    setPaidType(data.paidType);
    setAuthors(withBoundFirstAuthor(data.authors));
    setLinks(data.links);
    setPreviews(
      (data.previews ?? [])
        .map(restoreMediaItem)
        .filter((item): item is UploadItem => Boolean(item)),
    );
    setIcon(restoreMediaItem(data.icon));
    setCover(restoreMediaItem(data.cover));
    const restoredDownloads = (data.downloads ?? []).map(restoreDownloadInput);
    const restoredTrialDownloads = (data.trialDownloads ?? []).map(
      restoreDownloadInput,
    );
    setDownloads(restoredDownloads);
    setTrialDownloads(restoredTrialDownloads);
    void refreshPackageVersions(restoredDownloads).then(setDownloads);
    void refreshPackageVersions(restoredTrialDownloads).then(setTrialDownloads);
    setBundledResources(
      (Array.isArray(data.bundledResources) ? data.bundledResources : [])
        .map((item) => ({
          mode: item.mode === "recommend" ? ("recommend" as const) : ("required" as const),
          type: item.type === "plugin" ? ("plugin" as const) : ("resource" as const),
          id: String(item.id ?? ""),
          name: item.name,
        }))
        .filter((item) => item.id),
    );
    setEnableAstroBoxCreatorFeatures(data.enableAstroBoxCreatorFeatures);
    setExtRaw(data.extRaw);
    const restoredWallpaperPayload = {
      configJson: data.wallpaperConfigJson ?? "",
      assets: (data.wallpaperAssets ?? []).map(restoreWallpaperAsset),
    };
    setWallpaperPayload(restoredWallpaperPayload);
    setWallpaperInitial(
      parseWallpaperEditorInitial(
        restoredWallpaperPayload.configJson,
        restoredWallpaperPayload.assets,
        data.wallpaperBaseUrl ?? "",
      ),
    );
  }, [refreshPackageVersions]);

  // Auto-save debounce
  useEffect(() => {
    if (isEditMode || previewUploading) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void buildFormData()
        .then(autoSaveDraft)
        .catch((error) => {
          console.warn("[draft] 构建草稿数据失败", error);
        });
    }, 1000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [buildFormData, isEditMode, previewUploading]);

  // Check for auto-saved draft on mount
  useEffect(() => {
    if (isEditMode) return;
    if (restoredFromSessionRef.current) return;
    void loadAutoSavedDraft().then((saved) => {
      if (saved && saved.formData.itemName) {
        setAutoSavedData(saved);
        setAutoSavePromptOpen(true);
      }
    });
  }, [isEditMode]);

  const handleSaveDraft = async () => {
    const name = draftName.trim() || itemName || "未命名草稿";
    try {
      const data = await buildFormData();
      await saveDraft(name, data);
      setDraftName("");
      setSaveDraftOpen(false);
      setDraftList(await listDrafts());
    } catch (error) {
      console.warn("[draft] 保存草稿失败", error);
      toast.error(`保存草稿失败：${(error as Error).message}`);
    }
  };

  const handleRestoreDraft = (draft: PublishDraft) => {
    restoreFormData(draft.formData);
    void resumeSessionFromDraft(draft.formData.sessionFile);
    setDraftPopoverOpen(false);
  };

  const resumeSessionFromDraft = async (sessionFile?: string) => {
    if (!sessionFile) return;
    const current = getActiveResourceSession();
    if (current && current.fileName === sessionFile) return;
    await resumeResourceSession(sessionFile, isEditMode ? "edit" : "publish", {
      itemId,
      itemName,
    });
  };

  const handleDeleteDraft = async (id: string) => {
    await deleteDraft(id);
    setDraftList(await listDrafts());
  };

  const handleRestoreAutoSave = async () => {
    if (autoSavedData) {
      restoreFormData(autoSavedData.formData);
      await resumeSessionFromDraft(autoSavedData.formData.sessionFile);
    }
    setAutoSavePromptOpen(false);
    await clearAutoSavedDraft();
  };

  const handleDismissAutoSave = async () => {
    setAutoSavePromptOpen(false);
    await clearAutoSavedDraft();
  };

  const formatDraftTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    return d.toLocaleDateString("zh-CN");
  };

  const repoStepMode: "new" | "edit" =
    isEditMode || Boolean(editContext) ? "edit" : "new";
  const prStepMode: "new" | "update" | "reopen" =
    editContext?.mode === "in_progress"
      ? editContext.prState === "closed"
        ? "reopen"
        : "update"
      : "new";
  const needFixItems = useMemo(
    () =>
      editContext?.mode === "in_progress"
        ? (editContext.needs ?? []).filter((item) => !item.fixed)
        : [],
    [editContext],
  );
  const [fixedSelections, setFixedSelections] = useState<Record<string, boolean>>({});
  const [fixedNotes, setFixedNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editContext?.mode !== "in_progress") {
      setFixedSelections({});
      setFixedNotes({});
      return;
    }
    const next: Record<string, boolean> = {};
    const notes: Record<string, string> = {};
    for (const item of needFixItems) {
      next[item.id] = false;
      notes[item.id] = "";
    }
    setFixedSelections(next);
    setFixedNotes(notes);
  }, [editContext, needFixItems]);

  const stepsCard = (
    <div className="flex flex-wrap flex-col gap-6">
      {repoStatus === "success" && repoInfo?.htmlUrl && (
        <div className="flex text-sm gap-1 items-center px-3 font-medium">
          <GitBranchIcon size={16} weight="bold" />
          当前仓库: {repoInfo.name}
        </div>
      )}
      <StepList
        steps={steps.map((s) => ({ ...s, status: s.status }))}
        activeIndex={activeStepIndex}
        onSelect={goToStep}
      />
    </div>
  );

  // Auto-save restore prompt
  const autoSaveDialog = (
    <AutoSaveRestoreDialog
      open={autoSavePromptOpen}
      savedAtLabel={
        autoSavedData ? formatDraftTime(autoSavedData.savedAt) : ""
      }
      onDismiss={handleDismissAutoSave}
      onRestore={handleRestoreAutoSave}
    />
  );

  const versionCodeWarningDialog = (
    <VersionCodeWarningDialog
      rows={versionCodeWarningRows}
      sortedDeviceOptions={sortedDeviceOptions}
      onLocate={(rows) => flashFirstDownloadRow(rows)}
      onClose={() => setVersionCodeWarningRows(null)}
    />
  );

  const unboundAuthorNoticeDialogEl = (
    <UnboundAuthorNoticeDialog
      open={unboundAuthorNoticeDialog !== null}
      detail={unboundAuthorNoticeDialog?.detail ?? ""}
      onLocate={() => {
        skipAuthorNoticeOnceRef.current = false;
        setUnboundAuthorNoticeDialog(null);
        flashPublishField("authors");
      }}
      onContinue={() => {
        const target = unboundAuthorNoticeDialog?.target;
        setUnboundAuthorNoticeDialog(null);
        log.warn("form/authors", "确认在没有作者关联 AstroBox 账号的情况下继续", {
          data: { itemId, target },
        });
        if (target != null) goToStep(target);
      }}
      onClose={() => {
        skipAuthorNoticeOnceRef.current = false;
        setUnboundAuthorNoticeDialog(null);
      }}
    />
  );

  const unpaidEncryptionWarningDialog = (
    <UnpaidEncryptionWarningDialog
      warning={unpaidEncryptionWarning}
      sortedDeviceOptions={sortedDeviceOptions}
      onContinue={() => {
        log.info("upload/repo", "确认在未配置 SKU 的情况下继续上传", {
          data: { itemId, deviceIds: unpaidEncryptionWarning?.deviceIds },
        });
        void handleUploadToRepo({ skipUnpaidEncryptionCheck: true });
      }}
      onClose={() => setUnpaidEncryptionWarning(null)}
    />
  );
  const versionIncrementWarningDialog = (
    <VersionIncrementWarningDialog
      rows={versionIncrementWarning}
      sortedDeviceOptions={sortedDeviceOptions}
      onLocate={(rows) => flashFirstDownloadRow(rows)}
      onClose={() => setVersionIncrementWarning(null)}
    />
  );

  // Draft action buttons
  const draftActions = !isEditing ? (
    <DraftActions
      draftName={draftName}
      draftNamePlaceholder={itemName || "输入草稿名称"}
      onDraftNameChange={setDraftName}
      saveDraftOpen={saveDraftOpen}
      onSaveDraftOpenChange={setSaveDraftOpen}
      onSaveDraft={() => void handleSaveDraft()}
      popoverOpen={draftPopoverOpen}
      onPopoverOpenChange={(open) => {
        setDraftPopoverOpen(open);
        if (open) void listDrafts().then(setDraftList);
      }}
      drafts={draftList}
      formatDraftTime={formatDraftTime}
      onRestoreDraft={handleRestoreDraft}
      onDeleteDraft={(id) => void handleDeleteDraft(id)}
    />
  ) : null;

  if (
    mode === "new" &&
    REQUIRE_ASTROBOX_LOGIN &&
    !accountState.astrobox?.username?.trim()
  ) {
    return (
      <Page>
        <div className="mx-auto max-w-2xl px-2 py-10">
          <Callout.Root color="amber">
            <Callout.Icon>
              <WarningOctagonIcon size={18} weight="fill" />
            </Callout.Icon>
            <Callout.Text>
              发布新资源前需要先登录 AstroBox 账号，以便自动读取作者用户名。
            </Callout.Text>
          </Callout.Root>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      {autoSaveDialog}
      {versionCodeWarningDialog}
      {unboundAuthorNoticeDialogEl}
      {versionIncrementWarningDialog}
      {unpaidEncryptionWarningDialog}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(auto,280px)_1fr] mx-auto max-w-6xl px-2 w-full lg:gap-4 gap-6">
        {/* sticky 偏移要和滚动内容预留的顶部空间一致（app.css 里 app-page-scroll-content
            的 padding-top 为 52px + 0.5rem），否则吸顶后会钻进 Header 的渐进模糊区。 */}
        <div className="publish-steps-sidebar flex flex-col items-start gap-3 lg:flex-none lg:min-w-64 lg:sticky lg:left-0 h-fit select-none">
          <div className="flex flex-col px-3 py-3.5">
            {!isEditing ? (
              <UploadIcon size={24} className="mb-2 text-blue-500" />
            ) : (
              <PencilSimpleLineIcon size={24} className="mb-2 text-blue-500" />
            )}
            <p className="text-lg font-semibold">
              {isEditing ? "编辑资源" : "发布新资源"}
            </p>
            <p className="text-sm text-white/70">
              {isEditing
                ? "更新已提交的资源内容"
                : "向AstroBox资源社区提交新资源"}
            </p>
          </div>
          {stepsCard}
          {draftActions}
          {!isEditing && (
            <div className="mx-3 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs leading-5 text-sky-100">
              如需修改正在审核中的资源，请前往{" "}
              <Link
                to="/publish"
                className="font-medium underline underline-offset-2 transition hover:text-white"
              >
                审核列表
              </Link>
              ，避免重复提交新的发布申请。
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3.5 w-full lg:grow lg:min-w-0 lg:px-3.5 pt-1.5 pb-6">
          {missingEditContext && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              缺少编辑上下文，请从资源列表或发布申请列表重新进入。
            </div>
          )}
          {editContext && (
            <Callout.Root
              color="gray"
              variant="soft"
              highContrast
              className="rounded-[14px]! border border-white/10 bg-nav-item! p-3!"
            >
              <div className="flex items-center gap-2">
                <Callout.Icon>
                  <PencilSimpleLineIcon size={16} />
                </Callout.Icon>
                <Callout.Text>
                  正在编辑：
                  {editContext.catalog.entry.name ||
                    editContext.catalog.entry.id}
                  {editContext.mode === "in_progress" && editContext.prNumber
                    ? `（PR #${editContext.prNumber}）`
                    : ""}
                </Callout.Text>
              </div>

              {editLoading && (
                <div className="flex items-center gap-2">
                  <Callout.Icon>
                    <Spinner size="2" />
                  </Callout.Icon>
                  <Callout.Text className="font-semibold text-white/45">
                    <p>正在载入远端数据</p>
                  </Callout.Text>
                </div>
              )}
              {editContext.mode === "in_progress" &&
                editContext.reviewState === "changes_requested" &&
                activeStepIndex !== 2 &&
                needFixItems.length > 0 && (
                  <div className="mt-2.5 rounded-md border border-amber-400/30 bg-amber-400/5 p-2.5">
                    <div className="mb-2 flex items-center gap-2">
                      <WarningOctagonIcon
                        size={16}
                        weight="fill"
                        className="text-amber-300"
                      />
                      <p className="text-sm font-semibold text-amber-200">
                        需要修改下面{needFixItems.length}项
                      </p>
                    </div>
                    <div className="flex flex-col divide-y divide-white/10">
                      {needFixItems.map((item) => (
                        <div
                          key={item.id}
                          className="min-w-0 py-2 text-sm leading-6 text-white/85 first:pt-0 last:pb-0"
                        >
                          <div
                            className="min-w-0 break-words [&_code]:font-mono [&_code]:text-xs [&_code]:text-amber-300"
                            dangerouslySetInnerHTML={{
                              __html: renderCommentMarkdownInlineHtml(
                                `\`${item.id}\`　${item.message || "（无附加说明）"}`,
                              ),
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    {editContext.prNumber && (
                      <div className="mt-2 flex justify-end">
                        <a
                          href={
                            editContext.prUrl ||
                            `https://github.com/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pull/${editContext.prNumber}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 transition hover:text-blue-300"
                        >
                          到 GitHub 查看审核和评论
                        </a>
                      </div>
                    )}
                  </div>
                )}
            </Callout.Root>
          )}
          {!editContext && editError && isEditMode && (
            <Callout.Root color="red">
              <Callout.Icon>
                <FileXIcon size={18} weight="fill" />
              </Callout.Icon>
              <Callout.Text>加载失败：{editError}</Callout.Text>
            </Callout.Root>
          )}

          {activeStepIndex === 0 && (
            <div className="flex flex-col gap-3">
              <BasicInfoSection
                itemId={itemId}
                itemName={itemName}
                description={description}
                tags={tags}
                tagInput={tagInput}
                paidType={effectivePaidType}
                resourceType={resourceType}
                idError={idError}
                idGenerating={idGenerating}
                idReadOnly={identityLocks.idLocked}
                typeReadOnly={identityLocks.typeLocked}
                listedIdLocked={
                  isEditing && !canEditIdentity && identityLocks.idLocked
                }
                idMigration={idMigration}
                onItemIdChange={(value) => {
                  handleItemIdChange(value);
                  logFieldChange("itemId", "资源 ID", value);
                }}
                onItemIdBlur={() => {
                  const token = loadAccountState().github?.token;
                  if (!token) return;
                  // 失焦时刷新一次目录占用数据：页面可能已停留很久，
                  // 期间资源被删除后旧缓存会把 ID 误报成仍被占用。
                  void fetchExistingCatalogIds(token)
                    .then((ids) => setExistingCatalogIds(ids))
                    .catch(() => {});
                }}
                onItemNameChange={(value) => {
                  setItemName(value);
                  logFieldChange("itemName", "资源名称", value);
                }}
                onDescriptionChange={(value) => {
                  setDescription(value);
                  logFieldChange("description", "资源描述", value);
                }}
                onAddTag={addTag}
                onRemoveTag={removeTag}
                onTagInputChange={(value) => {
                  setTagInput(value);
                  logFieldChange("tagInput", "标签输入", value);
                }}
                onPaidTypeChange={(value) => {
                  setPaidType(value);
                  log.info("form/paidType", `付费类型: ${value || "(未设置)"}`);
                }}
                onResourceTypeChange={(next) => {
                  handleResourceTypeChange(next);
                  log.info("form/resourceType", `资源类型: ${next}`);
                }}
                onGenerateId={handleGenerateId}
              />
              <MediaSection
                previews={previews}
                previewUploading={previewUploading}
                previewProcessingId={previewProcessingId}
                icon={icon}
                iconUploading={iconUploading}
                cover={cover}
                onPreviewUpload={handlePreviewUpload}
                onRemovePreview={handleRemovePreview}
                onReorderPreview={handleReorderPreview}
                onMovePreviewToSlot={handleMovePreviewToSlot}
                onIconUpload={handleIconUpload}
                onCoverUpload={handleCoverUpload}
                 onRemoveIcon={handleRemoveIcon}
                 onRemoveCover={handleRemoveCover}
                 onMediaDimensions={handleMediaDimensions}
               />
              {/* defaultAuthorName 在编辑模式同样下发：manifest 里回填的署名可能是
                  改过名的旧值，改名弹窗只提醒不阻拦，得留一条一键改回去的路。 */}
              <AuthorsSection
                authors={authors}
                setAuthors={setAuthors}
                defaultAuthorName={accountState.astrobox?.username?.trim() ?? ""}
              />
              <LinksSection links={links} setLinks={setLinks} />
              <DownloadsSection
                downloads={downloads}
                sortedDeviceOptions={sortedDeviceOptions}
                isDeviceLoading={isDeviceLoading}
                deviceError={deviceError}
                isVip={isVip}
                resourceId={itemId}
                allDeviceOptions={allSortedDeviceOptions}
                disabledDeviceTitle={disabledDeviceTitle}
                fileAccept={PACKAGE_ACCEPT[resourceType]}
                validateFile={
                  resourceType === "quick_app" ||
                  resourceType === "watchface" ||
                  resourceType === "res_pack"
                    ? validateSelectedPackage
                    : undefined
                }
                onAddRow={addDownloadRow}
                onRemoveRow={removeDownloadRow}
                onUpdateRow={updateDownloadRow}
                onBatchSetDevices={batchSetDownloadDevices}
                onFillAll={fillAllDownloads}
                onPaidMappingStateChange={handlePaidMappingStateChange}
              />
              <DownloadsSection
                title="试用版下载配置"
                fieldKey="trialDownloads"
                description="可选。结构与下载配置一致，但不允许加密上传。如不提供试用包，可保持为空。"
                emptyMessage="还未添加任何试用下载设备"
                downloads={trialDownloads}
                sortedDeviceOptions={sortedDeviceOptions}
                isDeviceLoading={isDeviceLoading}
                deviceError={deviceError}
                isVip={isVip}
                allDeviceOptions={allSortedDeviceOptions}
                disabledDeviceTitle={disabledDeviceTitle}
                allowEncryption={false}
                fileAccept={PACKAGE_ACCEPT[resourceType]}
                validateFile={validateSelectedPackage}
                onAddRow={addTrialDownloadRow}
                onRemoveRow={removeTrialDownloadRow}
                onUpdateRow={updateTrialDownloadRow}
                onBatchSetDevices={batchSetTrialDownloadDevices}
                onPaidMappingStateChange={handlePaidMappingStateChange}
                onFillAll={fillAllTrialDownloads}
              />
              <ExtSection
                extRaw={extRaw}
                extError={extError}
                enableAstroBoxCreatorFeatures={
                  enableAstroBoxCreatorFeatures
                }
                bundledResources={bundledResources}
                selfResourceId={itemId}
                onAddBundledResources={handleAddBundledResources}
                onRemoveBundledResource={handleRemoveBundledResource}
                onToggleBundledResourceMode={handleToggleBundledResourceMode}
                onChange={(value) => {
                  setExtRaw(value);
                  logFieldChange("extRaw", "扩展配置", value, 1000);
                }}
                onToggleCreatorFeatures={(value) => {
                  setEnableAstroBoxCreatorFeatures(value);
                  log.info("form/ext", `切换 Creator 功能: ${value ? "开启" : "关闭"}`);
                }}
              />
              {resourceType === "watchface" && (
                <SectionCard
                  title="壁纸编辑器"
                  description="为表盘配置可编辑壁纸（可选），配置会随资源一起发布。"
                >
                  <div className="flex items-center justify-between gap-3 px-2 pt-1">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-white">表盘壁纸配置</p>
                      <p className="text-xs text-white/50">
                        {wallpaperTemplateCount > 0
                          ? `已配置 ${wallpaperTemplateCount} 个设备模板`
                          : "尚未配置，点击右侧按钮进入编辑器"}
                      </p>
                    </div>
                    <Button
                      size="2"
                      variant="soft"
                      radius="large"
                      onClick={() => void handleOpenWallpaperEditor()}
                    >
                      <PencilSimpleLineIcon size={16} weight="fill" />
                      {wallpaperTemplateCount > 0 ? "编辑壁纸" : "配置壁纸"}
                    </Button>
                  </div>
                </SectionCard>
              )}
              <div className="flex flex-row justify-end gap-2 pt-1">
                <Button
                  className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
                  radius="large"
                  size="2"
                  variant="soft"
                  onClick={handleNextFromDownloadConfig}
                >
                  下一步
                </Button>
              </div>
            </div>
          )}

          {activeStepIndex === 1 && (
            <RepoStepSection
              repoNameInput={repoNameInput}
              repoStatus={repoStatus}
              repoMessage={repoMessage}
              repoOccupiedResource={repoOccupiedResource}
              repoInfo={repoInfo}
              uploadLogs={uploadLogs}
              existingRepos={userRepos}
              existingReposLoading={userReposLoading}
              onRepoNameChange={setRepoNameInput}
              onPickExistingRepo={setRepoNameInput}
              onUpload={() => void handleUploadToRepo()}
              onPrev={() => goToStep(0)}
              onNext={() => goToStep(2)}
              mode={repoStepMode}
            />
          )}

          {activeStepIndex === 2 && pendingConflictPr && (
            <Callout.Root color="amber">
              <Callout.Icon>
                <WarningOctagonIcon size={18} weight="fill" />
              </Callout.Icon>
              <Callout.Text>
                <div className="flex flex-col gap-2">
                  <Text size="2">
                    该资源已有未处理的提交 PR #{pendingConflictPr.number}
                    {pendingConflictPr.title
                      ? `《${pendingConflictPr.title}》`
                      : ""}
                    。
                    {pendingConflictPr.samePath
                      ? "你可以继续编辑该 PR，提交后会把最新修改更新到原 PR。"
                      : "该 PR 可能由其他创作者提交，请等待审核处理完成后再编辑。"}
                  </Text>
                  {pendingConflictPr.samePath && (
                    <div>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => void handleOpenPendingConflictPr()}
                      >
                        继续编辑 PR #{pendingConflictPr.number}
                      </Button>
                    </div>
                  )}
                </div>
              </Callout.Text>
            </Callout.Root>
          )}

          {activeStepIndex === 2 && (
            <PrStepSection
              prBody={prBody}
              prStatus={prStatus}
              prMessage={prMessage}
              onPrBodyChange={setPrBody}
              onSubmit={handleCreatePR}
              onBack={() => goToStep(1)}
              mode={prStepMode}
              needFixItems={needFixItems}
              fixedSelections={fixedSelections}
              fixedNotes={fixedNotes}
              onFixedToggle={(id) =>
                setFixedSelections((prev) => ({ ...prev, [id]: !prev[id] }))
              }
              onFixedNoteChange={(id, value) =>
                setFixedNotes((prev) => ({ ...prev, [id]: value }))
              }
              versionReset={offerVersionReset ? versionReset : undefined}
              onVersionResetChange={setVersionReset}
            />
          )}
        </div>
      </div>
    </Page>
  );
}

export function NewResourcePublishPage() {
  return <ResourceComposerPage mode="new" />;
}

export function ResourceEditPage() {
  return <ResourceComposerPage mode="edit" />;
}

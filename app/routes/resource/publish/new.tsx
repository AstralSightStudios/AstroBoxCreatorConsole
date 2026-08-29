import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Spinner,
  Popover,
  Text,
  AlertDialog,
} from "@radix-ui/themes";
import {
  FileXIcon,
  UploadIcon,
  PencilSimpleLineIcon,
  GitBranchIcon,
  WarningOctagonIcon,
  FloppyDiskIcon,
  ArchiveIcon,
  TrashIcon,
  ClockIcon,
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
  saveWizardSession,
  takeWizardSession,
  type WizardSession,
} from "~/logic/wallpaper/wizard-session";
import {
  buildManifest,
  normalizeBundledResources,
  type ManifestBuildResult,
  type ManifestDownloadInfo,
  type ManifestExtObject,
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
  createSubmissionBranch,
  createSubmissionPullRequest,
  updateSubmissionEntryOnBranch,
} from "~/logic/publish/staging-submission";
import {
  createPullRequestComment,
  reopenPullRequest,
} from "~/api/github/pr-review";
import { renderCommentMarkdownInlineHtml } from "~/routes/resreview/utils/comment";
import Page from "~/layout/page";
import { StepList, SectionCard, type UploadItem } from "./components/shared";
import {
  compressImageFile,
  createExistingUploadItem,
  createImageUploadItem,
  createUploadItem,
  getImageDimensions,
  revokeUrl,
} from "./components/uploadUtils";
import {
  type AuthorInput,
  type BundledResourceInput,
  type DeviceOption,
  type DownloadInput,
  type LinkInput,
} from "./components/types";
import { loadDeviceOptions } from "~/logic/devices/catalog";
import {
  generateUniqueWatchfaceId,
  validateWatchfaceIdFormat,
  fetchExistingCatalogIds,
} from "~/logic/publish/watchface-id";
import {
  CANOPUS_ID_PREFIX,
  normalizeCanopusIdInput,
  validateCanopusIdFormat,
} from "~/logic/publish/canopus-id";
import { BasicInfoSection } from "./components/BasicInfoSection";
import {
  normalizeResourceType,
  type ResourceType,
} from "~/logic/publish/resource-type";
import { MediaSection } from "./components/MediaSection";
import { AuthorsLinksSection } from "./components/AuthorsLinksSection";
import { DownloadsSection } from "./components/DownloadsSection";
import { ExtSection } from "./components/ExtSection";
import { RepoStepSection, type ExistingRepoOption } from "./components/RepoStepSection";
import {
  getRepoFile,
  isGithubStatus,
  listCurrentUserRepos,
} from "~/logic/publish/github-actions";
import { PrStepSection } from "./components/PrStepSection";
import { type ResourceEditContext } from "~/logic/publish/resources";
import {
  COVER_MAX_BYTES,
  COVER_RATIO,
  COVER_RATIO_TOLERANCE,
  readRpkManifestInfo,
  validatePublish,
} from "~/logic/publish/validation";
import {
  buildRawFileUrl,
  fetchManifestForCatalogEntry,
  fetchWallpaperConfigForCatalogEntry,
  getWallpaperConfigUrl,
} from "~/logic/publish/manifest-loader";
import { syncBranchWithUpstream } from "~/logic/publish/fork";
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
  type DraftWallpaperAsset,
  type DraftDownloadInput,
} from "~/logic/publish/publish-drafts";

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

const REQUIRE_ASTROBOX_LOGIN = !import.meta.env.DEV;

function isManifestExtObject(value: unknown): value is ManifestExtObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildDownloadInputsFromManifest(params: {
  downloads?: Record<string, Partial<ManifestDownloadInfo>>;
  owner: string;
  repo: string;
  ref: string;
  encryptedDeviceSet?: Set<string>;
}): DownloadInput[] {
  const { downloads, owner, repo, ref, encryptedDeviceSet } = params;
  return Object.entries(downloads || {}).map(([platformId, info]) => {
    const fileName = info?.file_name || "";
    return {
      uid: crypto.randomUUID?.() ?? Math.random().toString(36),
      platformId,
      version: info?.version || "",
      encryptOnUpload: encryptedDeviceSet?.has(platformId) ?? false,
      file: fileName
        ? createExistingUploadItem(
            fileName.split("/").pop() || fileName,
            buildRawFileUrl(owner, repo, ref, fileName),
            fileName,
          )
        : null,
      existingFileName: fileName,
    };
  });
}

function extractCustomExt(ext: ManifestExtObject | undefined): ManifestExtObject {
  if (!ext) return {};
  const next: ManifestExtObject = { ...ext };
  delete next.enableAstroBoxCreatorFeatures;
  delete next.trialDownloads;
  delete next.bundledResources;
  delete next.wallpaperGenerator;
  return next;
}

function parseTagText(raw: string): string[] {
    return raw
        .split(/[;；,，]/)
        .map((token) => token.trim())
        .filter(Boolean);
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, base64] = dataUrl.split(",");
  const type = meta?.replace("data:", "").split(";")[0] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(base64 || ""), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

async function serializeMediaItem(
  item: UploadItem | null,
): Promise<DraftMediaItem | null> {
  if (!item) return null;
  if (item.skipUpload || !item.file?.size) {
    return {
      id: item.id,
      name: item.name,
      url: item.url,
      pathOverride: item.pathOverride,
      skipUpload: true,
      source: "existing",
      width: item.width,
      height: item.height,
    };
  }
  return {
    id: item.id,
    name: item.name,
    dataUrl: await fileToDataUrl(item.file),
    pathOverride: item.pathOverride,
    skipUpload: item.skipUpload,
    source: "upload",
    width: item.width,
    height: item.height,
  };
}

function restoreMediaItem(item: DraftMediaItem | null): UploadItem | null {
  if (!item) return null;
  if (item.dataUrl) {
    const file = dataUrlToFile(item.dataUrl, item.name);
    const restored = createUploadItem(file);
    return {
      ...restored,
      pathOverride: item.pathOverride,
      width: item.width,
      height: item.height,
    };
  }
  return {
    id: item.id,
    name: item.name,
    url: item.url || "",
    file: new File([], item.name),
    pathOverride: item.pathOverride,
    skipUpload: true,
    source: "existing",
    width: item.width,
    height: item.height,
  };
}

async function serializeDownloadInputs(
  inputs: DownloadInput[],
): Promise<DraftDownloadInput[]> {
  return Promise.all(
    inputs.map(async (item) => {
      const file = item.file;
      if (!file?.file?.size) {
        return { ...item, file: null };
      }
      const bytes = await file.file.arrayBuffer();
      return {
        ...item,
        file: {
          id: file.id,
          name: file.name,
          type: file.file.type,
          size: bytes.byteLength,
          bytes,
          pathOverride: file.pathOverride,
          skipUpload: file.skipUpload,
          source: file.source,
        },
      };
    }),
  );
}

function restoreDownloadInput(item: DraftDownloadInput): DownloadInput {
  if (item.file?.bytes?.byteLength) {
    const file = new File([item.file.bytes], item.file.name, {
      type: item.file.type || "application/octet-stream",
    });
    const restored = createUploadItem(file);
    return {
      ...item,
      file: {
        ...restored,
        id: item.file.id,
        pathOverride: item.file.pathOverride,
        skipUpload: item.file.skipUpload,
        source: item.file.source,
      },
      existingFileName: undefined,
    };
  }
  // 旧版草稿可能残留 WebKitGTK 无法回读的 File 对象：直接置空，
  // 避免恢复后上传报 “The object can not be found here.”。
  return { ...item, file: null };
}

async function serializeWallpaperAsset(
  asset: WallpaperAssetFile,
): Promise<DraftWallpaperAsset> {
  if (asset.file?.size) {
    return { path: asset.path, dataUrl: await fileToDataUrl(asset.file), skipUpload: false };
  }
  return { path: asset.path, url: asset.url, skipUpload: true };
}

function restoreWallpaperAsset(item: DraftWallpaperAsset): WallpaperAssetFile {
  if (item.dataUrl) {
    const name = item.path.split("/").pop() || "asset";
    const file = dataUrlToFile(item.dataUrl, name);
    return { path: item.path, url: URL.createObjectURL(file), file };
  }
  return { path: item.path, url: item.url || "", skipUpload: true };
}

function imageMimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mimes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
  };
  return mimes[ext] || "application/octet-stream";
}

async function loadRemoteMediaItem(
  path: string,
  url: string,
): Promise<UploadItem> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File(
      [blob],
      path.split("/").pop() || "image",
      { type: blob.type || imageMimeFromPath(path) },
    );
    const item = await createImageUploadItem(file);
    return {
      ...item,
      pathOverride: path,
      skipUpload: true,
      source: "existing",
    };
  } catch (error) {
    console.warn("[edit-media] failed to download remote image", path, error);
    return createExistingUploadItem(
      path.split("/").pop() || "image",
      url,
      path,
    );
  }
}

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

  const [authors, setAuthors] = useState<AuthorInput[]>([
    { name: "", bindABAccount: true },
  ]);
  const [links, setLinks] = useState<LinkInput[]>([]);
  const [downloads, setDownloads] =
    useState<DownloadInput[]>(DEFAULT_DOWNLOADS);
  const [trialDownloads, setTrialDownloads] =
    useState<DownloadInput[]>(DEFAULT_DOWNLOADS);
  const [tagsInput, setTagsInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [paidType, setPaidType] = useState("");
  const [enableAstroBoxCreatorFeatures, setEnableAstroBoxCreatorFeatures] =
    useState(false);
  const effectivePaidType = paidType;
  const tags = useMemo(() => parseTagText(tagsInput), [tagsInput]);
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [isDeviceLoading, setIsDeviceLoading] = useState(true);
  const sortedDeviceOptions = useMemo(
    () =>
      [...deviceOptions].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hans", { sensitivity: "base" }),
      ),
    [deviceOptions],
  );

  const [extRaw, setExtRaw] = useState("{}");
  const [bundledResources, setBundledResources] = useState<
    BundledResourceInput[]
  >([]);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repoStatus, setRepoStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [repoMessage, setRepoMessage] = useState("");
  const [prStatus, setPrStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [prMessage, setPrMessage] = useState("");
  const [prBody, setPrBody] = useState("");
  const [activeStepIndex, setActiveStepIndex] = useState(0);
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
      setAuthors(form.authors);
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
    if (deviceOptions.length === 0) return;
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
        const fallback = deviceOptions.find((opt) => !used.has(opt.id));
        if (fallback) {
          changed = true;
          used.add(fallback.id);
          return { ...item, platformId: fallback.id };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [deviceOptions]);

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

  const handleResourceTypeChange = useCallback(
    (next: ResourceType) => {
      if (next === resourceType) return;
      idsByTypeRef.current[resourceType] = itemIdRef.current;
      const cached = idsByTypeRef.current[next];
      setItemId(cached !== undefined ? cached : next === "canopus" ? CANOPUS_ID_PREFIX : "");
      setResourceType(next);
    },
    [resourceType],
  );

  const handleItemIdChange = useCallback(
    (value: string) => {
      if (resourceType === "canopus") {
        setItemId(normalizeCanopusIdInput(value));
        return;
      }
      setItemId(value);
    },
    [resourceType],
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
          manifest.item.author?.map((a) => ({
            name: a.name || "",
            bindABAccount: Boolean(a.bindABAccount),
          })) || [{ name: "", bindABAccount: true }],
        );
        setLinks(
          manifest.links?.map((link) => ({
            title: link.title || "",
            url: link.url || "",
            icon: link.icon || "",
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
        setDownloads(
          buildDownloadInputsFromManifest({
            downloads: manifest.downloads,
            owner: repo.owner,
            repo: repo.name,
            ref,
            encryptedDeviceSet,
          }),
        );
        setTrialDownloads(
          buildDownloadInputsFromManifest({
            downloads: ext.trialDownloads,
            owner: repo.owner,
            repo: repo.name,
            ref,
          }),
        );
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
        previews,
        icon,
        cover,
        usePreviewAsCover: false,
        coverPreviewId: null,
        downloads,
        trialDownloads,
        links,
      }),
    [itemId, itemName, previews, icon, cover, downloads, trialDownloads, links],
  );

  const handlePreviewUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
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
          const processed = await compressImageFile(file, 500 * 1024);
          log.debug("media/preview", "读取预览图尺寸", {
            data: { name: file.name, compressedSize: processed.size },
          });
          const item = await createImageUploadItem(processed);
          log.info("media/preview", "预览图就绪", {
            data: {
              name: item.name,
              width: item.width,
              height: item.height,
              size: processed.size,
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

  const handleIconUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    log.info("media/icon", "导入图标", {
      data: { name: file.name, size: file.size, type: file.type },
    });
    const originalDims = await getImageDimensions(file);
    if (
      !originalDims.width ||
      !originalDims.height ||
      originalDims.width !== originalDims.height
    ) {
      log.warn("media/icon", "图标宽高比必须为 1:1，已拒绝", {
        data: {
          name: file.name,
          width: originalDims.width,
          height: originalDims.height,
        },
      });
      toast.error("图标宽高比必须为 1:1，请重新选择。");
      return;
    }
    if (originalDims.width > 500 || originalDims.height > 500) {
      log.warn("media/icon", "图标尺寸过大，已拒绝", {
        data: {
          name: file.name,
          width: originalDims.width,
          height: originalDims.height,
        },
      });
      toast.error("图标尺寸过大，请重新选择。");
      return;
    }
    setIconUploading(true);
    try {
      let processed = file;
      try {
        processed = await compressImageFile(file, 100 * 1024);
        log.debug("media/icon", "图标压缩完成", {
          data: {
            name: file.name,
            originalSize: file.size,
            compressedSize: processed.size,
          },
        });
      } catch (err) {
        toast.error("图标处理失败，将使用原图");
        log.warn("media/icon", "图标压缩失败，使用原图", {
          data: { name: file.name, error: err },
        });
      }
      const next = await createImageUploadItem(processed).catch(() =>
        createUploadItem(processed),
      );
      log.info("media/icon", "图标导入完成", {
        data: {
          name: next.name,
          width: next.width,
          height: next.height,
          size: next.file.size,
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

  const handleCoverUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    log.info("media/cover", "导入封面", {
      data: { name: file.name, size: file.size, type: file.type },
    });
    const originalDims = await getImageDimensions(file);
    const originalRatio =
      originalDims.width && originalDims.height
        ? originalDims.width / originalDims.height
        : null;
    if (
      !originalDims.width ||
      !originalDims.height ||
      !originalRatio ||
      Math.abs(originalRatio - COVER_RATIO) > COVER_RATIO_TOLERANCE
    ) {
      log.warn("media/cover", "封面宽高比必须为 3:2，已拒绝", {
        data: {
          name: file.name,
          width: originalDims.width,
          height: originalDims.height,
          ratio: originalRatio,
        },
      });
      toast.error(
        `封面宽高比必须为 3:2，当前 ${
          originalRatio ? originalRatio.toFixed(2) : "未知"
        }。`,
      );
      return;
    }
    let processed = file;
    try {
      processed = await compressImageFile(file, 600 * 1024);
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
    }
    const next = await createImageUploadItem(processed).catch(() =>
      createUploadItem(processed),
    );
    if (next.file.size > COVER_MAX_BYTES) {
      log.warn("media/cover", "封面体积过大，已拒绝", {
        data: { name: next.name, size: next.file.size },
      });
      toast.error("封面体积过大，请压缩后重新上传。");
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

  const handleGenerateId = useCallback(async () => {
    if (resourceType !== "watchface" || idGenerating) return;
    setIdGenerating(true);
    try {
      const token = loadAccountState().github?.token;
      if (!token) throw new Error("GitHub 未登录，无法检查 ID 是否重复");
      const ids = await fetchExistingCatalogIds(token);
      setExistingCatalogIds(ids);
      setItemId(generateUniqueWatchfaceId(ids));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIdGenerating(false);
    }
  }, [resourceType, idGenerating]);

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
        wallpaperInitial,
        title: itemName,
        returnPath: isEditMode ? "/publish/edit" : "/publish/new",
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
    if (!token) return;
    const fetchId = ++userReposFetchIdRef.current;
    setUserReposLoading(true);
    listCurrentUserRepos(token)
      .then((repos) => {
        if (fetchId !== userReposFetchIdRef.current) return;
        setUserRepos(
          [...repos].sort((a, b) => {
            const aResource = a.name.startsWith("astrobox-resource-") ? 0 : 1;
            const bResource = b.name.startsWith("astrobox-resource-") ? 0 : 1;
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

  const handleUploadToRepo = async () => {
    if (missingEditContext) {
      setRepoStatus("error");
      setRepoMessage("缺少编辑上下文，请从资源列表重新进入。");
      reportFailure("publish/upload", "缺少编辑上下文，请从资源列表重新进入。");
      return;
    }
    const mode = editContext?.mode ?? "new";
    setRepoStatus("loading");
    setRepoMessage(
      mode === "new" ? "正在创建仓库并上传文件..." : "正在更新仓库文件...",
    );
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

      if (resourceType === "watchface") {
        const formatError = validateWatchfaceIdFormat(itemId);
        if (formatError) throw new Error(formatError);
        const ids = await fetchExistingCatalogIds(token);
        setExistingCatalogIds(ids);
        const ownedId = editContext?.catalog.entry.id.trim();
        const existingName = ids.get(itemId.trim());
        if (existingName && itemId.trim() !== ownedId) {
          throw new Error(
            `资源 ID "${itemId.trim()}" 已被「${existingName}」占用，请更换一个。`,
          );
        }
        if (
          ownedId &&
          itemId.trim() !== ownedId &&
          [...downloads, ...trialDownloads].some(
            (download) => download.file?.skipUpload || download.existingFileName,
          )
        ) {
          throw new Error("表盘 ID 已变更，请重新上传所有表盘包体文件。");
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
          throw new Error(
            `仓库 ${repoName} 已经在 AstroBox 的软件索引里，被资源「${
              existingManifest.name || existingManifest.id || "未知"
            }」占用，请更换仓库名。`,
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
        toast.success("仓库创建成功，文件已上传。");
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
      toast.success("仓库文件更新成功。");
      log.info("upload/repo", "仓库更新完成", {
        data: { owner: repo.owner, name: repo.name, commitSha: repo.commitSha },
      });
    } catch (error) {
      setRepoStatus("error");
      setRepoMessage((error as Error).message);
      reportFailure("publish/upload", `上传失败：${(error as Error).message}`, error, {
        data: { step: "uploadToRepo", itemId, resourceType },
      });
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
      const uploadedId = JSON.parse(
        (lastManifest ?? manifestResult).manifestJson,
      ).item?.id?.trim();
      if (uploadedId !== itemId.trim()) {
        throw new Error("资源 ID 已变更，请重新上传仓库文件后再提交 PR。");
      }

      const tags = tagsInput
        .split(/[;；]/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (tags.length === 0) {
        throw new Error("请至少添加一个标签。");
      }

      const deviceMap = new Map(deviceOptions.map((d) => [d.id, d]));
      const selectedDevices = downloads
        .filter((d) => d.platformId.trim())
        .map((d) => ({
          id: d.platformId.trim(),
          vendor: deviceMap.get(d.platformId)?.vendor,
        }));

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

      if (mode === "in_progress") {
        const prHead = editContext?.prHead;
        if (!editContext || !prHead) {
          throw new Error("缺少 PR 分支信息，无法更新。");
        }
        const submission = editContext.submission;

        if (editContext.prState === "closed" && editContext.prNumber) {
          await flowSpan("pr/reopen", "重新打开已关闭的 PR", () =>
            reopenPullRequest(editContext.prNumber as number),
          );
          await flowSpan("pr/comment", "发送 [ABCC_REOPEN] 评论", () =>
            createPullRequestComment(
              editContext.prNumber as number,
              "[ABCC_REOPEN] 创作者已重新打开此 PR 并提交更新。",
            ),
          );
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

        if (editContext.mode === "in_progress" && editContext.prNumber) {
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
              createPullRequestComment(editContext.prNumber as number, body),
            );
          }
        }

        setPrStatus("success");
        setPrMessage("已更新现有 PR。");
        log.info("pr/submit", "已更新现有 PR", { data: { prNumber: editContext.prNumber } });
        reportSuccess("publish/pr", "已更新现有 PR。");
        await endResourceSession("completed", `已更新现有 PR #${editContext.prNumber ?? "?"}`);
        navigate("/manage", { replace: true });
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

      setPrStatus("success");
      setPrMessage("PR 已创建，请在 GitHub 查看。");
      reportSuccess("publish/pr", "PR 已创建，可在审核列表中跟踪进度。");
      await endResourceSession(
        "pr_created",
        `PR #${createdPr?.number ?? "?"}${createdPr?.html_url ? ` ${createdPr.html_url}` : ""}`,
      );
      navigate("/manage", { replace: true });
    } catch (error) {
      setPrStatus("error");
      setPrMessage((error as Error).message);
      reportFailure("publish/pr", `提交失败：${(error as Error).message}`, error, {
        data: { step: "createPR", itemId, resourceType, mode },
      });
    }
  };

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
  }) => {
    log.info("download/row", "一键填充下载配置", {
      data: {
        version: template.version,
        fileName: template.file?.name ?? null,
        encryptOnUpload: template.encryptOnUpload,
      },
    });
    setDownloads((prev) =>
      prev.map((row) => ({
        ...row,
        version: template.version,
        file: template.file,
        encryptOnUpload: template.encryptOnUpload ?? row.encryptOnUpload,
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
  }) => {
    log.info("download/trial/row", "一键填充试用下载配置", {
      data: {
        version: template.version,
        fileName: template.file?.name ?? null,
      },
    });
    setTrialDownloads((prev) =>
      prev.map((row) => ({
        ...row,
        version: template.version,
        file: template.file,
      })),
    );
  };

  const goToStep = (index: number) => {
    const target = Math.max(0, Math.min(2, index));
    if (target > 0 && tags.length === 0) {
      toast.error("请至少添加一个标签。");
      setActiveStepIndex(0);
      return;
    }
    if (target > 0 && publishValidation.errors.length) {
      toast.error(publishValidation.errors[0]);
      setActiveStepIndex(0);
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
      setUploadLogs([]);
    }
    setActiveStepIndex(target);
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
      serializedWallpaperAssets,
    ] = await Promise.all([
      Promise.all(previews.map(serializeMediaItem)).then((items) =>
        items.filter((item): item is DraftMediaItem => item !== null),
      ),
      serializeMediaItem(icon),
      serializeMediaItem(cover),
      serializeDownloadInputs(downloads),
      serializeDownloadInputs(trialDownloads),
      Promise.all(wallpaperPayload.assets.map(serializeWallpaperAsset)),
    ]);
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
      wallpaperConfigJson: wallpaperPayload.configJson,
      wallpaperAssets: serializedWallpaperAssets,
    };
  }, [itemId, itemName, description, resourceType, tagsInput, paidType, authors, links, downloads, trialDownloads, bundledResources, enableAstroBoxCreatorFeatures, extRaw, previews, icon, cover, wallpaperPayload]);

  const restoreFormData = useCallback((data: PublishDraftFormData) => {
    setItemId(data.itemId);
    idsByTypeRef.current[data.resourceType] = data.itemId;
    setItemName(data.itemName);
    setDescription(data.description);
    setResourceType(data.resourceType);
    setTagsInput(data.tagsInput);
    setPaidType(data.paidType);
    setAuthors(data.authors);
    setLinks(data.links);
    setPreviews(
      (data.previews ?? [])
        .map(restoreMediaItem)
        .filter((item): item is UploadItem => Boolean(item)),
    );
    setIcon(restoreMediaItem(data.icon));
    setCover(restoreMediaItem(data.cover));
    setDownloads((data.downloads ?? []).map(restoreDownloadInput));
    setTrialDownloads((data.trialDownloads ?? []).map(restoreDownloadInput));
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
    setWallpaperPayload({
      configJson: data.wallpaperConfigJson ?? "",
      assets: (data.wallpaperAssets ?? []).map(restoreWallpaperAsset),
    });
  }, []);

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
    <AlertDialog.Root open={autoSavePromptOpen}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>发现未保存的草稿</AlertDialog.Title>
        <AlertDialog.Description size="2">
          检测到上次未保存的内容（{autoSavedData ? formatDraftTime(autoSavedData.savedAt) : ""}），是否恢复？
        </AlertDialog.Description>
        <div className="flex justify-end gap-3 mt-4">
          <AlertDialog.Action>
            <Button variant="soft" color="gray" onClick={handleDismissAutoSave}>
              丢弃
            </Button>
          </AlertDialog.Action>
          <AlertDialog.Action>
            <Button variant="solid" onClick={handleRestoreAutoSave}>
              恢复内容
            </Button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );

  // Draft action buttons
  const draftActions = !isEditing ? (
    <div className="flex flex-col gap-1.5 px-3 w-full">
      <div className="flex gap-1.5">
        <AlertDialog.Root open={saveDraftOpen} onOpenChange={setSaveDraftOpen}>
          <AlertDialog.Trigger>
            <Button size="1" variant="soft" color="gray" className="text-xs! flex-1">
              <FloppyDiskIcon size={14} />
              保存草稿
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="380px">
            <AlertDialog.Title>保存草稿</AlertDialog.Title>
            <div className="mt-2">
              <input
                type="text"
                placeholder={itemName || "输入草稿名称"}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">取消</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button variant="solid" onClick={handleSaveDraft}>保存</Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Root>

        <Popover.Root open={draftPopoverOpen} onOpenChange={(open) => {
          setDraftPopoverOpen(open);
          if (open) void listDrafts().then(setDraftList);
        }}>
          <Popover.Trigger>
            <Button size="1" variant="soft" color="gray" className="text-xs! flex-1">
              <ArchiveIcon size={14} />
              草稿箱
            </Button>
          </Popover.Trigger>
          <Popover.Content width="300px" className="max-h-[360px] overflow-y-auto">
            <div className="flex flex-col gap-2">
              <Text size="2" weight="medium">已保存的草稿</Text>
              {draftList.length === 0 ? (
                <Text size="1" color="gray" className="py-4 text-center">
                  暂无草稿
                </Text>
              ) : (
                <div className="flex flex-col gap-1">
                  {draftList.map((draft) => (
                    <div
                      key={draft.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 transition group"
                    >
                      <div className="flex-1 min-w-0">
                        <Text size="2" className="truncate block">{draft.name}</Text>
                        <Text size="1" color="gray" className="flex items-center gap-1">
                          <ClockIcon size={10} />
                          {formatDraftTime(draft.savedAt)}
                        </Text>
                      </div>
                      <Button
                        size="1"
                        variant="ghost"
                        onClick={() => handleRestoreDraft(draft)}
                        className="opacity-0 group-hover:opacity-100 transition"
                      >
                        恢复
                      </Button>
                      <Button
                        size="1"
                        variant="ghost"
                        color="red"
                        onClick={() => handleDeleteDraft(draft.id)}
                        className="opacity-0 group-hover:opacity-100 transition"
                      >
                        <TrashIcon size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>
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
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(auto,280px)_1fr] mx-auto max-w-6xl px-2 w-full lg:gap-4 gap-6">
        <div className="flex flex-col items-start gap-3 lg:flex-none lg:min-w-64 lg:sticky lg:top-1.5 lg:left-0 h-fit select-none">
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
                to="/manage?tab=publish"
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
                onItemIdChange={(value) => {
                  handleItemIdChange(value);
                  logFieldChange("itemId", "资源 ID", value);
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
                onIconUpload={handleIconUpload}
                onCoverUpload={handleCoverUpload}
                 onRemoveIcon={handleRemoveIcon}
                 onRemoveCover={handleRemoveCover}
                 onMediaDimensions={handleMediaDimensions}
               />
              <AuthorsLinksSection
                authors={authors}
                setAuthors={setAuthors}
                links={links}
                setLinks={setLinks}
              />
              <DownloadsSection
                downloads={downloads}
                sortedDeviceOptions={sortedDeviceOptions}
                isDeviceLoading={isDeviceLoading}
                deviceError={deviceError}
                isVip={isVip}
                 resourceId={itemId}
                 validateFile={
                   resourceType === "quick_app"
                     ? async (file) => {
                         const info = await readRpkManifestInfo(file);
                         return {
                           versionName: info.versionName,
                           warning:
                             info.packageName !== itemId
                               ? {
                                   packageName: info.packageName,
                                   resourceId: itemId,
                                 }
                               : undefined,
                         };
                       }
                     : undefined
                 }
                 onAddRow={addDownloadRow}
                onRemoveRow={removeDownloadRow}
                onUpdateRow={updateDownloadRow}
                onBatchSetDevices={batchSetDownloadDevices}
                onFillAll={fillAllDownloads}
              />
              <DownloadsSection
                title="试用版下载配置"
                description="可选。结构与下载配置一致，但不允许加密上传。如不提供试用包，可保持为空。试用版文件会默认上传到 downloads/trial/ 目录。"
                emptyMessage="还未添加任何试用下载设备"
                helperText=""
                downloads={trialDownloads}
                sortedDeviceOptions={sortedDeviceOptions}
                isDeviceLoading={isDeviceLoading}
                deviceError={deviceError}
                isVip={isVip}
                 allowEncryption={false}
                 validateFile={
                   resourceType === "quick_app"
                     ? async (file) => {
                         const info = await readRpkManifestInfo(file);
                         return {
                           versionName: info.versionName,
                           warning:
                             info.packageName !== itemId
                               ? {
                                   packageName: info.packageName,
                                   resourceId: itemId,
                                 }
                               : undefined,
                         };
                       }
                     : undefined
                 }
                 onAddRow={addTrialDownloadRow}
                onRemoveRow={removeTrialDownloadRow}
                onUpdateRow={updateTrialDownloadRow}
                onBatchSetDevices={batchSetTrialDownloadDevices}
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
                  description="为表盘配置可编辑壁纸（可选）。在独立页面中设计图层与可调参数，配置会随资源一起发布。"
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
                  onClick={() => goToStep(1)}
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

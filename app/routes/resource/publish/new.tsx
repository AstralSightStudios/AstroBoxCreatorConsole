import { Badge, Button, Callout, Spinner, Popover, Text, AlertDialog } from "@radix-ui/themes";
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
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { PUBLISH_CONFIG } from "~/config/publish";
import { loadPublishMode } from "~/config/publishMode";
import {
  buildManifest,
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
import Page from "~/layout/page";
import { StepList, type UploadItem } from "./components/shared";
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
import { BasicInfoSection } from "./components/BasicInfoSection";
import { MediaSection } from "./components/MediaSection";
import { AuthorsLinksSection } from "./components/AuthorsLinksSection";
import { DownloadsSection } from "./components/DownloadsSection";
import { ExtSection } from "./components/ExtSection";
import { RepoStepSection } from "./components/RepoStepSection";
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
} from "~/logic/publish/publish-drafts";

const DEFAULT_DOWNLOADS: DownloadInput[] = [];

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
  const [itemId, setItemId] = useState("");
  const [resourceType, setResourceType] = useState<"quick_app" | "watchface">(
    "quick_app",
  );
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

  useEffect(() => {
    if (!isEditMode) return;
    const state =
      (location.state as { editContext?: ResourceEditContext } | null) || null;
    setEditContext(state?.editContext ?? null);
  }, [isEditMode, location.state]);

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
    let active = true;
    const load = async () => {
      setEditLoading(true);
      setEditError("");
      setUploadLogs([]);
      setRepoStatus("idle");
      setPrStatus("idle");
      setLastManifest(null);
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
        setItemName(manifest.item.name || catalogEntry.name || "");
        setDescription(manifest.item.description || "");
        setResourceType(
          (manifest.item.restype as "quick_app" | "watchface") || "quick_app",
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
        setExtRaw(JSON.stringify(extractCustomExt(ext), null, 2));
        setRepoInfo({ ...repo });
        setRepoNameInput(repo.name);
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
        ext: parsedExt,
      }),
    [
      authors,
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
    console.log("[preview-upload] start", fileList.length, fileList.map((f) => f.name));
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
          console.log("[preview-upload] compress", index + 1, file.name, file.size);
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
          console.log("[preview-upload] read dimensions", file.name, processed.size);
          const item = await createImageUploadItem(processed);
          console.log("[preview-upload] ready", file.name, item.width, item.height);
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
          console.error("[preview-upload] failed", file.name, err);
          toast.error(`图片处理失败：${file.name}`);
          setPreviews((prev) =>
            prev.map((old) =>
              old.id === itemId ? { ...old, processing: false, progress: 100 } : old,
            ),
          );
        }
      }
      console.log("[preview-upload] done");
    } finally {
      setPreviewProcessingId(null);
      setPreviewUploading(false);
    }
  };

  const handleIconUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const originalDims = await getImageDimensions(file);
    if (
      !originalDims.width ||
      !originalDims.height ||
      originalDims.width !== originalDims.height
    ) {
      toast.error("图标宽高比必须为 1:1，请重新选择。");
      return;
    }
    if (originalDims.width > 500 || originalDims.height > 500) {
      toast.error("图标尺寸过大，请重新选择。");
      return;
    }
    setIconUploading(true);
    try {
      let processed = file;
      try {
        processed = await compressImageFile(file, 100 * 1024);
      } catch (err) {
        toast.error("图标处理失败，将使用原图");
        console.error("compress icon failed:", err);
      }
      const next = await createImageUploadItem(processed).catch(() =>
        createUploadItem(processed),
      );
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
    } catch (err) {
      toast.error("封面处理失败，将使用原图");
      console.error("compress cover failed:", err);
    }
    const next = await createImageUploadItem(processed).catch(() =>
      createUploadItem(processed),
    );
    if (next.file.size > COVER_MAX_BYTES) {
      toast.error("封面体积过大，请压缩后重新上传。");
      revokeUrl(next);
      return;
    }
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
    setTagsInput((prev) => {
      const existing = parseTagText(prev);
      return [...existing, nextTag].join(";");
    });
    setTagInput("");
  };

  const removeTag = (index: number) => {
    setTagsInput((prev) => {
      const next = parseTagText(prev);
      next.splice(index, 1);
      return next.join(";");
    });
  };

  const handleRemovePreview = (id: string) => {
    setPreviews((prev) => {
      const toRemove = prev.find((item) => item.id === id);
      revokeUrl(toRemove);
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
    revokeUrl(icon);
    setIcon(null);
  };

  const handleRemoveCover = () => {
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

  const addLog = (message: string) => {
    setUploadLogs((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} ${message}`,
    ]);
  };

  const handleUploadToRepo = async () => {
    if (missingEditContext) {
      setRepoStatus("error");
      setRepoMessage("缺少编辑上下文，请从资源列表重新进入。");
      return;
    }
    const mode = editContext?.mode ?? "new";
    setRepoStatus("loading");
    setRepoMessage(
      mode === "new" ? "正在创建仓库并上传文件..." : "正在更新仓库文件...",
    );
    setUploadLogs([]);
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
        const repo = await uploadManifestAndAssets({
          manifest: manifestResult,
          itemId,
          itemName,
          description,
          token,
          repoNameOverride: repoNameInput.trim() || undefined,
          onProgress: addLog,
        });
        setRepoInfo(repo);
        setLastManifest(manifestResult);
        setRepoStatus("success");
        setRepoMessage("仓库与文件已就绪，下一步可提交 PR。");
        setActiveStepIndex(2);
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

      const repo = await upsertManifestAndAssets({
        manifest: manifestResult,
        repo: targetRepo,
        token,
        onProgress: addLog,
      });
      setRepoInfo(repo);
      setLastManifest(manifestResult);
      setRepoStatus("success");
      setRepoMessage("仓库更新完成，准备提交目录更新。");
      setActiveStepIndex(2);
    } catch (error) {
      setRepoStatus("error");
      setRepoMessage((error as Error).message);
    }
  };

  const handleCreatePR = async () => {
    if (missingEditContext) {
      setPrStatus("error");
      setPrMessage("缺少编辑上下文，请从资源列表重新进入。");
      return;
    }
     const mode = editContext?.mode ?? "new";
     if (publishValidation.errors.length) {
       setPrStatus("error");
       setPrMessage(publishValidation.errors[0]);
       return;
     }
     if (!repoInfo) {
      setPrStatus("error");
      setPrMessage("请先完成仓库创建与文件上传。");
      return;
    }
    if (!repoInfo.commitSha) {
      setPrStatus("error");
      setPrMessage("未获取到仓库提交哈希，请重新执行步骤 2。");
      return;
    }
    setPrStatus("loading");
    setPrMessage(
      mode === "in_progress"
        ? "正在更新已有 PR..."
        : "正在创建 Pull Request...",
    );
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
      const useStaging = loadPublishMode() === "staging";
      const prBodyContent = [
        prBody.trim(),
        "欢迎加入 [AstroBox 资源开发者官方 QQ 群](https://qm.qq.com/q/4YVntKbEMo)",
      ]
        .filter(Boolean)
        .join("\n\n");
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
        if (!editContext?.prHead) {
          throw new Error("缺少 PR 分支信息，无法更新。");
        }

        await syncBranchWithUpstream({
          token,
          forkOwner: editContext.prHead.owner,
          forkRepo: editContext.prHead.repo,
          targetBranch: editContext.prHead.ref,
        });

        if (useStaging) {
          if (!editContext.submission) {
            throw new Error("缺少新流程提交信息，无法更新现有 PR。");
          }
          await updateSubmissionEntryOnBranch({
            token,
            owner: editContext.prHead.owner,
            repo: editContext.prHead.repo,
            branch: editContext.prHead.ref,
            entry: catalogEntry,
            request: editContext.submission.request,
            submissionPath: editContext.submission.path,
          });
        } else {
          await updateCatalogEntryOnBranch({
            token,
            owner: editContext.prHead.owner,
            repo: editContext.prHead.repo,
            branch: editContext.prHead.ref,
            intent: {
              mode: "edit",
              originalId: editContext.catalog.entry.id,
            },
            entry: catalogEntry,
          });
        }

        setPrStatus("success");
        setPrMessage("已更新现有 PR。");
        navigate("/manage", { replace: true });
        return;
      }

      if (useStaging) {
        const branchInfo = await createSubmissionBranch({
          repoInfo: { ...repoInfo, commitSha: repoInfo.commitSha },
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
        });
        await createSubmissionPullRequest({
          forkOwner: branchInfo.forkOwner,
          forkRepo: branchInfo.forkRepo,
          branch: branchInfo.branch,
          token,
          title: `${editContext ? "[ABCC] Update resource" : "[ABCC] Add new resource"}: ${
            itemName || itemId || "资源"
          }`,
          body: prBodyContent || undefined,
        });
      } else {
        const branchInfo = await updateCatalogCsv({
          repoInfo: { ...repoInfo, commitSha: repoInfo.commitSha },
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
        });

        await createCatalogPullRequest({
          forkOwner: branchInfo.forkOwner,
          forkRepo: branchInfo.forkRepo,
          branch: branchInfo.branch,
          token,
          title: `${editContext ? "[ABCC] Update resource" : "[ABCC] Add new resource"}: ${
            itemName || itemId || "资源"
          }`,
          body: prBodyContent || undefined,
        });
      }

      setPrStatus("success");
      setPrMessage("PR 已创建，请在 GitHub 查看。");
      navigate("/manage", { replace: true });
    } catch (error) {
      setPrStatus("error");
      setPrMessage((error as Error).message);
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
      return [...prev, buildRow(next?.id)];
    });
  };

  const removeDownloadRow = (uid: string) => {
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
    setActiveStepIndex(target);
  };

  // --- Draft system ---
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
    const [serializedPreviews, serializedIcon, serializedCover] = await Promise.all([
      Promise.all(previews.map(serializeMediaItem)).then((items) =>
        items.filter((item): item is DraftMediaItem => item !== null),
      ),
      serializeMediaItem(icon),
      serializeMediaItem(cover),
    ]);
    return {
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
      downloads: downloads.map((d) => ({ ...d, file: null })),
      trialDownloads: trialDownloads.map((d) => ({ ...d, file: null })),
      enableAstroBoxCreatorFeatures,
      extRaw,
    };
  }, [itemId, itemName, description, resourceType, tagsInput, paidType, authors, links, downloads, trialDownloads, enableAstroBoxCreatorFeatures, extRaw, previews, icon, cover]);

  const restoreFormData = useCallback((data: PublishDraftFormData) => {
    setItemId(data.itemId);
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
    setDownloads(data.downloads.map((d) => ({ ...d, file: null })));
    setTrialDownloads(data.trialDownloads.map((d) => ({ ...d, file: null })));
    setEnableAstroBoxCreatorFeatures(data.enableAstroBoxCreatorFeatures);
    setExtRaw(data.extRaw);
  }, []);

  // Auto-save debounce
  useEffect(() => {
    if (isEditMode || previewUploading) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void buildFormData().then(autoSaveDraft);
    }, 1000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [buildFormData, isEditMode, previewUploading]);

  // Check for auto-saved draft on mount
  useEffect(() => {
    if (isEditMode) return;
    void loadAutoSavedDraft().then((saved) => {
      if (saved && saved.formData.itemName) {
        setAutoSavedData(saved);
        setAutoSavePromptOpen(true);
      }
    });
  }, [isEditMode]);

  const handleSaveDraft = async () => {
    const name = draftName.trim() || itemName || "未命名草稿";
    const data = await buildFormData();
    await saveDraft(name, data);
    setDraftName("");
    setSaveDraftOpen(false);
    setDraftList(await listDrafts());
  };

  const handleRestoreDraft = (draft: PublishDraft) => {
    restoreFormData(draft.formData);
    setDraftPopoverOpen(false);
  };

  const handleDeleteDraft = async (id: string) => {
    await deleteDraft(id);
    setDraftList(await listDrafts());
  };

  const handleRestoreAutoSave = async () => {
    if (autoSavedData) {
      restoreFormData(autoSavedData.formData);
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
  const prStepMode: "new" | "update" =
    editContext?.mode === "in_progress" ? "update" : "new";
  const needFixItems = useMemo(
    () =>
      editContext?.mode === "in_progress" ? (editContext.needs ?? []) : [],
    [editContext],
  );
  const needFixProgressText = useMemo(() => {
    if (needFixItems.length === 0) return "";
    const finished = needFixItems.filter((item) => item.fixed).length;
    return `（已完成 ${finished}/${needFixItems.length}）`;
  }, [needFixItems]);

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

  if (mode === "new" && !accountState.astrobox?.username?.trim()) {
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
                needFixItems.length > 0 && (
                  <div className="mt-2.5 rounded-md border border-amber-400/30 bg-amber-400/5 p-2.5">
                    <div className="mb-2 flex items-center gap-2">
                      <WarningOctagonIcon
                        size={16}
                        weight="fill"
                        className="text-amber-300"
                      />
                      <p className="text-sm font-semibold text-amber-200">
                        需要修改项{needFixProgressText}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {needFixItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 text-sm text-white/85"
                        >
                          <Badge
                            color={item.fixed ? "green" : "yellow"}
                            variant="soft"
                          >
                            {item.id}
                          </Badge>
                          <span className="text-white/85">
                            {item.message || "（无附加说明）"}
                          </span>
                        </div>
                      ))}
                    </div>
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
                onItemIdChange={setItemId}
                onItemNameChange={setItemName}
                onDescriptionChange={setDescription}
                onAddTag={addTag}
                onRemoveTag={removeTag}
                onTagInputChange={setTagInput}
                onPaidTypeChange={setPaidType}
                onResourceTypeChange={setResourceType}
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
                onChange={setExtRaw}
                onToggleCreatorFeatures={setEnableAstroBoxCreatorFeatures}
              />
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
              onRepoNameChange={setRepoNameInput}
              onUpload={handleUploadToRepo}
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

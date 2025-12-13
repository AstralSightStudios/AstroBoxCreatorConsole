import { Badge, Button } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { PUBLISH_CONFIG } from "~/config/publish";
import { buildManifest, type ManifestBuildResult } from "~/logic/publish/manifest";
import {
    upsertManifestAndAssets,
    uploadManifestAndAssets,
    type RepoInfo,
} from "~/logic/publish/submission";
import { loadAccountState } from "~/logic/account/store";
import {
    createCatalogPullRequest,
    updateCatalogCsv,
    updateCatalogEntryOnBranch,
} from "~/logic/publish/catalog";
import Page from "~/layout/page";
import { StepList, type UploadItem } from "./components/shared";
import {
    createExistingUploadItem,
    createUploadItem,
    revokeUrl,
} from "./components/uploadUtils";
import {
    type AuthorInput,
    type DeviceOption,
    type DownloadInput,
    type LinkInput,
} from "./components/types";
import { BasicInfoSection } from "./components/BasicInfoSection";
import { MediaSection } from "./components/MediaSection";
import { AuthorsLinksSection } from "./components/AuthorsLinksSection";
import { DownloadsSection } from "./components/DownloadsSection";
import { ExtSection } from "./components/ExtSection";
import { RepoStepSection } from "./components/RepoStepSection";
import { PrStepSection } from "./components/PrStepSection";
import { type ResourceEditContext } from "~/logic/publish/resources";
import {
    buildRawFileUrl,
    fetchManifestForCatalogEntry,
} from "~/logic/publish/manifest-loader";
import { syncBranchWithUpstream } from "~/logic/publish/fork";

const DEVICES_URL =
    "https://raw.githubusercontent.com/AstralSightStudios/AstroBox-Repo/refs/heads/main/devices_v2.json";

const DEFAULT_DOWNLOADS: DownloadInput[] = [];

function ResourceComposerPage({ mode = "new" }: { mode?: "new" | "edit" }) {
    const location = useLocation();
    const isEditMode = mode === "edit";
    const [itemId, setItemId] = useState("");
    const [resourceType, setResourceType] = useState<"quick_app" | "watchface">(
        "quick_app",
    );
    const [itemName, setItemName] = useState("");
    const [description, setDescription] = useState("");

    const [previews, setPreviews] = useState<UploadItem[]>([]);
    const [icon, setIcon] = useState<UploadItem | null>(null);
    const [cover, setCover] = useState<UploadItem | null>(null);
    const [usePreviewAsCover, setUsePreviewAsCover] = useState(true);
    const [coverPreviewId, setCoverPreviewId] = useState<string | null>(null);

    const [authors, setAuthors] = useState<AuthorInput[]>([
        { name: "", bindABAccount: true },
    ]);
    const [links, setLinks] = useState<LinkInput[]>([]);
    const [downloads, setDownloads] = useState<DownloadInput[]>(DEFAULT_DOWNLOADS);
    const [tagsInput, setTagsInput] = useState("");
    const [paidType, setPaidType] = useState("");
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
    const [prStatus, setPrStatus] = useState<"idle" | "loading" | "success" | "error">(
        "idle",
    );
    const [prMessage, setPrMessage] = useState("");
    const [prBody, setPrBody] = useState("");
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [repoNameInput, setRepoNameInput] = useState("");
    const [uploadLogs, setUploadLogs] = useState<string[]>([]);
    const [editContext, setEditContext] = useState<ResourceEditContext | null>(() => {
        if (!isEditMode) {
            return null;
        }
        const state =
            (location.state as { editContext?: ResourceEditContext } | null) || null;
        return state?.editContext ?? null;
    });
    const [editLoading, setEditLoading] = useState(false);
    const [editError, setEditError] = useState("");
    const [lastManifest, setLastManifest] = useState<ManifestBuildResult | null>(null);

    useEffect(() => {
        if (!isEditMode) return;
        const state =
            (location.state as { editContext?: ResourceEditContext } | null) || null;
        setEditContext(state?.editContext ?? null);
    }, [isEditMode, location.state]);

    const isEditing = isEditMode || Boolean(editContext);
    const missingEditContext = isEditMode && !editContext;

    useEffect(() => {
        let cancelled = false;
        const fetchDevices = async () => {
            try {
                setIsDeviceLoading(true);
                setDeviceError("");
                const response = await fetch(DEVICES_URL, {
                    cache: "no-store",
                    headers: {
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                    },
                });
                if (!response.ok) {
                    throw new Error(`请求失败: ${response.status}`);
                }
                const payload = (await response.json()) as Record<
                    string,
                    Record<string, { id: string; name: string }>
                >;
                const map = new Map<string, DeviceOption>();
                Object.entries(payload).forEach(([vendor, devices]) => {
                    Object.values(devices).forEach((device) => {
                        if (!map.has(device.id)) {
                            map.set(device.id, {
                                id: device.id,
                                name: device.name || device.id,
                                vendor,
                            });
                        }
                    });
                });

                const options = Array.from(map.values());
                if (!cancelled) {
                    if (options.length === 0) {
                        throw new Error("设备列表为空");
                    }
                    setDeviceOptions(options);
                }
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setDeviceError("设备列表拉取失败，请稍后重试。");
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
                const ref =
                    catalogEntry.repo_commit_hash ||
                    editContext.catalog.ref ||
                    PUBLISH_CONFIG.defaultBranch;
                const { manifest, repo } = await fetchManifestForCatalogEntry({
                    entry: catalogEntry,
                    token,
                    ref,
                });
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

                const previewItems: UploadItem[] =
                    manifest.item.preview?.map((path, index) =>
                        createExistingUploadItem(
                            path.split("/").pop() || `preview-${index + 1}`,
                            buildRawFileUrl(repo.owner, repo.name, ref, path),
                            path,
                        ),
                    ) || [];
                setPreviews(previewItems);

                const iconPath = manifest.item.icon;
                setIcon(
                    iconPath
                        ? createExistingUploadItem(
                              iconPath.split("/").pop() || "icon",
                              buildRawFileUrl(repo.owner, repo.name, ref, iconPath),
                              iconPath,
                          )
                        : null,
                );

                const coverPath = manifest.item.cover;
                const matchedCover = previewItems.find(
                    (item) => (item.pathOverride || item.name) === coverPath,
                );
                if (matchedCover) {
                    setUsePreviewAsCover(true);
                    setCoverPreviewId(matchedCover.id);
                    setCover(null);
                } else if (coverPath) {
                    setUsePreviewAsCover(false);
                    setCover(
                        createExistingUploadItem(
                            coverPath.split("/").pop() || "cover",
                            buildRawFileUrl(repo.owner, repo.name, ref, coverPath),
                            coverPath,
                        ),
                    );
                } else {
                    setUsePreviewAsCover(true);
                    setCoverPreviewId(previewItems[0]?.id ?? null);
                    setCover(null);
                }

                const downloadsFromManifest = manifest.downloads || {};
                const downloadInputs: DownloadInput[] = Object.entries(
                    downloadsFromManifest,
                ).map(([platformId, info]) => {
                    const fileName = info?.file_name || "";
                    return {
                        uid: crypto.randomUUID?.() ?? Math.random().toString(36),
                        platformId,
                        version: info?.version || "",
                        file: fileName
                            ? createExistingUploadItem(
                                  fileName.split("/").pop() || fileName,
                                  buildRawFileUrl(repo.owner, repo.name, ref, fileName),
                                  fileName,
                              )
                            : null,
                        existingFileName: fileName,
                    };
                });
                setDownloads(downloadInputs);

                setExtRaw(
                    manifest.ext !== undefined
                        ? JSON.stringify(manifest.ext, null, 2)
                        : "{}",
                );
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
            return {
                parsedExt: trimmed ? JSON.parse(trimmed) : {},
                extError: "",
            };
        } catch {
            return { parsedExt: {}, extError: "ext 字段需要合法的 JSON" };
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
                usePreviewAsCover,
                coverPreviewId,
                authors,
                links,
                downloads,
                ext: parsedExt,
            }),
        [
            authors,
            cover,
            coverPreviewId,
            description,
            downloads,
            icon,
            itemId,
            itemName,
            links,
            parsedExt,
            previews,
            resourceType,
            usePreviewAsCover,
        ],
    );

    const handlePreviewUpload = (files: FileList | null) => {
        if (!files?.length) return;
        const newItems = Array.from(files).map(createUploadItem);
        setPreviews((prev) => [...prev, ...newItems]);
        if (usePreviewAsCover && !coverPreviewId) {
            setCoverPreviewId(newItems[0]?.id ?? null);
        }
    };

    const handleIconUpload = (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        setIcon((prev) => {
            revokeUrl(prev);
            return createUploadItem(file);
        });
    };

    const handleCoverUpload = (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        setCover((prev) => {
            revokeUrl(prev);
            return createUploadItem(file);
        });
    };

    const handleRemovePreview = (id: string) => {
        setPreviews((prev) => {
            const toRemove = prev.find((item) => item.id === id);
            revokeUrl(toRemove);
            return prev.filter((item) => item.id !== id);
        });
        if (coverPreviewId === id) {
            setCoverPreviewId(null);
        }
    };

    const handleRemoveIcon = () => {
        revokeUrl(icon);
        setIcon(null);
    };

    const handleRemoveCover = () => {
        revokeUrl(cover);
        setCover(null);
    };

    const handleUsePreviewAsCover = (checked: boolean) => {
        setUsePreviewAsCover(Boolean(checked));
        if (checked && previews[0]) {
            setCoverPreviewId(previews[0].id);
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
        setUploadLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} ${message}`]);
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

            const expectedDownloads = downloads.filter((d) => d.platformId.trim()).length;
            const missingDownload = downloads.some(
                (d) => d.platformId.trim() && !d.file && !d.existingFileName,
            );

            if (missingDownload) {
                throw new Error("所有下载配置必须上传包体文件。");
            }

            if (manifestResult.previewPaths.length === 0) {
                throw new Error("请至少上传一张预览图。");
            }

            if (!manifestResult.manifestJson) {
                throw new Error("缺少 manifest 数据，请先填写必要字段。");
            }

            const token = loadAccountState().github?.token;
            if (!token) {
                throw new Error("GitHub 未登录，无法上传文件。");
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
                          branch: PUBLISH_CONFIG.defaultBranch,
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
            mode === "in_progress" ? "正在更新已有 PR..." : "正在创建 Pull Request...",
        );
        try {
            const token = loadAccountState().github?.token;
            if (!token) throw new Error("GitHub 未登录，无法提交 PR。");

            const tags = tagsInput
                .split(/[;；]/)
                .map((t) => t.trim())
                .filter(Boolean);
            if (tags.length === 0) {
                throw new Error("请至少填写一个标签（用分号分隔）。");
            }

            const deviceMap = new Map(deviceOptions.map((d) => [d.id, d]));
            const selectedDevices = downloads
                .filter((d) => d.platformId.trim())
                .map((d) => ({
                    id: d.platformId.trim(),
                    vendor: deviceMap.get(d.platformId)?.vendor,
                }));

            const manifestForCatalog = lastManifest ?? manifestResult;

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

                await updateCatalogEntryOnBranch({
                    token,
                    owner: editContext.prHead.owner,
                    repo: editContext.prHead.repo,
                    branch: editContext.prHead.ref,
                    entry: {
                        id: itemId.trim(),
                        name: itemName.trim(),
                        restype: resourceType,
                        repo_owner: repoInfo.owner,
                        repo_name: repoInfo.name,
                        repo_commit_hash: repoInfo.commitSha,
                        icon: manifestForCatalog.iconPath,
                        cover: manifestForCatalog.coverPath,
                        tags: tags.join(";"),
                        device_vendors: Array.from(
                            new Set(selectedDevices.map((d) => d.vendor).filter(Boolean)),
                        ).join(";"),
                        devices: Array.from(
                            new Set(selectedDevices.map((d) => d.id)),
                        ).join(";"),
                        paid_type: paidType?.trim() ?? "",
                    },
                });

                setPrStatus("success");
                setPrMessage("已更新现有 PR。");
                return;
            }

            const branchInfo = await updateCatalogCsv({
                repoInfo: { ...repoInfo, commitSha: repoInfo.commitSha },
                iconPath: manifestForCatalog.iconPath,
                coverPath: manifestForCatalog.coverPath,
                tags,
                devices: selectedDevices,
                itemId,
                itemName,
                restype: resourceType,
                paidType,
            });

            await createCatalogPullRequest({
                forkOwner: branchInfo.forkOwner,
                forkRepo: branchInfo.forkRepo,
                branch: branchInfo.branch,
                token,
                title: `${PUBLISH_CONFIG.defaultPrTitle}: ${itemName || itemId || "新资源"}`,
                body: prBody.trim() || undefined,
            });

            setPrStatus("success");
            setPrMessage("PR 已创建，请在 GitHub 查看。");
        } catch (error) {
            setPrStatus("error");
            setPrMessage((error as Error).message);
        }
    };

    const addDownloadRow = () => {
        setDownloads((prev) => {
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
                },
            ];
        });
    };

    const removeDownloadRow = (uid: string) => {
        setDownloads((prev) => prev.filter((d) => d.uid !== uid));
    };

    const updateDownloadRow = (
        uid: string,
        updater: (row: DownloadInput) => DownloadInput,
    ) => {
        setDownloads((prev) => prev.map((row) => (row.uid === uid ? updater(row) : row)));
    };

    const goToStep = (index: number) => {
        setActiveStepIndex(Math.max(0, Math.min(2, index)));
    };

    const repoStepMode: "new" | "edit" =
        isEditMode || Boolean(editContext) ? "edit" : "new";
    const prStepMode: "new" | "update" =
        editContext?.mode === "in_progress" ? "update" : "new";

    const stepsCard = (
        <div className="flex flex-wrap flex-col items-end gap-3">
            <StepList
                steps={steps.map((s) => ({ ...s, status: s.status }))}
                activeIndex={activeStepIndex}
                onSelect={goToStep}
            />
            {repoStatus === "success" && repoInfo?.htmlUrl && (
                <Badge color="green" variant="soft">
                    仓库: {repoInfo.name}
                </Badge>
            )}
        </div>
    );

    return (
        <Page>
            <div className="flex flex-col gap-3.5 px-3.5 pt-1.5 pb-6">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="flex flex-col gap-1">
                        <p className="text-lg font-semibold">
                            {isEditing ? "编辑资源" : "发布新资源"}
                        </p>
                        <p className="text-sm text-white/70">
                            {isEditing
                                ? "更新已提交的资源内容"
                                : "向AstroBox资源社区提交新资源"}
                        </p>
                    </div>
                    <div className="ml-auto">{stepsCard}</div>
                </div>

                {missingEditContext && (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                        缺少编辑上下文，请从资源列表或发布申请列表重新进入。
                    </div>
                )}
                {editContext && (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-white/90">
                        <p>
                            正在编辑：
                            {editContext.catalog.entry.name || editContext.catalog.entry.id}
                            {editContext.mode === "in_progress" && editContext.prNumber
                                ? `（PR #${editContext.prNumber}）`
                                : ""}
                        </p>
                        {editLoading && (
                            <p className="text-xs text-white/70">正在载入远端数据...</p>
                        )}
                        {editError && (
                            <p className="text-xs text-amber-200">
                                加载失败：{editError}
                            </p>
                        )}
                    </div>
                )}
                {!editContext && editError && isEditMode && (
                    <p className="text-sm text-amber-400">加载失败：{editError}</p>
                )}

                {activeStepIndex === 0 && (
                    <>
                        <BasicInfoSection
                            itemId={itemId}
                            itemName={itemName}
                            description={description}
                            tagsInput={tagsInput}
                            paidType={paidType}
                            resourceType={resourceType}
                            onItemIdChange={setItemId}
                            onItemNameChange={setItemName}
                            onDescriptionChange={setDescription}
                            onTagsChange={setTagsInput}
                            onPaidTypeChange={setPaidType}
                            onResourceTypeChange={setResourceType}
                        />
                        <MediaSection
                            previews={previews}
                            icon={icon}
                            cover={cover}
                            usePreviewAsCover={usePreviewAsCover}
                            coverPreviewId={coverPreviewId}
                            onPreviewUpload={handlePreviewUpload}
                            onRemovePreview={handleRemovePreview}
                            onIconUpload={handleIconUpload}
                            onCoverUpload={handleCoverUpload}
                            onSelectCoverPreview={setCoverPreviewId}
                            onToggleUsePreviewAsCover={handleUsePreviewAsCover}
                            onRemoveIcon={handleRemoveIcon}
                            onRemoveCover={handleRemoveCover}
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
                            onAddRow={addDownloadRow}
                            onRemoveRow={removeDownloadRow}
                            onUpdateRow={updateDownloadRow}
                        />
                        <ExtSection
                            extRaw={extRaw}
                            extError={extError}
                            onChange={setExtRaw}
                        />
                        <div className="flex flex-row justify-end gap-2">
                            <Button className="styledbtn" onClick={() => goToStep(1)}>
                                下一步：创建发布仓库
                            </Button>
                        </div>
                    </>
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
        </Page>
    );
}

export function NewResourcePublishPage() {
    return <ResourceComposerPage mode="new" />;
}

export function ResourceEditPage() {
    return <ResourceComposerPage mode="edit" />;
}

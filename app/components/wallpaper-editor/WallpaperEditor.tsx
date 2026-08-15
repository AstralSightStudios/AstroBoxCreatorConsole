import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    WallpaperConfigError,
    normalizeWallpaperConfig,
} from "@claralight-design/wallpaper-engine";
import {
    getInitialWallpaperEditorState,
    loadWallpaperImage,
    renderWallpaperToBlob,
} from "@claralight-design/wallpaper-engine/render";
import type {
    ResolvedWallpaperTemplate,
    WallpaperEditorState,
    WallpaperResources,
    WallpaperTransformState,
} from "@claralight-design/wallpaper-engine";
import { DownloadSimpleIcon, FileCodeIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import {
    WALLPAPER_DEVICE_PRESETS,
    createWallpaperConfig,
    generateTemplateId,
} from "~/logic/wallpaper/presets";
import {
    addLayer,
    cloneConfig,
    flattenAllTemplates,
    getExpandedTemplate,
    moveLayer,
    removeLayer,
    updateLayer,
    updateWallpaperTransform,
} from "~/logic/wallpaper/json-tree";
import {
    assetFileForRepoPath,
    collectTemplateAssetPaths,
    configPathToRepoPath,
    loadTemplateResources,
    repoPathToConfigPath,
} from "~/logic/wallpaper/load-resources";
import type {
    WallpaperAssetFile,
    WallpaperConfigRaw,
    WallpaperLayerConfig,
    WallpaperLayerKind,
} from "~/logic/wallpaper/types";
import { getImageDimensions } from "~/routes/resource/publish/components/uploadUtils";
import { Sidebar } from "./Sidebar";
import { CanvasStage } from "./CanvasStage";
import { Inspector } from "./Inspector";
import { JsonSourcePanel } from "./JsonSourcePanel";
import { WallpaperEditorErrorBoundary } from "./ErrorBoundary";

export interface WallpaperEditorProps {
    title?: string;
    initialConfig?: WallpaperConfigRaw | null;
    initialAssets?: WallpaperAssetFile[];
    /** Directory URL that hosts `wallpaper/wallpaper.json` (edit mode). */
    baseUrl?: string;
    onBack?: () => void;
    onChange?: (payload: { configJson: string; assets: WallpaperAssetFile[] }) => void;
}

function genId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function normalizeAssetPathsForEditor(config: WallpaperConfigRaw, baseUrl?: string): WallpaperConfigRaw {
    const next = cloneConfig(config);
    const base = baseUrl?.replace(/\/+$/, "");
    const toRelative = (src: string) => {
        if (base && src.startsWith(`${base}/`)) return `./${src.slice(base.length + 1)}`;
        return src;
    };
    for (const template of next.templates) {
        for (const layer of template.layers ?? []) {
            if (layer.type === "asset" && layer.src) layer.src = toRelative(layer.src);
            if (layer.mask) layer.mask = toRelative(layer.mask);
            if (layer.text?.font && typeof layer.text.font !== "string") {
                for (const option of layer.text.font.options ?? []) {
                    if (option.src) option.src = toRelative(option.src);
                }
            }
        }
    }
    return next;
}

function parseAndValidate(raw: string, baseUrl?: string) {
    try {
        const parsed = JSON.parse(raw) as WallpaperConfigRaw;
        normalizeWallpaperConfig(parsed, baseUrl ?? "");
        return { config: parsed, issues: [] as string[] };
    } catch (error) {
        if (error instanceof WallpaperConfigError) {
            return { config: undefined, issues: error.issues };
        }
        return { config: undefined, issues: [(error as Error).message] };
    }
}

export function WallpaperEditor({
    title,
    initialConfig,
    initialAssets,
    baseUrl,
    onBack,
    onChange,
}: WallpaperEditorProps) {
    const [config, setConfig] = useState<WallpaperConfigRaw | null>(() =>
        initialConfig
            ? flattenAllTemplates(normalizeAssetPathsForEditor(initialConfig, baseUrl))
            : null,
    );
    const [assetFiles, setAssetFiles] = useState<Record<string, WallpaperAssetFile>>(() => {
        const map: Record<string, WallpaperAssetFile> = {};
        for (const asset of initialAssets ?? []) {
            map[repoPathToConfigPath(asset.path)] = asset;
        }
        return map;
    });
    const [viewMode, setViewMode] = useState<"visual" | "json">("visual");
    const [activeTemplate, setActiveTemplate] = useState(0);
    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
    const [templateStates, setTemplateStates] = useState<Record<string, WallpaperEditorState>>({});
    const [resources, setResources] = useState<Record<string, WallpaperResources>>({});
    const [jsonDraft, setJsonDraft] = useState("");
    const [jsonIssues, setJsonIssues] = useState<string[]>([]);
    const [applyError, setApplyError] = useState("");

    const assetInputRef = useRef<HTMLInputElement | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const transformTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingAssetLayerRef = useRef<null | { kind: "asset" }>(null);
    const lastValidResolvedRef = useRef<ResolvedWallpaperTemplate[]>([]);

    const { resolved, configIssues } = useMemo(() => {
        if (!config) {
            lastValidResolvedRef.current = [];
            return { resolved: [] as ResolvedWallpaperTemplate[], configIssues: [] as string[] };
        }
        try {
            const next = normalizeWallpaperConfig(config, baseUrl ?? "");
            lastValidResolvedRef.current = next;
            return { resolved: next, configIssues: [] as string[] };
        } catch (error) {
            const issues =
                error instanceof WallpaperConfigError
                    ? error.issues
                    : [(error as Error).message];
            return { resolved: lastValidResolvedRef.current, configIssues: issues };
        }
    }, [config, baseUrl]);

    const resolvedForView = resolved.length > 0 ? resolved : null;

    const templateCount = config?.templates?.length ?? 0;
    const activeIndex = Math.min(activeTemplate, Math.max(0, templateCount - 1));
    const expandedActiveTemplate = config ? getExpandedTemplate(config, activeIndex) : null;
    const layers = Array.isArray(expandedActiveTemplate?.layers)
        ? (expandedActiveTemplate!.layers ?? [])
        : [];
    const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;
    const transformControls = expandedActiveTemplate?.wallpaperTransform ?? {};

    // Emit serialized payload whenever config / assets change.
    useEffect(() => {
        if (!config) {
            onChange?.({ configJson: "", assets: [] });
            return;
        }
        onChange?.({
            configJson: JSON.stringify(config, null, 2),
            assets: Object.values(assetFiles),
        });
    }, [config, assetFiles, onChange]);

    // Keep editor states in sync with resolved templates (preserve live transform).
    useEffect(() => {
        if (!config) return;
        setTemplateStates((prev) => {
            const next: Record<string, WallpaperEditorState> = {};
            for (const template of resolved) {
                try {
                    const fresh = getInitialWallpaperEditorState(template, baseImage ?? undefined);
                    if (prev[template.id]) {
                        fresh.transform = prev[template.id].transform;
                    }
                    next[template.id] = fresh;
                } catch (error) {
                    console.warn("[wallpaper] 编辑状态初始化失败", template.id, error);
                }
            }
            return next;
        });
    }, [resolved, baseImage, config]);

    // Load per-template resources (assets / masks / fonts) through the engine loaders.
    useEffect(() => {
        if (!config || resolved.length === 0) return;
        let cancelled = false;
        const load = async () => {
            const map: Record<string, WallpaperResources> = {};
            for (const template of resolved) {
                try {
                    const result = await loadTemplateResources(template, {
                        resolvePath: (path) => assetFiles[path]?.url,
                    });
                    if (cancelled) return;
                    map[template.id] = result;
                } catch (error) {
                    console.warn("[wallpaper] 素材加载失败", template.id, error);
                    map[template.id] = { assets: {}, masks: {} };
                }
            }
            setResources(map);
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [config, resolved, assetFiles]);

    // JSON view draft sync.
    const openJsonView = useCallback(() => {
        setJsonDraft(config ? JSON.stringify(config, null, 2) : "{}");
        setJsonIssues(configIssues);
        setViewMode("json");
    }, [config, configIssues]);

    const emitFromConfig = useCallback((next: WallpaperConfigRaw) => {
        setConfig(next);
        return next;
    }, []);

    const handleUploadTestImage = useCallback(async (file: File) => {
        const url = URL.createObjectURL(file);
        try {
            const image = await loadWallpaperImage(url);
            setBaseImage(image);
        } catch (error) {
            console.error("测试壁纸加载失败", error);
            setApplyError("测试壁纸加载失败，请更换图片。");
        }
    }, []);

    const handleExport = useCallback(async () => {
        if (!resolvedForView || !config) return;
        const template = resolvedForView[activeIndex];
        const state = templateStates[template.id];
        const res = resources[template.id];
        if (!state || !res) return;
        try {
            const blob = await renderWallpaperToBlob(template, state, baseImage ?? undefined, res);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${template.id}.png`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            setApplyError((error as Error).message);
        }
    }, [activeIndex, baseImage, config, resolvedForView, resources, templateStates]);

    const handleTransformChange = useCallback(
        (templateId: string, transform: WallpaperTransformState) => {
            setTemplateStates((prev) => {
                const current = prev[templateId];
                if (!current) return prev;
                return { ...prev, [templateId]: { ...current, transform } };
            });
            if (transformTimerRef.current) clearTimeout(transformTimerRef.current);
            transformTimerRef.current = setTimeout(() => {
                setConfig((prev) => {
                    if (!prev) return prev;
                    const index = prev.templates.findIndex((template) => template.id === templateId);
                    if (index < 0) return prev;
                    const transform = prev.templates[index].wallpaperTransform;
                    const round = (value: number) => Math.round(value * 100) / 100;
                    const patch: Record<string, unknown> = {};
                    if (transform?.scale && typeof transform.scale === "object") {
                        patch.scale = { ...transform.scale, default: round(transform.scale.default ?? 1) };
                    }
                    if (transform?.rotation && typeof transform.rotation === "object") {
                        patch.rotation = { ...transform.rotation, default: round(transform.rotation.default ?? 0) };
                    }
                    return Object.keys(patch).length ? updateWallpaperTransform(prev, index, patch) : prev;
                });
            }, 800);
        },
        [],
    );

    const handleLayerPatch = useCallback(
        (patch: Partial<WallpaperLayerConfig>) => {
            if (!config || !selectedLayerId) return;
            setConfig((prev) => (prev ? updateLayer(prev, activeIndex, selectedLayerId, patch) : prev));
        },
        [activeIndex, config, selectedLayerId],
    );

    const handleAddLayer = useCallback(
        (kind: WallpaperLayerKind) => {
            if (!config) return;
            if (kind === "asset") {
                pendingAssetLayerRef.current = { kind: "asset" };
                assetInputRef.current?.click();
                return;
            }
            const layer: WallpaperLayerConfig =
                kind === "text"
                    ? {
                          id: genId("text"),
                          name: "文字",
                          type: "text",
                          clip: "frame",
                          opacity: { default: 1, min: 0, max: 1, step: 0.01, adjustable: true },
                          blendMode: "normal",
                          text: {
                              content: { default: "AstroBox", adjustable: true },
                              maxLength: 20,
                              fontSize: { default: 32, min: 8, max: 120, step: 1, adjustable: true },
                              fontWeight: { default: 400, min: 100, max: 900, step: 100, adjustable: true },
                              color: { default: "#ffffff", adjustable: true, allowCustom: true },
                              textAlign: { default: "center", adjustable: true, options: ["left", "center", "right"] },
                              verticalAlign: { default: "middle", adjustable: true, options: ["top", "middle", "bottom"] },
                              letterSpacing: { default: 0, min: -4, max: 20, step: 1, adjustable: true },
                              lineHeight: { default: 1.2, min: 0.5, max: 3, step: 0.05, adjustable: true },
                          },
                      }
                    : kind === "wallpaper"
                      ? {
                            id: genId("photo"),
                            name: "壁纸层",
                            type: "wallpaper",
                            clip: "frame",
                            blur: { default: 0, min: 0, max: 30, step: 1, adjustable: true },
                            blendMode: "normal",
                        }
                      : {
                            id: genId("tint"),
                            name: "明暗层",
                            type: "tint",
                            clip: "frame",
                            amount: { default: 0, min: -1, max: 1, step: 0.01, adjustable: true },
                            lightColor: "#ffffff",
                            darkColor: "#000000",
                            blendMode: "normal",
                        };
            const next = addLayer(config, activeIndex, layer);
            setConfig(next);
            setSelectedLayerId(layer.id);
        },
        [activeIndex, config],
    );

    const handleAssetChosen = useCallback(
        async (file: File) => {
            if (!config || !pendingAssetLayerRef.current) return;
            pendingAssetLayerRef.current = null;
            const dims = await getImageDimensions(file).catch(() => ({ width: 256, height: 256 }));
            const configPath = `./assets/${file.name}`;
            const url = URL.createObjectURL(file);
            setAssetFiles((prev) => ({
                ...prev,
                [configPath]: assetFileForRepoPath(configPathToRepoPath(configPath), url, file),
            }));
            const layer: WallpaperLayerConfig = {
                id: genId("asset"),
                name: file.name.replace(/\.[^.]+$/, ""),
                type: "asset",
                src: configPath,
                clip: "frame",
                rect: { x: 0, y: 0, width: dims.width, height: dims.height },
                transform: { x: 0, y: 0, scale: 1, rotation: 0 },
                opacity: { default: 1, min: 0, max: 1, step: 0.01, adjustable: true },
                blur: { default: 0, min: 0, max: 30, step: 1, adjustable: true },
                backdropBlur: { default: 0, min: 0, max: 30, step: 1, adjustable: true },
                blendMode: { default: "normal", adjustable: true },
            };
            setConfig((prev) => (prev ? addLayer(prev, activeIndex, layer) : prev));
            setSelectedLayerId(layer.id);
        },
        [activeIndex, config],
    );

    const handleMaskUpload = useCallback(
        async (file: File) => {
            if (!config || !selectedLayerId) return;
            const configPath = `./assets/${file.name}`;
            const url = URL.createObjectURL(file);
            setAssetFiles((prev) => ({
                ...prev,
                [configPath]: assetFileForRepoPath(configPathToRepoPath(configPath), url, file),
            }));
            setConfig((prev) => (prev ? updateLayer(prev, activeIndex, selectedLayerId, { mask: configPath }) : prev));
        },
        [activeIndex, config, selectedLayerId],
    );

    const handleAssetReplace = useCallback(
        async (file: File) => {
            if (!config || !selectedLayerId) return;
            const configPath = `./assets/${file.name}`;
            const url = URL.createObjectURL(file);
            setAssetFiles((prev) => ({
                ...prev,
                [configPath]: assetFileForRepoPath(configPathToRepoPath(configPath), url, file),
            }));
            setConfig((prev) => (prev ? updateLayer(prev, activeIndex, selectedLayerId, { src: configPath }) : prev));
        },
        [activeIndex, config, selectedLayerId],
    );

    const handleRemoveLayer = useCallback(
        (id: string) => {
            if (!config) return;
            setConfig((prev) => (prev ? removeLayer(prev, activeIndex, id) : prev));
            if (selectedLayerId === id) setSelectedLayerId(null);
        },
        [activeIndex, config, selectedLayerId],
    );

    const handleMoveLayer = useCallback(
        (id: string, direction: -1 | 1) => {
            if (!config) return;
            setConfig((prev) => (prev ? moveLayer(prev, activeIndex, id, direction) : prev));
        },
        [activeIndex, config],
    );

    const handleTransformPatch = useCallback(
        (patch: Record<string, unknown>) => {
            if (!config) return;
            setConfig((prev) => (prev ? updateWallpaperTransform(prev, activeIndex, patch) : prev));
        },
        [activeIndex, config],
    );

    const handleCreateFromPreset = useCallback((presetId: string) => {
        const preset = WALLPAPER_DEVICE_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;
        const created = createWallpaperConfig(preset);
        setConfig(created);
        setActiveTemplate(0);
        setSelectedLayerId(null);
        setBaseImage(null);
    }, []);

    const handleImportJson = useCallback(async (file: File) => {
        const text = await file.text();
        const { config: parsed, issues } = parseAndValidate(text, baseUrl);
        if (!parsed) {
            setApplyError(`导入失败：${issues[0] ?? "JSON 无效"}`);
            return;
        }
        setConfig(normalizeAssetPathsForEditor(parsed, baseUrl));
        setActiveTemplate(0);
        setSelectedLayerId(null);
        setApplyError("");
    }, [baseUrl]);

    const handleApplyJson = useCallback(() => {
        const { config: parsed, issues } = parseAndValidate(jsonDraft, baseUrl);
        setJsonIssues(issues);
        if (parsed) {
            setConfig(normalizeAssetPathsForEditor(parsed, baseUrl));
            setApplyError("");
            setViewMode("visual");
        }
    }, [baseUrl, jsonDraft]);

    // Reset active template bounds when templates change.
    useEffect(() => {
        if (config && activeTemplate >= config.templates.length) {
            setActiveTemplate(Math.max(0, config.templates.length - 1));
        }
    }, [activeTemplate, config]);

    // Preset picker / empty state
    if (!config) {
        return (
            <div
                className="flex h-full w-full flex-col items-center justify-center gap-6 p-8"
                style={{ background: "var(--color-editor-canvas)" }}
            >
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
                    >
                        <ArrowLeftIcon size={16} weight="regular" />
                        返回
                    </button>
                )}
                <div className="flex max-w-2xl flex-col gap-3">
                    <p className="text-center text-base font-medium text-white">从设备模板开始，或导入已有配置</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {WALLPAPER_DEVICE_PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                onClick={() => handleCreateFromPreset(preset.id)}
                                className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-[var(--color-editor-control)] px-4 py-3 text-sm text-white/85 transition hover:border-[var(--color-editor-blue-fg)]"
                            >
                                <span>{preset.title}</span>
                                <span className="text-xs text-white/45">
                                    {preset.width} × {preset.height}
                                </span>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => importInputRef.current?.click()}
                        className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white/70 transition hover:border-white/30"
                    >
                        <FileCodeIcon size={16} weight="regular" />
                        导入壁纸配置 JSON
                    </button>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleImportJson(file);
                            e.target.value = "";
                        }}
                    />
                    {applyError && <p className="text-center text-xs text-red-400">{applyError}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col" style={{ background: "var(--color-editor-bg)" }}>
            {/* view toggle */}
            <div className="flex shrink-0 items-center justify-end gap-1 px-3 py-1.5">
                <button
                    type="button"
                    onClick={() => setViewMode("visual")}
                    className={`rounded-md px-2.5 py-1 text-xs transition ${
                        viewMode === "visual" ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
                    }`}
                >
                    可视化
                </button>
                <button
                    type="button"
                    onClick={openJsonView}
                    className={`rounded-md px-2.5 py-1 text-xs transition ${
                        viewMode === "json" ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
                    }`}
                >
                    JSON
                </button>
            </div>
            {configIssues.length > 0 && viewMode === "visual" && (
                <div className="shrink-0 border-t border-amber-400/30 bg-amber-400/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-amber-200">
                            配置有 {configIssues.length} 处不合法，已暂停实时渲染。
                        </p>
                        <button
                            type="button"
                            onClick={openJsonView}
                            className="shrink-0 rounded-md border border-amber-400/40 px-2 py-0.5 text-xs text-amber-200 transition hover:bg-amber-400/10"
                        >
                            前往 JSON 修复
                        </button>
                    </div>
                    <ul className="mt-1 list-disc pl-5 text-[11px] leading-4 text-amber-100/70">
                        {configIssues.slice(0, 4).map((issue, index) => (
                            <li key={index}>{issue}</li>
                        ))}
                        {configIssues.length > 4 && <li>… 其余 {configIssues.length - 4} 条</li>}
                    </ul>
                </div>
            )}
            {applyError && (
                <div className="shrink-0 border-t border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs text-red-300">
                    {applyError}
                </div>
            )}

            <div className="relative flex min-h-0 flex-1 flex-row">
                {viewMode === "visual" ? (
                    <WallpaperEditorErrorBoundary
                        onReset={() => {
                            // 回到 JSON 视图，把问题留给用户修复，而不是让界面空白。
                            setViewMode("json");
                        }}
                    >
                        <Sidebar
                            title={title ?? ""}
                            onBack={() => onBack?.()}
                            hasConfig
                            hasBaseImage={Boolean(baseImage)}
                            onUploadTestImage={(file) => void handleUploadTestImage(file)}
                            onExport={() => void handleExport()}
                            layers={layers}
                            selectedLayerId={selectedLayerId}
                            onSelectLayer={setSelectedLayerId}
                            onAddLayer={handleAddLayer}
                            onRemoveLayer={handleRemoveLayer}
                            onMoveLayer={handleMoveLayer}
                            transform={{
                                scale: transformControls.scale,
                                rotation: transformControls.rotation,
                                onScaleChange: (patch) => handleTransformPatch({ scale: patchControlMerge(transformControls.scale, patch) }),
                                onRotationChange: (patch) => handleTransformPatch({ rotation: patchControlMerge(transformControls.rotation, patch) }),
                            }}
                        />
                        <div style={{ width: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                        <main
                            className="min-w-0 flex-1"
                            style={{ background: "var(--color-editor-canvas)" }}
                        >
                            <CanvasStage
                                resolved={resolved}
                                templateStates={templateStates}
                                resources={resources}
                                baseImage={baseImage}
                                activeTemplate={activeIndex}
                                onActiveTemplateChange={setActiveTemplate}
                                onTransformChange={handleTransformChange}
                            />
                        </main>
                        <div style={{ width: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                        <Inspector
                            layer={selectedLayer}
                            onLayerPatch={handleLayerPatch}
                            onAssetUpload={(file) => void handleAssetReplace(file)}
                            onMaskUpload={(file) => void handleMaskUpload(file)}
                            onClearMask={() => handleLayerPatch({ mask: undefined })}
                        />
                    </WallpaperEditorErrorBoundary>
                ) : (
                    <JsonSourcePanel
                        value={jsonDraft}
                        issues={jsonIssues}
                        onChange={(value) => {
                            setJsonDraft(value);
                            const { issues } = parseAndValidate(value, baseUrl);
                            setJsonIssues(issues);
                        }}
                        onApply={handleApplyJson}
                    />
                )}
            </div>

            {/* hidden file input used by asset-layer creation */}
            <input
                ref={assetInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAssetChosen(file);
                    e.target.value = "";
                }}
            />
        </div>
    );
}

function patchControlMerge(
    current: unknown,
    patch: Partial<{ default: number; min: number; max: number; step: number; adjustable: boolean }>,
): unknown {
    if (typeof current === "number") {
        return patch.default !== undefined ? patch.default : current;
    }
    const base = (current && typeof current === "object" ? current : { default: 0 }) as Record<string, unknown>;
    return { ...base, ...patch };
}

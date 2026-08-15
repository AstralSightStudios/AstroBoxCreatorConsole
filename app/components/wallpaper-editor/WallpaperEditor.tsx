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
} from "~/logic/wallpaper/presets";
import {
    addLayer,
    cloneConfig,
    duplicateTemplateAt,
    flattenAllTemplates,
    getExpandedTemplate,
    getLayer,
    moveLayerToIndex,
    removeLayer,
    removeTemplate,
    syncLayerAcrossTemplates,
    updateLayer,
    updateTemplate,
    updateWallpaperTransform,
} from "~/logic/wallpaper/json-tree";
import {
    assetFileForRepoPath,
    configPathToRepoPath,
    loadTemplateResources,
    repoPathToConfigPath,
} from "~/logic/wallpaper/load-resources";
import type {
    WallpaperAssetFile,
    WallpaperConfigRaw,
    WallpaperControlValue,
    WallpaperFontControlConfig,
    WallpaperFontOptionConfig,
    WallpaperLayerConfig,
    WallpaperLayerKind,
    WallpaperTemplateConfig,
} from "~/logic/wallpaper/types";
import { controlDefault } from "~/logic/wallpaper/control";
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

function measureTextSize(
    content: string,
    fontSize: number,
    fontWeight: number,
    fontFamily: string,
    letterSpacing: number,
    lineHeight: number,
): { width: number; height: number } {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        const lines = content.split("\n");
        let width = 0;
        for (const line of lines) {
            let lineWidth = 0;
            for (const ch of line) {
                lineWidth += ctx.measureText(ch).width + letterSpacing;
            }
            width = Math.max(width, lineWidth);
        }
        return { width: Math.ceil(width), height: Math.ceil(fontSize * lineHeight * lines.length) };
    } catch {
        const width = Math.ceil(content.length * fontSize * 0.6 + letterSpacing * Math.max(0, content.length - 1));
        return { width, height: Math.ceil(fontSize * lineHeight) };
    }
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
            if (layer.font && typeof layer.font !== "string") {
                for (const option of layer.font.options ?? []) {
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
    const [selection, setSelection] = useState<
        | { kind: "layer"; layerId: string }
        | { kind: "canvas" }
        | null
    >(null);
    const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
    const [templateStates, setTemplateStates] = useState<Record<string, WallpaperEditorState>>({});
    const [resources, setResources] = useState<Record<string, WallpaperResources>>({});
    const [renderSimplify, setRenderSimplify] = useState(false);
    const [jsonDraft, setJsonDraft] = useState("");
    const [jsonIssues, setJsonIssues] = useState<string[]>([]);
    const [applyError, setApplyError] = useState("");

    const assetInputRef = useRef<HTMLInputElement | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const transformTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const resetTransformOnChangeRef = useRef(false);
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
    const selectedLayerId = selection?.kind === "layer" ? selection.layerId : null;
    const selectedLayer = selectedLayerId
        ? layers.find((layer) => layer.id === selectedLayerId) ?? null
        : null;
    const inspectorMode: "layer" | "canvas" = selectedLayer ? "layer" : "canvas";
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
        // 通过侧边栏整体缩放/旋转编辑默认值时，需要把实时变换重置到新默认值，实时刷新预览。
        const shouldReset = resetTransformOnChangeRef.current;
        resetTransformOnChangeRef.current = false;
        setTemplateStates((prev) => {
            const next: Record<string, WallpaperEditorState> = {};
            for (const template of resolved) {
                try {
                    const fresh = getInitialWallpaperEditorState(template, baseImage ?? undefined);
                    if (prev[template.id] && !shouldReset) {
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

    // 素材只与图层 src/mask/font 地址相关；数值/控件改动不触发重新加载素材（滑块拖动更流畅）。
    const resourceKey = useMemo(() => {
        return resolved
            .map((template) =>
                [
                    template.id,
                    ...template.layers.flatMap((layer) => [
                        layer.type === "asset" ? layer.assetUrl ?? "" : "",
                        layer.maskUrl ?? "",
                        ...(layer.text?.font.options
                            .map((option) => option.fontUrl ?? "")
                            .filter(Boolean) ?? []),
                    ]),
                ].join("|"),
            )
            .join(";");
    }, [resolved]);

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
    }, [config, resolved, resourceKey, assetFiles]);

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
                    if (Object.keys(patch).length === 0) return prev;
                    // 整体缩放/旋转默认值对所有设备一致
                    let next = prev;
                    for (let i = 0; i < next.templates.length; i++) {
                        next = updateWallpaperTransform(next, i, patch);
                    }
                    return next;
                });
            }, 800);
        },
        [],
    );

    // 多设备同步的图层属性：常见样式 + 文字样式（文字框 textBox 按设备单独摆放，不参与同步）。
    const SYNC_LAYER_KEYS = new Set([
        "opacity",
        "blur",
        "backdropBlur",
        "blendMode",
        "color",
        "content",
        "maxLength",
        "font",
        "fontSize",
        "fontWeight",
        "letterSpacing",
        "lineHeight",
        "textAlign",
        "verticalAlign",
    ]);

    const handleLayerPatch = useCallback(
        (patch: Partial<WallpaperLayerConfig>) => {
            if (!config || !selectedLayerId) return;
            const patchKeys = Object.keys(patch);
            const isSyncFlagPatch =
                patchKeys.length === 1 && patchKeys[0] === "syncAcrossDevices";

            // 多设备同步按图层独立配置。同步开关/样式改动应用到所有设备；
            // 某设备缺少该图层时自动复制创建（仅在开启同步时）。
            if (isSyncFlagPatch) {
                const enabling = patch.syncAcrossDevices === true;
                const sourceLayer = getLayer(config, activeIndex, selectedLayerId);
                setConfig((prev) => {
                    if (!prev) return prev;
                    return syncLayerAcrossTemplates(
                        prev,
                        selectedLayerId,
                        sourceLayer,
                        patch,
                        enabling,
                    );
                });
                return;
            }

            const isSyncPatch =
                patchKeys.length > 0 &&
                patchKeys.every((key) => SYNC_LAYER_KEYS.has(key));
            const layerSync =
                getLayer(config, activeIndex, selectedLayerId)?.syncAcrossDevices === true;
            if (layerSync && isSyncPatch) {
                const sourceLayer = getLayer(config, activeIndex, selectedLayerId);
                setConfig((prev) => {
                    if (!prev) return prev;
                    return syncLayerAcrossTemplates(
                        prev,
                        selectedLayerId,
                        sourceLayer,
                        patch,
                        true,
                    );
                });
                return;
            }
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
                    ? (() => {
                          const template = getExpandedTemplate(config, activeIndex);
                          const canvasW = template.canvas?.width ?? 0;
                          const canvasH = template.canvas?.height ?? 0;
                          const content = "AstroBox";
                          const fontSize = 32;
                          const { width: boxW, height: boxH } = measureTextSize(
                              content,
                              fontSize,
                              400,
                              "sans-serif",
                              0,
                              1.2,
                          );
                          const textBox = {
                              x: Math.max(0, Math.round((canvasW - boxW) / 2)),
                              y: Math.max(0, Math.round((canvasH - boxH) / 2)),
                              width: Math.max(1, Math.round(boxW)),
                              height: Math.max(1, Math.round(boxH)),
                          };
                          return {
                              id: genId("text"),
                              name: "文字",
                              type: "text",
                              clip: "frame",
                              opacity: { default: 1, min: 0, max: 1, step: 0.01, adjustable: true },
                              blendMode: "normal",
                              content: { default: content, adjustable: true },
                              maxLength: 20,
                              textBox,
                              font: {
                                  default: "sans-serif",
                                  adjustable: true,
                                  options: [{ id: "sans-serif", name: "默认字体", family: "sans-serif" }],
                              },
                              fontSize: { default: fontSize, min: 8, max: 120, step: 1, adjustable: true },
                              fontWeight: { default: 400, min: 100, max: 900, step: 100, adjustable: true },
                              color: { default: "#ffffff", adjustable: true, allowCustom: true },
                              textAlign: { default: "center", adjustable: true, options: ["left", "center", "right"] },
                              verticalAlign: { default: "middle", adjustable: true, options: ["top", "middle", "bottom"] },
                              letterSpacing: { default: 0, min: -4, max: 20, step: 1, adjustable: true },
                              lineHeight: { default: 1.2, min: 0.5, max: 3, step: 0.05, adjustable: true },
                          };
                      })()
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
            setSelection({ kind: "layer", layerId: layer.id });
        },
        [activeIndex, config],
    );

    const handleSelectCanvas = useCallback(() => {
        setSelection({ kind: "canvas" });
    }, []);

    const handleSelectLayer = useCallback((layerId: string) => {
        setSelection({ kind: "layer", layerId });
    }, []);

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
            setSelection({ kind: "layer", layerId: layer.id });
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

    const handleFontUpload = useCallback(
        async (file: File) => {
            if (!config || !selectedLayerId) return;
            const configPath = `./assets/${file.name}`;
            const url = URL.createObjectURL(file);
            setAssetFiles((prev) => ({
                ...prev,
                [configPath]: assetFileForRepoPath(configPathToRepoPath(configPath), url, file),
            }));
            const option: WallpaperFontOptionConfig = {
                id: `font-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
                name: file.name,
                family: file.name.replace(/\.[^.]+$/, ""),
                src: configPath,
            };
            setConfig((prev) => {
                if (!prev) return prev;
                const sourceLayer = getLayer(prev, activeIndex, selectedLayerId);
                const current = sourceLayer?.font;
                const fontControl: WallpaperFontControlConfig =
                    current && typeof current !== "string"
                        ? current
                        : {
                              default: "sans-serif",
                              adjustable: true,
                              options: [{ id: "sans-serif", name: "默认字体", family: "sans-serif" }],
                          };
                const options = [...(fontControl.options ?? []).filter((entry) => entry.id !== option.id), option];
                const patch = {
                    font: { ...fontControl, default: option.id, options },
                } as Partial<WallpaperLayerConfig>;
                return sourceLayer?.syncAcrossDevices === true
                    ? syncLayerAcrossTemplates(prev, selectedLayerId, sourceLayer, patch, true)
                    : updateLayer(prev, activeIndex, selectedLayerId, patch);
            });
        },
        [activeIndex, config, selectedLayerId],
    );

    // 文字框自适应内容：按当前内容/字号/字重/字体重新测量并把文字框居中。
    const handleFitTextBox = useCallback(() => {
        if (!config || !selectedLayerId) return;
        const layer = getLayer(config, activeIndex, selectedLayerId);
        if (!layer || layer.type !== "text") return;
        const template = getExpandedTemplate(config, activeIndex);
        const canvasW = template.canvas?.width ?? 0;
        const canvasH = template.canvas?.height ?? 0;
        const content = typeof layer.content === "string" ? layer.content : (layer.content?.default ?? "");
        const fontSize = controlDefault(layer.fontSize, 32);
        const fontWeight = controlDefault(layer.fontWeight, 400);
        const letterSpacing = controlDefault(layer.letterSpacing, 0);
        const lineHeight = controlDefault(layer.lineHeight, 1.2);
        const fontControl = typeof layer.font === "string" ? undefined : layer.font;
        const fontFamily =
            typeof layer.font === "string"
                ? layer.font
                : (fontControl?.options?.find((option) => option.id === fontControl?.default)?.family ??
                  "sans-serif");
        const { width, height } = measureTextSize(content, fontSize, fontWeight, fontFamily, letterSpacing, lineHeight);
        const textBox = {
            x: Math.max(0, Math.round((canvasW - width) / 2)),
            y: Math.max(0, Math.round((canvasH - height) / 2)),
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
        };
        setConfig((prev) => (prev ? updateLayer(prev, activeIndex, selectedLayerId, { textBox }) : prev));
    }, [activeIndex, config, selectedLayerId]);

    const handleRemoveLayer = useCallback(
        (id: string) => {
            if (!config) return;
            setConfig((prev) => (prev ? removeLayer(prev, activeIndex, id) : prev));
            if (selectedLayerId === id) setSelection({ kind: "canvas" });
        },
        [activeIndex, config, selectedLayerId],
    );

    const handleMoveLayerTo = useCallback(
        (layerId: string, toIndex: number) => {
            if (!config) return;
            setConfig((prev) => (prev ? moveLayerToIndex(prev, activeIndex, layerId, toIndex) : prev));
        },
        [activeIndex, config],
    );

    const handleCanvasPatch = useCallback(
        (patch: Partial<WallpaperTemplateConfig>) => {
            if (!config) return;
            setConfig((prev) => (prev ? updateTemplate(prev, activeIndex, patch) : prev));
        },
        [activeIndex, config],
    );

    const handleDuplicateTemplate = useCallback(
        (index: number) => {
            if (!config) return;
            setConfig((prev) => (prev ? duplicateTemplateAt(prev, index) : prev));
        },
        [config],
    );

    const handleRemoveTemplate = useCallback(
        (index: number) => {
            if (!config || config.templates.length <= 1) return;
            setConfig((prev) => (prev ? removeTemplate(prev, index) : prev));
        },
        [config],
    );

    const handleTransformPatch = useCallback(
        (patch: Record<string, unknown>) => {
            if (!config) return;
            // 仅当默认值改变时重置实时预览；改区间/步长/可调不影响当前视图。
            const patchScale = patch.scale;
            const patchRotation = patch.rotation;
            const current = getExpandedTemplate(config, activeIndex)?.wallpaperTransform ?? {};
            const scaleDefaultChanged =
                controlDefault(patchScale as WallpaperControlValue, 1) !==
                controlDefault(current.scale, 1);
            const rotationDefaultChanged =
                controlDefault(patchRotation as WallpaperControlValue, 0) !==
                controlDefault(current.rotation, 0);
            if (scaleDefaultChanged || rotationDefaultChanged) {
                resetTransformOnChangeRef.current = true;
            }
            // 整体缩放/旋转为全局设置：应用到所有设备。
            setConfig((prev) => {
                if (!prev) return prev;
                let next = prev;
                for (let index = 0; index < next.templates.length; index++) {
                    next = updateWallpaperTransform(next, index, patch);
                }
                return next;
            });
        },
        [activeIndex, config],
    );

    const handleCreateFromPreset = useCallback((presetId: string) => {
        const preset = WALLPAPER_DEVICE_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;
        const created = createWallpaperConfig(preset);
        setConfig(created);
        setActiveTemplate(0);
        setSelection({ kind: "canvas" });
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
        setSelection({ kind: "canvas" });
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
                            onSelectLayer={handleSelectLayer}
                            onAddLayer={handleAddLayer}
                            onRemoveLayer={handleRemoveLayer}
                            onMoveLayerTo={handleMoveLayerTo}
                            transform={{
                                scale: transformControls.scale,
                                rotation: transformControls.rotation,
                                onScaleChange: (patch) => handleTransformPatch({ scale: patchControlMerge(transformControls.scale, patch) }),
                                onRotationChange: (patch) => handleTransformPatch({ rotation: patchControlMerge(transformControls.rotation, patch) }),
                            }}
                            onRenderSimplifyChange={setRenderSimplify}
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
                                selectedLayerId={selectedLayerId}
                                simplify={renderSimplify}
                                onActiveTemplateChange={setActiveTemplate}
                                onSelectCanvas={handleSelectCanvas}
                                onTransformChange={handleTransformChange}
                                onDuplicateTemplate={handleDuplicateTemplate}
                                onRemoveTemplate={handleRemoveTemplate}
                            />
                        </main>
                        <div style={{ width: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                        <Inspector
                            mode={inspectorMode}
                            layer={selectedLayer}
                            onLayerPatch={handleLayerPatch}
                            onAssetUpload={(file) => void handleAssetReplace(file)}
                            onMaskUpload={(file) => void handleMaskUpload(file)}
                            onFontUpload={(file) => void handleFontUpload(file)}
                            onFitTextBox={() => void handleFitTextBox()}
                            onClearMask={() => handleLayerPatch({ mask: undefined })}
                            canvas={expandedActiveTemplate}
                            onCanvasPatch={handleCanvasPatch}
                            onRenderSimplifyChange={setRenderSimplify}
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

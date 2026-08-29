import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { WallpaperStage } from "@claralight-design/wallpaper-engine/react";
import type {
    ResolvedWallpaperTemplate,
    WallpaperEditorState,
    WallpaperResources,
    WallpaperTransformState,
} from "@claralight-design/wallpaper-engine";
import { CopyIcon, TrashIcon } from "@phosphor-icons/react";
import type { WallpaperLayerConfig } from "~/logic/wallpaper/types";

/**
 * 拖拽/捏合缩放期间临时去掉模糊、背景模糊与混合模式，避免实时重绘卡顿；
 * 手势结束后恢复原状态重绘。
 */
function simplifyEditorState(state: WallpaperEditorState): WallpaperEditorState {
    const layers: WallpaperEditorState["layers"] = {};
    for (const [id, layer] of Object.entries(state.layers)) {
        layers[id] = {
            ...layer,
            blur: 0,
            backdropBlur: 0,
            blendMode: "normal",
        };
    }
    return { transform: state.transform, layers };
}

export interface CanvasStageProps {
    resolved: ResolvedWallpaperTemplate[];
    templateStates: Record<string, WallpaperEditorState>;
    resources: Record<string, WallpaperResources>;
    baseImage?: HTMLImageElement | null;
    activeTemplate: number;
    /** 当前选中的图层（用于在画布上叠加定界框）。 */
    selectedLayerId?: string | null;
    /** 外部（如滑块拖动）要求临时简化渲染（暂停模糊/混合模式）。 */
    simplify?: boolean;
    /** 渲染失败回调（蒙版/素材未加载等）；参数为空字符串表示渲染恢复。 */
    onRenderError?: (message: string) => void;
    onActiveTemplateChange: (index: number) => void;
    onSelectCanvas: () => void;
    onTransformChange: (templateId: string, transform: WallpaperTransformState) => void;
    onLayerTransformChange: (patch: Partial<WallpaperLayerConfig>) => void;
    onDuplicateTemplate: (index: number) => void;
    onRemoveTemplate: (index: number) => void;
}

type EditableLayerKind = "asset" | "text" | "glass";

type LayerEditFrame = {
    kind: EditableLayerKind;
    layerId: string;
    baseX: number;
    baseY: number;
    baseWidth: number;
    baseHeight: number;
    transformX: number;
    transformY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
};

type LayerEditInteraction = {
    pointerId: number;
    mode: "move" | "resize" | "rotate";
    handleX: -1 | 0 | 1;
    handleY: -1 | 0 | 1;
    startPoint: { x: number; y: number };
    startPointerAngle: number;
    startFrame: LayerEditFrame;
};

function layerEditFrame(layer: ResolvedWallpaperTemplate["layers"][number]): LayerEditFrame | null {
    if (layer.type === "asset" && layer.rect) {
        const scale = layer.transform.scale ?? 1;
        const width = Math.max(1, Math.abs(layer.rect.width * scale));
        const height = Math.max(1, Math.abs(layer.rect.height * scale));
        return {
            kind: "asset",
            layerId: layer.id,
            baseX: layer.rect.x,
            baseY: layer.rect.y,
            baseWidth: Math.max(1, Math.abs(layer.rect.width)),
            baseHeight: Math.max(1, Math.abs(layer.rect.height)),
            transformX: layer.transform.x ?? 0,
            transformY: layer.transform.y ?? 0,
            scaleX: scale,
            scaleY: scale,
            rotation: layer.transform.rotation ?? 0,
            width,
            height,
            centerX: layer.rect.x + layer.rect.width / 2 + (layer.transform.x ?? 0),
            centerY: layer.rect.y + layer.rect.height / 2 + (layer.transform.y ?? 0),
        };
    }

    if (layer.type === "text" && layer.text) {
        const box = layer.text.box;
        const scale = layer.transform.scale ?? 1;
        const width = Math.max(1, Math.abs(box.width.default * scale));
        const height = Math.max(1, Math.abs(box.height.default * scale));
        return {
            kind: "text",
            layerId: layer.id,
            baseX: box.x.default,
            baseY: box.y.default,
            baseWidth: Math.max(1, Math.abs(box.width.default)),
            baseHeight: Math.max(1, Math.abs(box.height.default)),
            transformX: layer.transform.x ?? 0,
            transformY: layer.transform.y ?? 0,
            scaleX: scale,
            scaleY: scale,
            rotation: layer.transform.rotation ?? 0,
            width,
            height,
            centerX: box.x.default + box.width.default / 2 + (layer.transform.x ?? 0),
            centerY: box.y.default + box.height.default / 2 + (layer.transform.y ?? 0),
        };
    }

    if (layer.type === "glass" && layer.glass) {
        const geometry = layer.glass.geometry;
        const baseWidth = geometry.type === "circle" ? geometry.diameter : geometry.width;
        const baseHeight = geometry.type === "circle" ? geometry.diameter : geometry.height;
        const scaleX = layer.glass.transform.scaleX;
        const scaleY = layer.glass.transform.scaleY;
        const width = Math.max(1, Math.abs(baseWidth * scaleX));
        const height = Math.max(1, Math.abs(baseHeight * scaleY));
        return {
            kind: "glass",
            layerId: layer.id,
            baseX: 0,
            baseY: 0,
            baseWidth: Math.max(1, Math.abs(baseWidth)),
            baseHeight: Math.max(1, Math.abs(baseHeight)),
            transformX: layer.glass.transform.x,
            transformY: layer.glass.transform.y,
            scaleX,
            scaleY,
            rotation: layer.glass.transform.rotation,
            width,
            height,
            centerX: layer.glass.transform.x + width / 2,
            centerY: layer.glass.transform.y + height / 2,
        };
    }

    return null;
}

function rotatePoint(x: number, y: number, radians: number): { x: number; y: number } {
    return {
        x: x * Math.cos(radians) - y * Math.sin(radians),
        y: x * Math.sin(radians) + y * Math.cos(radians),
    };
}

function normalizeAngle(value: number): number {
    return ((value % 360) + 360) % 360;
}

function LayerEditOverlay({
    layer,
    canvasWidth,
    previewWidth,
    onPatch,
    onBegin,
    onEnd,
}: {
    layer: ResolvedWallpaperTemplate["layers"][number];
    canvasWidth: number;
    previewWidth: number;
    onPatch: (patch: Partial<WallpaperLayerConfig>) => void;
    onBegin: () => void;
    onEnd: () => void;
}) {
    const frame = layerEditFrame(layer);
    const interactionRef = useRef<LayerEditInteraction | null>(null);
    if (!frame) return null;

    const getCanvasPoint = (event: ReactPointerEvent<HTMLElement>) => {
        const preview = event.currentTarget.closest<HTMLElement>("[data-wallpaper-preview]");
        const bounds = preview?.getBoundingClientRect();
        if (!bounds) return null;
        const scale = previewWidth / Math.max(1, canvasWidth);
        return {
            x: (event.clientX - bounds.left) / scale,
            y: (event.clientY - bounds.top) / scale,
        };
    };

    const beginInteraction = (
        event: ReactPointerEvent<HTMLElement>,
        mode: LayerEditInteraction["mode"],
        handleX: -1 | 0 | 1 = 0,
        handleY: -1 | 0 | 1 = 0,
    ) => {
        const point = getCanvasPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const startPointerAngle =
            (Math.atan2(point.y - frame.centerY, point.x - frame.centerX) * 180) / Math.PI;
        interactionRef.current = {
            pointerId: event.pointerId,
            mode,
            handleX,
            handleY,
            startPoint: point,
            startPointerAngle,
            startFrame: frame,
        };
        onBegin();
    };

    const updateInteraction = (event: ReactPointerEvent<HTMLElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;
        const point = getCanvasPoint(event);
        if (!point) return;
        event.preventDefault();

        const { startFrame } = interaction;
        if (interaction.mode === "move") {
            onPatch({
                transform:
                    startFrame.kind === "glass"
                        ? {
                              x: startFrame.transformX + point.x - interaction.startPoint.x,
                              y: startFrame.transformY + point.y - interaction.startPoint.y,
                              scaleX: startFrame.scaleX,
                              scaleY: startFrame.scaleY,
                              rotation: startFrame.rotation,
                          }
                        : {
                              x: startFrame.transformX + point.x - interaction.startPoint.x,
                              y: startFrame.transformY + point.y - interaction.startPoint.y,
                              scale: startFrame.scaleX,
                              rotation: startFrame.rotation,
                          },
            });
            return;
        }

        if (interaction.mode === "rotate") {
            const currentAngle =
                (Math.atan2(point.y - startFrame.centerY, point.x - startFrame.centerX) * 180) / Math.PI;
            const rotation = normalizeAngle(
                startFrame.rotation + currentAngle - interaction.startPointerAngle,
            );
            onPatch({
                transform:
                    startFrame.kind === "glass"
                        ? { x: startFrame.transformX, y: startFrame.transformY, scaleX: startFrame.scaleX, scaleY: startFrame.scaleY, rotation }
                        : { x: startFrame.transformX, y: startFrame.transformY, scale: startFrame.scaleX, rotation },
            });
            return;
        }

        const radians = (startFrame.rotation * Math.PI) / 180;
        const relative = {
            x: point.x - startFrame.centerX,
            y: point.y - startFrame.centerY,
        };
        const pointerLocal = rotatePoint(relative.x, relative.y, -radians);
        const anchorLocal = {
            x: -interaction.handleX * startFrame.width / 2,
            y: -interaction.handleY * startFrame.height / 2,
        };
        let nextWidth = Math.max(8, Math.abs(pointerLocal.x - anchorLocal.x));
        let nextHeight = Math.max(8, Math.abs(pointerLocal.y - anchorLocal.y));
        let nextScaleX = nextWidth / startFrame.baseWidth;
        let nextScaleY = nextHeight / startFrame.baseHeight;
        if (startFrame.kind !== "glass") {
            const nextScale = Math.max(nextScaleX, nextScaleY);
            nextScaleX = nextScale;
            nextScaleY = nextScale;
            nextWidth = startFrame.baseWidth * nextScale;
            nextHeight = startFrame.baseHeight * nextScale;
        }

        const anchorWorld = {
            x: startFrame.centerX + rotatePoint(anchorLocal.x, anchorLocal.y, radians).x,
            y: startFrame.centerY + rotatePoint(anchorLocal.x, anchorLocal.y, radians).y,
        };
        const nextAnchorLocal = {
            x: -interaction.handleX * nextWidth / 2,
            y: -interaction.handleY * nextHeight / 2,
        };
        const nextCenterOffset = rotatePoint(nextAnchorLocal.x, nextAnchorLocal.y, radians);
        const nextCenter = {
            x: anchorWorld.x - nextCenterOffset.x,
            y: anchorWorld.y - nextCenterOffset.y,
        };

        if (startFrame.kind === "glass") {
            onPatch({
                transform: {
                    x: nextCenter.x - nextWidth / 2,
                    y: nextCenter.y - nextHeight / 2,
                    scaleX: nextScaleX,
                    scaleY: nextScaleY,
                    rotation: startFrame.rotation,
                },
            });
        } else {
            onPatch({
                transform: {
                    x: nextCenter.x - (startFrame.baseX + startFrame.baseWidth / 2),
                    y: nextCenter.y - (startFrame.baseY + startFrame.baseHeight / 2),
                    scale: nextScaleX,
                    rotation: startFrame.rotation,
                },
            });
        }
    };

    const endInteraction = (event: ReactPointerEvent<HTMLElement>) => {
        if (!interactionRef.current || interactionRef.current.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        interactionRef.current = null;
        onEnd();
    };

    const handles: Array<{ x: -1 | 1; y: -1 | 1; label: string }> = [
        { x: -1, y: -1, label: "左上" },
        { x: 1, y: -1, label: "右上" },
        { x: -1, y: 1, label: "左下" },
        { x: 1, y: 1, label: "右下" },
    ];

    return (
        <div
            className="pointer-events-none absolute"
            data-layer-edit-overlay
            style={{
                left: `${(frame.centerX - frame.width / 2) * (previewWidth / canvasWidth)}px`,
                top: `${(frame.centerY - frame.height / 2) * (previewWidth / canvasWidth)}px`,
                width: `${frame.width * (previewWidth / canvasWidth)}px`,
                height: `${frame.height * (previewWidth / canvasWidth)}px`,
                transform: `rotate(${frame.rotation}deg)`,
                transformOrigin: "center",
                zIndex: 2,
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerMove={updateInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
        >
            <div
                className="pointer-events-auto absolute inset-0 cursor-move border border-dashed border-[var(--color-editor-blue-fg)]"
                style={{ borderRadius: frame.kind === "glass" ? "var(--editor-control-radius)" : 2 }}
                onPointerDown={(event) => beginInteraction(event, "move")}
            >
                <span
                    className="absolute left-0 top-0 -translate-y-full whitespace-nowrap px-1 text-[10px] leading-[14px] text-white"
                    style={{
                        background: "var(--color-editor-blue-bg)",
                        borderRadius: 3,
                    }}
                >
                    {layer.name || (frame.kind === "glass" ? "玻璃" : frame.kind === "text" ? "文字" : "图片")}
                </span>
                <div
                    role="button"
                    tabIndex={0}
                    aria-label="拖拽旋转"
                    className="absolute -top-5 left-1/2 grid h-4 w-4 -translate-x-1/2 cursor-grab place-items-center rounded-full border border-[var(--color-editor-blue-fg)] bg-[var(--color-editor-blue-bg)] text-[9px] text-white"
                    onPointerDown={(event) => beginInteraction(event, "rotate")}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                            event.preventDefault();
                            const rotation = normalizeAngle(
                                frame.rotation + (event.key === "ArrowLeft" ? -15 : 15),
                            );
                            onPatch({
                                transform:
                                    frame.kind === "glass"
                                        ? { x: frame.transformX, y: frame.transformY, scaleX: frame.scaleX, scaleY: frame.scaleY, rotation }
                                        : { x: frame.transformX, y: frame.transformY, scale: frame.scaleX, rotation },
                            });
                        }
                    }}
                >
                    ↻
                </div>
                {handles.map((handle) => (
                    <div
                        key={`${handle.x}-${handle.y}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`缩放${handle.label}`}
                        className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white bg-[var(--color-editor-blue-fg)]"
                        style={{
                            left: handle.x === -1 ? "0%" : "100%",
                            top: handle.y === -1 ? "0%" : "100%",
                        }}
                        onPointerDown={(event) => beginInteraction(event, "resize", handle.x, handle.y)}
                    />
                ))}
            </div>
        </div>
    );
}

/** 设备预览标题优先展示面向用户的表盘名称。 */
function deviceModel(template: ResolvedWallpaperTemplate): string {
    return (
        template.watchface?.name ||
        template.aliases?.[0] ||
        template.deviceKey ||
        template.id
    );
}

/** Display size of a canvas preview: real canvas aspect ratio, scaled to fit the max box. */
function previewDisplaySize(template: ResolvedWallpaperTemplate): {
    width: number;
    height: number;
    radius: number;
} {
    const cw = template.canvas?.width ?? 1;
    const ch = template.canvas?.height ?? 1;
    const maxW = 252;
    const maxH = 360;
    const scale = Math.min(maxW / cw, maxH / ch, 1);
    const width = Math.round(cw * scale);
    const height = Math.round(ch * scale);
    // The engine clips layer content to `frame.radius`, so the preview frame must
    // use the same radius (scaled) to match the actual rendered canvas.
    const frameRadius = template.frame?.radius ?? 0;
    const radius = Math.max(
        0,
        Math.min(Math.round(frameRadius * scale), width / 2, height / 2),
    );
    return { width, height, radius };
}

export function CanvasStage({
    resolved,
    templateStates,
    resources,
    baseImage,
    activeTemplate,
    selectedLayerId,
    simplify,
    onActiveTemplateChange,
    onSelectCanvas,
    onTransformChange,
    onLayerTransformChange,
    onDuplicateTemplate,
    onRemoveTemplate,
    onRenderError,
}: CanvasStageProps) {
    const gestureCountRef = useRef(0);
    const [gestureActive, setGestureActive] = useState(false);
    const simplified = Boolean(simplify) || gestureActive;

    useEffect(() => {
        const handleUp = () => {
            gestureCountRef.current = Math.max(0, gestureCountRef.current - 1);
            setGestureActive(gestureCountRef.current > 0);
        };
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        return () => {
            window.removeEventListener("pointerup", handleUp);
            window.removeEventListener("pointercancel", handleUp);
        };
    }, []);

    if (resolved.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center px-6">
                <p className="text-sm text-white/45">
                    暂无可用模板，请先在左侧新建图层或检查配置。
                </p>
            </div>
        );
    }

    return (
        <div className="wallpaper-canvas-scroll h-full w-full overflow-auto">
            <div
                className="flex min-h-full items-center"
                style={{
                    paddingInline: 30,
                    gap: "var(--editor-preview-gap)",
                    width: "max-content",
                    minWidth: "100%",
                }}
            >
                {resolved.map((template, index) => {
                    const state = templateStates[template.id];
                    const resource = resources[template.id];
                    const isActive = index === activeTemplate;
                    const canDelete = resolved.length > 1;
                    const { width: previewW, height: previewH, radius: previewR } =
                        previewDisplaySize(template);
                    return (
                        <div
                            key={template.id}
                            className="flex shrink-0 flex-col"
                            style={{ gap: 12 }}
                        >
                            <div className="flex items-center justify-between" style={{ gap: 8 }}>
                                <div
                                    className="truncate text-sm leading-[18px] text-white/85"
                                    style={{ paddingLeft: 2 }}
                                >
                                    {deviceModel(template)}
                                </div>
                                {isActive && (
                                    <div className="flex items-center" style={{ gap: 2 }}>
                                        <button
                                            type="button"
                                            title="复制设备"
                                            onClick={() => onDuplicateTemplate(index)}
                                            className="grid place-items-center rounded text-white/60 transition hover:bg-white/10 hover:text-white"
                                            style={{ width: 24, height: 24 }}
                                        >
                                            <CopyIcon size={13} weight="regular" />
                                        </button>
                                        <button
                                            type="button"
                                            title="删除设备"
                                            disabled={!canDelete}
                                            onClick={() => onRemoveTemplate(index)}
                                            className="grid place-items-center rounded text-white/60 transition hover:bg-red-400/20 hover:text-red-300 disabled:opacity-30"
                                            style={{ width: 24, height: 24 }}
                                        >
                                            <TrashIcon size={13} weight="regular" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div
                                role="button"
                                tabIndex={0}
                                data-wallpaper-preview
                                onClick={() => {
                                    onActiveTemplateChange(index);
                                    onSelectCanvas();
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onActiveTemplateChange(index);
                                        onSelectCanvas();
                                    }
                                }}
                                onPointerDown={() => {
                                    gestureCountRef.current += 1;
                                    setGestureActive(true);
                                }}
                                className="relative block overflow-hidden transition"
                                style={{
                                    width: previewW,
                                    height: previewH,
                                    borderRadius: previewR,
                                    background: "#000",
                                    border: isActive
                                        ? "1px solid var(--color-editor-blue-fg)"
                                        : "1px solid var(--color-editor-divider)",
                                    cursor: "pointer",
                                }}
                            >
                                {state && (
                                    <div className="wallpaper-preview-fit">
                                        <WallpaperStage
                                            template={template}
                                            editorState={
                                                simplified ? simplifyEditorState(state) : state
                                            }
                                            inputImage={baseImage ?? undefined}
                                            resources={resource ?? { assets: {}, masks: {} }}
                                            onTransformChange={(transform) =>
                                                onTransformChange(template.id, transform)
                                            }
                                            onRenderError={(message) =>
                                                onRenderError?.(message ?? "")
                                            }
                                        />
                                    </div>
                                )}
                                {isActive && selectedLayerId && (() => {
                                    const selectedLayer = template.layers.find((layer) => layer.id === selectedLayerId);
                                    if (!selectedLayer) return null;
                                    return (
                                        <LayerEditOverlay
                                            layer={selectedLayer}
                                            canvasWidth={template.canvas?.width ?? 1}
                                            previewWidth={previewW}
                                            onPatch={onLayerTransformChange}
                                            onBegin={() => {
                                                gestureCountRef.current += 1;
                                                setGestureActive(true);
                                            }}
                                            onEnd={() => undefined}
                                        />
                                    );
                                })()}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

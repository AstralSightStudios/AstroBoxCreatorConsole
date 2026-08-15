import { useEffect, useRef, useState } from "react";
import { WallpaperStage } from "@claralight-design/wallpaper-engine/react";
import type {
    ResolvedWallpaperTemplate,
    WallpaperEditorState,
    WallpaperResources,
    WallpaperTransformState,
} from "@claralight-design/wallpaper-engine";
import { CopyIcon, TrashIcon } from "@phosphor-icons/react";

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
    /** 外部（如滑块拖动）要求临时简化渲染（暂停模糊/混合模式）。 */
    simplify?: boolean;
    onActiveTemplateChange: (index: number) => void;
    onSelectCanvas: () => void;
    onTransformChange: (templateId: string, transform: WallpaperTransformState) => void;
    onDuplicateTemplate: (index: number) => void;
    onRemoveTemplate: (index: number) => void;
}

/** Device model shown above each canvas: prefer deviceKey, then model aliases. */
function deviceModel(template: ResolvedWallpaperTemplate): string {
    return (
        template.deviceKey ||
        template.aliases?.[0] ||
        template.watchface?.name ||
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
    simplify,
    onActiveTemplateChange,
    onSelectCanvas,
    onTransformChange,
    onDuplicateTemplate,
    onRemoveTemplate,
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
                            <button
                                type="button"
                                onClick={() => {
                                    onActiveTemplateChange(index);
                                    onSelectCanvas();
                                }}
                                onPointerDown={() => {
                                    gestureCountRef.current += 1;
                                    setGestureActive(true);
                                }}
                                className="block overflow-hidden transition"
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
                                        />
                                    </div>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

import { WallpaperStage } from "@claralight-design/wallpaper-engine/react";
import type {
    ResolvedWallpaperTemplate,
    WallpaperEditorState,
    WallpaperResources,
    WallpaperTransformState,
} from "@claralight-design/wallpaper-engine";

export interface CanvasStageProps {
    resolved: ResolvedWallpaperTemplate[];
    templateStates: Record<string, WallpaperEditorState>;
    resources: Record<string, WallpaperResources>;
    baseImage?: HTMLImageElement | null;
    activeTemplate: number;
    onActiveTemplateChange: (index: number) => void;
    onTransformChange: (templateId: string, transform: WallpaperTransformState) => void;
}

function templateTitle(template: ResolvedWallpaperTemplate): string {
    return template.watchface?.name || template.deviceKey || template.id;
}

export function CanvasStage({
    resolved,
    templateStates,
    resources,
    baseImage,
    activeTemplate,
    onActiveTemplateChange,
    onTransformChange,
}: CanvasStageProps) {
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
                    return (
                        <div
                            key={template.id}
                            className="flex shrink-0 flex-col"
                            style={{ gap: 12 }}
                        >
                            <div
                                className="text-sm leading-[18px] text-white/85"
                                style={{ paddingLeft: 2 }}
                            >
                                {templateTitle(template)}
                            </div>
                            <button
                                type="button"
                                onClick={() => onActiveTemplateChange(index)}
                                className="block overflow-hidden transition"
                                style={{
                                    width: "var(--editor-preview-width)",
                                    height: "var(--editor-preview-height)",
                                    borderRadius: "var(--editor-preview-radius)",
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
                                            editorState={state}
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

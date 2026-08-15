import { useRef } from "react";
import {
    ArrowLeftIcon,
    CircleHalfIcon,
    DownloadSimpleIcon,
    ImageIcon,
    ImagesIcon,
    TextTIcon,
    UploadIcon,
} from "@phosphor-icons/react";
import type { WallpaperControlValue, WallpaperLayerConfig, WallpaperLayerKind } from "~/logic/wallpaper/types";
import {
    controlAdjustable,
    controlDefault,
    controlMax,
    controlMin,
    controlStep,
} from "~/logic/wallpaper/control";
import {
    EditorActionButton,
    EditorField,
    EditorIconButton,
    EditorNumberField,
    EditorSection,
    EditorSwitch,
} from "./controls";

export interface WallpaperTransformEditorProps {
    scale: WallpaperControlValue | undefined;
    rotation: WallpaperControlValue | undefined;
    onScaleChange: (patch: Partial<{ default: number; min: number; max: number; step: number; adjustable: boolean }>) => void;
    onRotationChange: (patch: Partial<{ default: number; min: number; max: number; step: number; adjustable: boolean }>) => void;
}

export interface SidebarProps {
    title: string;
    onBack: () => void;
    hasConfig: boolean;
    hasBaseImage: boolean;
    onUploadTestImage: (file: File) => void;
    onExport: () => void;
    layers: WallpaperLayerConfig[];
    selectedLayerId: string | null;
    onSelectLayer: (id: string) => void;
    onAddLayer: (kind: WallpaperLayerKind) => void;
    onRemoveLayer: (id: string) => void;
    onMoveLayer: (id: string, direction: -1 | 1) => void;
    transform: WallpaperTransformEditorProps;
}

const LAYER_ADD_ITEMS: Array<{ kind: WallpaperLayerKind; label: string; icon: React.ReactNode }> = [
    { kind: "text", label: "文字", icon: <TextTIcon size={17} weight="regular" /> },
    { kind: "asset", label: "图片素材", icon: <ImageIcon size={17} weight="regular" /> },
    { kind: "wallpaper", label: "壁纸层", icon: <ImagesIcon size={17} weight="regular" /> },
    { kind: "tint", label: "明暗层", icon: <CircleHalfIcon size={17} weight="regular" /> },
];

const LAYER_TYPE_ICONS: Record<WallpaperLayerKind, React.ReactNode> = {
    wallpaper: <ImagesIcon size={16} weight="regular" />,
    asset: <ImageIcon size={16} weight="regular" />,
    text: <TextTIcon size={16} weight="regular" />,
    tint: <CircleHalfIcon size={16} weight="regular" />,
};

function layerTypeIcon(type: WallpaperLayerKind | undefined): React.ReactNode {
    if (type === "wallpaper" || type === "asset" || type === "text" || type === "tint") {
        return LAYER_TYPE_ICONS[type];
    }
    return <ImagesIcon size={16} weight="regular" />;
}

export function Sidebar({
    title,
    onBack,
    hasConfig,
    hasBaseImage,
    onUploadTestImage,
    onExport,
    layers,
    selectedLayerId,
    onSelectLayer,
    onAddLayer,
    onRemoveLayer,
    onMoveLayer,
    transform,
}: SidebarProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const transformRow = (label: string, control: WallpaperControlValue | undefined, onChange: (patch: never) => void, hint: string) => {
        const patch = (key: string, value: number | boolean) => {
            onChange({ [key]: value } as never);
        };
        return (
            <div className="flex w-full items-end gap-2">
                <div className="min-w-0 flex-1">
                    <EditorField label={label}>
                        <EditorNumberField
                            value={controlDefault(control, 0)}
                            min={controlMin(control, 0)}
                            max={controlMax(control, 100)}
                            step={controlStep(control, 0.01)}
                            onChange={(v) => patch("default", v)}
                        />
                    </EditorField>
                </div>
                <div className="pb-1 text-[11px] text-white/40">{hint}</div>
                <div className="pb-1">
                    <EditorSwitch
                        checked={controlAdjustable(control)}
                        onCheckedChange={(v) => patch("adjustable", v)}
                    />
                </div>
            </div>
        );
    };

    return (
        <aside
            className="flex h-full w-[300px] shrink-0 flex-col"
            style={{ background: "var(--color-editor-bg)" }}
        >
            {/* Header */}
            <div className="flex shrink-0 items-start gap-2 px-2 pt-2 pb-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="grid shrink-0 place-items-center rounded text-white/70 transition hover:bg-white/10 hover:text-white"
                    style={{ width: 32, height: 32, marginLeft: 8 }}
                >
                    <ArrowLeftIcon size={18} weight="regular" />
                </button>
                <div className="flex flex-col" style={{ gap: 1, paddingTop: 2 }}>
                    <span className="text-[13px] leading-[18px] text-white/85">壁纸编辑器</span>
                    <span className="text-[13px] leading-[18px] text-white/45">{title}</span>
                </div>
            </div>
            <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />

            {/* Top actions */}
            <div className="flex w-full shrink-0 flex-col px-[9px] pt-[9px]" style={{ gap: 6 }}>
                <EditorActionButton
                    icon={<UploadIcon size={15} weight="regular" />}
                    selected
                    onClick={() => fileInputRef.current?.click()}
                >
                    上传测试壁纸
                </EditorActionButton>
                <EditorActionButton
                    icon={<DownloadSimpleIcon size={15} weight="regular" />}
                    disabled={!hasConfig}
                    onClick={onExport}
                >
                    导出生成结果
                </EditorActionButton>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUploadTestImage(file);
                        e.target.value = "";
                    }}
                />
                {hasBaseImage && (
                    <p className="px-1.5 text-[11px] text-white/45">已上传测试壁纸</p>
                )}
            </div>

            {/* 壁纸属性编辑区域 */}
            {hasConfig && (
                <div className="flex w-full shrink-0 flex-col">
                    <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                    <EditorSection title="壁纸属性编辑区域" className="pt-[9px]">
                        <div className="flex w-full flex-col px-[9px] pt-[9px]" style={{ gap: "var(--editor-field-group-gap)" }}>
                            {transformRow("整体缩放", transform.scale, transform.onScaleChange as never, "可调")}
                            {transformRow("整体旋转", transform.rotation, transform.onRotationChange as never, "可调")}
                        </div>
                    </EditorSection>
                </div>
            )}

            {/* 新建图层 */}
            {hasConfig && (
                <div className="flex w-full shrink-0 flex-col">
                    <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                    <div className="flex w-full flex-col">
                        <h3
                            className="pt-[9px] text-[13px] leading-[18px] text-white/85"
                            style={{ paddingLeft: 16 }}
                        >
                            新建图层
                        </h3>
                        <div
                            className="grid w-full px-[9px] py-2"
                            style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}
                        >
                            {LAYER_ADD_ITEMS.map((item) => (
                                <EditorIconButton
                                    key={item.kind}
                                    title={item.label}
                                    onClick={() => onAddLayer(item.kind)}
                                    style={{ height: 32, borderRadius: 6 }}
                                >
                                    {item.icon}
                                </EditorIconButton>
                            ))}
                        </div>
                    </div>
                    <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                </div>
            )}

            {/* 图层列表 */}
            {hasConfig && (
                <div className="flex min-h-0 w-full flex-1 flex-col">
                    <h3
                        className="pt-[9px] text-[13px] leading-[18px] text-white/85"
                        style={{ paddingLeft: 16 }}
                    >
                        图层
                    </h3>
                    <div className="wallpaper-layer-scroll min-h-0 flex-1 overflow-y-auto px-[9px] pt-[9px] pb-2">
                        <div className="flex w-full flex-col" style={{ gap: "var(--editor-layer-row-gap)" }}>
                            {layers.map((layer, index) => {
                                const isSelected = layer.id === selectedLayerId;
                                const canMoveUp = index > 0;
                                const canMoveDown = index < layers.length - 1;
                                return (
                                    <div
                                        key={layer.id}
                                        onClick={() => onSelectLayer(layer.id)}
                                        className="group flex cursor-pointer items-center"
                                        style={{
                                            height: "var(--editor-layer-row-height)",
                                            borderRadius: "var(--editor-layer-row-radius)",
                                            background: isSelected
                                                ? "var(--color-nav-item-selected)"
                                                : "transparent",
                                            paddingLeft: 8,
                                        }}
                                    >
                                        <span className="shrink-0 text-white/70">
                                            {layerTypeIcon(layer.type)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate pl-2 text-[13px] text-white/85">
                                            {layer.name || layer.id}
                                        </span>
                                        <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                                            <EditorIconButton
                                                title="上移"
                                                disabled={!canMoveUp}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onMoveLayer(layer.id, -1);
                                                }}
                                                style={{ width: 26, height: 26, borderRadius: 6 }}
                                            >
                                                ↑
                                            </EditorIconButton>
                                            <EditorIconButton
                                                title="下移"
                                                disabled={!canMoveDown}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onMoveLayer(layer.id, 1);
                                                }}
                                                style={{ width: 26, height: 26, borderRadius: 6 }}
                                            >
                                                ↓
                                            </EditorIconButton>
                                            <EditorIconButton
                                                title="删除图层"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemoveLayer(layer.id);
                                                }}
                                                style={{ width: 26, height: 26, borderRadius: 6 }}
                                            >
                                                ×
                                            </EditorIconButton>
                                        </span>
                                    </div>
                                );
                            })}
                            {layers.length === 0 && (
                                <p className="px-2 py-2 text-xs text-white/40">
                                    暂无图层，点击上方按钮新建。
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {!hasConfig && (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/40">
                    从预设或导入配置开始
                </div>
            )}
        </aside>
    );
}

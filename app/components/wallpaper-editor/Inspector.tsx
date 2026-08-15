import { useRef } from "react";
import type { ReactNode } from "react";
import {
    ArrowCounterClockwiseIcon,
    ArrowRightIcon,
    BoundingBoxIcon,
    ImageIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import type {
    WallpaperColorControlConfig,
    WallpaperControlValue,
    WallpaperFontControlConfig,
    WallpaperFontOptionConfig,
    WallpaperLayerConfig,
    WallpaperLayerKind,
    WallpaperTemplateConfig,
} from "~/logic/wallpaper/types";
import { controlAdjustable, patchControlValue } from "~/logic/wallpaper/control";
import {
    EditorColorDots,
    EditorField,
    EditorIconButton,
    EditorNumberField,
    EditorSection,
    EditorSelect,
    EditorSwitch,
    EditorTextInput,
    NumericControlEditor,
    TwoColumnGrid,
} from "./controls";

export interface InspectorProps {
    mode: "layer" | "canvas";
    layer: WallpaperLayerConfig | null;
    onLayerPatch: (patch: Partial<WallpaperLayerConfig>) => void;
    onAssetUpload: (file: File) => void;
    onMaskUpload: (file: File) => void;
    onFontUpload: (file: File) => void;
    onFitTextBox: () => void;
    onClearMask: () => void;
    canvas: WallpaperTemplateConfig | null;
    onCanvasPatch: (patch: Partial<WallpaperTemplateConfig>) => void;
    /** 滑块拖动时通知编辑器暂停模糊/混合模式渲染。 */
    onRenderSimplifyChange?: (dragging: boolean) => void;
}

const BLEND_MODES = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
];

const TYPE_OPTIONS: Array<{ value: WallpaperLayerKind; label: string }> = [
    { value: "wallpaper", label: "壁纸" },
    { value: "asset", label: "图片素材" },
    { value: "text", label: "文字" },
    { value: "tint", label: "明暗" },
];

function readColorControl(value: WallpaperLayerConfig["color"] | undefined): WallpaperColorControlConfig | undefined {
    if (typeof value === "string") {
        return { default: value, options: [value], allowCustom: false, adjustable: false };
    }
    if (value && typeof value === "object") return value;
    return undefined;
}

function readOptionDefault(
    value: string | { default?: string; adjustable?: boolean; options?: string[] } | undefined,
    fallback: string,
): string {
    return typeof value === "string" ? value : (value?.default ?? fallback);
}

function readBoxNumber(value: WallpaperControlValue | undefined, fallback: number): number {
    return typeof value === "number" ? value : (value?.default ?? fallback);
}

function patchOption(
    value: string | { default?: string; adjustable?: boolean; options?: string[] } | undefined,
    fallbackOptions: string[],
    patch: Partial<{ default: string; adjustable: boolean }>,
): { default: string; adjustable: boolean; options: string[] } {
    const current: { default?: string; adjustable?: boolean; options?: string[] } =
        typeof value === "string" ? { default: value } : value ?? {};
    const options = Array.isArray(current.options) && current.options.length > 0 ? current.options : fallbackOptions;
    const defaultValue = patch.default ?? current.default ?? fallbackOptions[0];
    return {
        default: options.includes(defaultValue) ? defaultValue : (options[0] ?? fallbackOptions[0]),
        adjustable: patch.adjustable ?? current.adjustable === true,
        options,
    };
}

function fontOptionList(value: WallpaperLayerConfig["font"]): WallpaperFontOptionConfig[] {
    if (typeof value === "string") return [{ id: value, name: value, family: value }];
    const options = value?.options ?? [];
    return options.length > 0 ? options : [{ id: "sans-serif", name: "默认字体", family: "sans-serif" }];
}

function patchFont(
    value: WallpaperLayerConfig["font"],
    patch: Partial<Pick<WallpaperFontControlConfig, "default" | "adjustable">>,
): WallpaperFontControlConfig {
    const options = fontOptionList(value);
    const current: Partial<WallpaperFontControlConfig> =
        typeof value === "object" && value !== null ? value : {};
    const defaultValue = patch.default ?? (typeof value === "string" ? value : current.default ?? "sans-serif");
    return {
        default: options.some((option) => option.id === defaultValue) ? defaultValue : (options[0]?.id ?? "sans-serif"),
        adjustable: patch.adjustable ?? current.adjustable === true,
        options,
    };
}

function AdjustableToggle({
    checked,
    onToggle,
}: {
    checked: boolean;
    onToggle: (value: boolean) => void;
}) {
    return (
        <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] leading-4 text-white/45">用户可修改</span>
            <EditorSwitch checked={checked} onCheckedChange={onToggle} />
        </span>
    );
}

function AdjustableField({
    label,
    adjustable,
    onAdjustableChange,
    children,
}: {
    label: string;
    adjustable: boolean;
    onAdjustableChange: (value: boolean) => void;
    children: ReactNode;
}) {
    return (
        <div className="flex w-full flex-col" style={{ gap: 6 }}>
            <div className="flex items-center justify-between px-1.5">
                <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
                <AdjustableToggle checked={adjustable} onToggle={onAdjustableChange} />
            </div>
            {children}
        </div>
    );
}

function ControlTriple({
    label,
    control,
    onChange,
    onDragStateChange,
    headerRight,
}: {
    label: string;
    control: WallpaperControlValue | undefined;
    onChange: (patch: Partial<{ default: number; min: number; max: number; step: number }>) => void;
    onDragStateChange?: (dragging: boolean) => void;
    headerRight?: ReactNode;
}) {
    return (
        <NumericControlEditor
            label={label}
            control={control}
            onChange={onChange}
            onDragStateChange={onDragStateChange}
            headerRight={headerRight}
        />
    );
}

function CanvasInspector({ canvas, onCanvasPatch }: { canvas: WallpaperTemplateConfig; onCanvasPatch: InspectorProps["onCanvasPatch"] }) {
    const patchCanvas = (patch: Partial<WallpaperTemplateConfig>) => onCanvasPatch(patch);
    const canvasSize = canvas.canvas ?? {};
    const frame = canvas.frame ?? {};
    const preview = canvas.preview ?? {};
    const aliases = Array.isArray(canvas.aliases) ? canvas.aliases : [];

    return (
        <div className="wallpaper-layer-scroll min-h-0 flex-1 overflow-y-auto px-[9px] py-[9px]">
            <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                <EditorField label="设备型号">
                    <EditorTextInput
                        value={canvas.deviceKey ?? ""}
                        placeholder="例如 o67 / band-pro"
                        onChange={(v) => patchCanvas({ deviceKey: v })}
                    />
                </EditorField>
                <EditorField label="设备别名（逗号分隔）">
                    <EditorTextInput
                        value={aliases.join(", ")}
                        placeholder="例如 M2551B1, M2553B1"
                        onChange={(v) =>
                            patchCanvas({
                                aliases: v
                                    .split(/[,，]/)
                                    .map((token) => token.trim())
                                    .filter(Boolean),
                            })
                        }
                    />
                </EditorField>
                <TwoColumnGrid>
                    <EditorField label="画布宽">
                        <EditorNumberField
                            value={canvasSize.width ?? 0}
                            min={1}
                            onChange={(v) => patchCanvas({ canvas: { ...canvasSize, width: Math.max(1, v) } })}
                        />
                    </EditorField>
                    <EditorField label="画布高">
                        <EditorNumberField
                            value={canvasSize.height ?? 0}
                            min={1}
                            onChange={(v) => patchCanvas({ canvas: { ...canvasSize, height: Math.max(1, v) } })}
                        />
                    </EditorField>
                </TwoColumnGrid>
                <EditorField label="画布背景">
                    <EditorTextInput
                        value={canvasSize.background ?? "transparent"}
                        onChange={(v) => patchCanvas({ canvas: { ...canvasSize, background: v } })}
                    />
                </EditorField>
                <TwoColumnGrid>
                    <EditorField label="边框圆角">
                        <EditorNumberField
                            value={frame.radius ?? 0}
                            min={0}
                            onChange={(v) => patchCanvas({ frame: { ...frame, radius: Math.max(0, v) } })}
                        />
                    </EditorField>
                    <EditorField label="预览圆角">
                        <EditorNumberField
                            value={preview.radius ?? 0}
                            min={0}
                            onChange={(v) => patchCanvas({ preview: { ...preview, radius: Math.max(0, v) } })}
                        />
                    </EditorField>
                </TwoColumnGrid>
                <p className="px-1 text-[11px] leading-4 text-white/45">
                    边框圆角决定设备屏幕形状，编辑器预览与此一致；预览圆角为客户端展示用元数据。
                </p>
                <EditorField label="模板 ID">
                    <EditorTextInput
                        value={canvas.id ?? ""}
                        onChange={(v) => patchCanvas({ id: v })}
                    />
                </EditorField>
            </div>
        </div>
    );
}

export function Inspector({
    mode,
    layer,
    onLayerPatch,
    onAssetUpload,
    onMaskUpload,
    onFontUpload,
    onFitTextBox,
    onClearMask,
    canvas,
    onCanvasPatch,
    onRenderSimplifyChange,
}: InspectorProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const maskInputRef = useRef<HTMLInputElement | null>(null);
    const fontInputRef = useRef<HTMLInputElement | null>(null);

    if (mode === "canvas" && canvas) {
        return (
            <aside
                className="flex h-full w-[300px] shrink-0 flex-col"
                style={{ background: "var(--color-editor-bg)" }}
            >
                <div className="flex shrink-0 items-center gap-2 px-2 pt-2 pb-3">
                    <span className="grid shrink-0 place-items-center text-white/70">
                        <ImageIcon size={15} weight="regular" />
                    </span>
                    <span className="text-[13px] leading-[18px] text-white/85">画布属性</span>
                </div>
                <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                <CanvasInspector canvas={canvas} onCanvasPatch={onCanvasPatch} />
            </aside>
        );
    }

    if (!layer) {
        return (
            <aside
                className="flex h-full w-[300px] shrink-0 flex-col items-center justify-center"
                style={{ background: "var(--color-editor-bg)" }}
            >
                <p className="px-6 text-center text-sm text-white/40">
                    点击左侧图层或上方设备画布以编辑
                </p>
            </aside>
        );
    }

    const clip = typeof layer.clip === "string" ? layer.clip : "frame";
    const colorControl = readColorControl(layer.color);
    const transform =
        layer.transform && typeof layer.transform === "object" && !Array.isArray(layer.transform)
            ? layer.transform
            : {};
    const rect = layer.rect && typeof layer.rect === "object" && !Array.isArray(layer.rect)
        ? layer.rect
        : undefined;
    const isAsset = layer.type === "asset";
    const isText = layer.type === "text";
    const isTint = layer.type === "tint";
    const showsTransformBox = isAsset || isText;
    const textContentValue =
        typeof layer.content === "string" ? layer.content : (layer.content?.default ?? "");

    const patchControl = (
        field: "opacity" | "blur" | "backdropBlur" | "amount" | "fontSize" | "fontWeight" | "letterSpacing" | "lineHeight",
        key: "default" | "min" | "max" | "step" | "adjustable",
        value: number | boolean,
    ) => {
        onLayerPatch({ [field]: patchControlValue(layer[field], { [key]: value }) } as Partial<WallpaperLayerConfig>);
    };

    const patchTransform = (patch: Partial<{ x: number; y: number; scale: number; rotation: number }>) => {
        onLayerPatch({ transform: { ...transform, ...patch } });
    };

    const textBox = {
        x: readBoxNumber(layer.textBox?.x, 0),
        y: readBoxNumber(layer.textBox?.y, 0),
        width: readBoxNumber(layer.textBox?.width, 100),
        height: readBoxNumber(layer.textBox?.height, 40),
    };
    const patchTextBox = (patch: Partial<{ x: number; y: number; width: number; height: number }>) => {
        onLayerPatch({ textBox: { ...(layer.textBox ?? {}), ...patch } });
    };

    const blendValue =
        typeof layer.blendMode === "string"
            ? layer.blendMode
            : typeof layer.blendMode?.default === "string"
              ? layer.blendMode.default
              : "normal";

    return (
        <aside
            className="flex h-full w-[300px] shrink-0 flex-col"
            style={{ background: "var(--color-editor-bg)" }}
        >
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 px-2 pt-2 pb-3">
                <span className="grid shrink-0 place-items-center text-white/70">
                    <ImageIcon size={15} weight="regular" />
                </span>
                <span className="text-[13px] leading-[18px] text-white/85">{layer.name || layer.id}</span>
            </div>
            <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />

            {/* 多设备同步（按图层） */}
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--color-editor-divider)" }}>
                <div className="flex flex-col">
                    <span className="text-[13px] leading-[18px] text-white/85">多设备同步</span>
                    <span className="text-[11px] leading-4 text-white/45">
                        仅本图层：透明度 / 模糊 / 背景模糊 / 混合模式 / 文字样式 应用于所有设备
                    </span>
                </div>
                <EditorSwitch
                    checked={layer.syncAcrossDevices === true}
                    onCheckedChange={(v) => onLayerPatch({ syncAcrossDevices: v })}
                />
            </div>

            <div className="wallpaper-layer-scroll min-h-0 flex-1 overflow-y-auto px-[9px] py-[9px]">
                <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                    {/* 素材类型 / 裁切类型 */}
                    <TwoColumnGrid>
                        <EditorField label="素材类型">
                            <EditorSelect
                                value={layer.type}
                                options={TYPE_OPTIONS}
                                onChange={(value) => onLayerPatch({ type: value as WallpaperLayerKind })}
                            />
                        </EditorField>
                        <EditorField label="裁切类型">
                            <EditorSelect
                                value={clip}
                                options={[
                                    { value: "frame", label: "Frame" },
                                    { value: "canvas", label: "Canvas" },
                                ]}
                                onChange={(value) => onLayerPatch({ clip: value as "frame" | "canvas" })}
                            />
                        </EditorField>
                    </TwoColumnGrid>

                    {/* asset 上传控件 */}
                    {isAsset && (
                        <EditorField label="素材文件">
                            <div
                                className="flex w-full cursor-pointer items-center gap-2 px-2"
                                style={{
                                    height: "var(--editor-control-height)",
                                    borderRadius: "var(--editor-control-radius)",
                                    background: "var(--color-editor-control)",
                                }}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <span className="truncate text-sm text-white/70">
                                    {layer.src ? layer.src.split("/").pop() : "点击选择图片"}
                                </span>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) onAssetUpload(file);
                                    e.target.value = "";
                                }}
                            />
                        </EditorField>
                    )}

                    {/* 蒙版 (wallpaper / asset) */}
                    {(layer.type === "wallpaper" || isAsset) && (
                        <EditorField label="蒙版">
                            <div className="flex items-center" style={{ gap: "var(--editor-control-gap)" }}>
                                <div
                                    className="flex flex-1 cursor-pointer items-center gap-2 px-2"
                                    style={{
                                        height: "var(--editor-control-height)",
                                        borderRadius: "var(--editor-control-radius)",
                                        background: "var(--color-editor-control)",
                                    }}
                                    onClick={() => maskInputRef.current?.click()}
                                >
                                    <span className="truncate text-sm text-white/70">
                                        {layer.mask ? layer.mask.split("/").pop() : "点击选择蒙版"}
                                    </span>
                                </div>
                                {layer.mask && (
                                    <button
                                        type="button"
                                        title="清除蒙版"
                                        onClick={onClearMask}
                                        className="grid shrink-0 place-items-center text-white/60 transition hover:text-white"
                                        style={{ width: 34, height: 34 }}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <input
                                ref={maskInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) onMaskUpload(file);
                                    e.target.value = "";
                                }}
                            />
                        </EditorField>
                    )}

                    {/* 文字图层专属设置 */}
                    {isText && (
                        <EditorSection title="文字" className="pt-[9px]">
                            <div className="flex w-full flex-col" style={{ gap: 22 }}>
                                <AdjustableField
                                    label="内容"
                                    adjustable={typeof layer.content === "object" ? layer.content.adjustable === true : false}
                                    onAdjustableChange={(v) =>
                                        onLayerPatch({
                                            content: {
                                                ...(typeof layer.content === "object"
                                                    ? layer.content
                                                    : { default: textContentValue }),
                                                adjustable: v,
                                            },
                                        })
                                    }
                                >
                                    <EditorTextInput
                                        value={textContentValue}
                                        placeholder="输入文字"
                                        onChange={(v) =>
                                            onLayerPatch({
                                                content: {
                                                    default: v,
                                                    adjustable:
                                                        typeof layer.content === "object"
                                                            ? layer.content.adjustable === true
                                                            : false,
                                                },
                                            })
                                        }
                                    />
                                </AdjustableField>
                                <ControlTriple
                                    label="字号"
                                    control={layer.fontSize}
                                    onChange={(patch) => patchControl("fontSize", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                                    onDragStateChange={onRenderSimplifyChange}
                                    headerRight={
                                        <AdjustableToggle
                                            checked={controlAdjustable(layer.fontSize)}
                                            onToggle={(v) => patchControl("fontSize", "adjustable", v)}
                                        />
                                    }
                                />
                                <ControlTriple
                                    label="字重"
                                    control={layer.fontWeight}
                                    onChange={(patch) => patchControl("fontWeight", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                                    onDragStateChange={onRenderSimplifyChange}
                                    headerRight={
                                        <AdjustableToggle
                                            checked={controlAdjustable(layer.fontWeight)}
                                            onToggle={(v) => patchControl("fontWeight", "adjustable", v)}
                                        />
                                    }
                                />
                                <ControlTriple
                                    label="字距"
                                    control={layer.letterSpacing}
                                    onChange={(patch) => patchControl("letterSpacing", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                                    onDragStateChange={onRenderSimplifyChange}
                                    headerRight={
                                        <AdjustableToggle
                                            checked={controlAdjustable(layer.letterSpacing)}
                                            onToggle={(v) => patchControl("letterSpacing", "adjustable", v)}
                                        />
                                    }
                                />
                                <ControlTriple
                                    label="行高"
                                    control={layer.lineHeight}
                                    onChange={(patch) => patchControl("lineHeight", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                                    onDragStateChange={onRenderSimplifyChange}
                                    headerRight={
                                        <AdjustableToggle
                                            checked={controlAdjustable(layer.lineHeight)}
                                            onToggle={(v) => patchControl("lineHeight", "adjustable", v)}
                                        />
                                    }
                                />
                                <AdjustableField
                                    label="对齐"
                                    adjustable={typeof layer.textAlign === "object" ? layer.textAlign.adjustable === true : false}
                                    onAdjustableChange={(v) =>
                                        onLayerPatch({ textAlign: patchOption(layer.textAlign, ["left", "center", "right"], { adjustable: v }) })
                                    }
                                >
                                    <EditorSelect
                                        value={readOptionDefault(layer.textAlign, "left")}
                                        options={[
                                            { value: "left", label: "左对齐" },
                                            { value: "center", label: "居中" },
                                            { value: "right", label: "右对齐" },
                                        ]}
                                        onChange={(value) =>
                                            onLayerPatch({ textAlign: patchOption(layer.textAlign, ["left", "center", "right"], { default: value }) })
                                        }
                                    />
                                </AdjustableField>
                                <AdjustableField
                                    label="垂直对齐"
                                    adjustable={typeof layer.verticalAlign === "object" ? layer.verticalAlign.adjustable === true : false}
                                    onAdjustableChange={(v) =>
                                        onLayerPatch({ verticalAlign: patchOption(layer.verticalAlign, ["top", "middle", "bottom"], { adjustable: v }) })
                                    }
                                >
                                    <EditorSelect
                                        value={readOptionDefault(layer.verticalAlign, "top")}
                                        options={[
                                            { value: "top", label: "顶部" },
                                            { value: "middle", label: "居中" },
                                            { value: "bottom", label: "底部" },
                                        ]}
                                        onChange={(value) =>
                                            onLayerPatch({ verticalAlign: patchOption(layer.verticalAlign, ["top", "middle", "bottom"], { default: value }) })
                                        }
                                    />
                                </AdjustableField>
                                <AdjustableField
                                    label="字体"
                                    adjustable={typeof layer.font === "object" ? layer.font.adjustable === true : false}
                                    onAdjustableChange={(v) => onLayerPatch({ font: patchFont(layer.font, { adjustable: v }) })}
                                >
                                    <div className="flex items-center" style={{ gap: "var(--editor-control-gap)" }}>
                                        <div className="min-w-0 flex-1">
                                            <EditorSelect
                                                value={
                                                    typeof layer.font === "string"
                                                        ? layer.font
                                                        : (layer.font?.default ?? fontOptionList(layer.font)[0]?.id ?? "sans-serif")
                                                }
                                                options={fontOptionList(layer.font).map((option) => ({
                                                    value: option.id,
                                                    label: option.name ?? option.id,
                                                }))}
                                                onChange={(value) => onLayerPatch({ font: patchFont(layer.font, { default: value }) })}
                                            />
                                        </div>
                                        <EditorIconButton title="导入字体" onClick={() => fontInputRef.current?.click()}>
                                            <PlusIcon size={14} weight="regular" />
                                        </EditorIconButton>
                                    </div>
                                    <input
                                        ref={fontInputRef}
                                        type="file"
                                        accept=".ttf,.otf,.woff,.woff2,font/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) onFontUpload(file);
                                            e.target.value = "";
                                        }}
                                    />
                                </AdjustableField>
                                <div className="flex w-full flex-col" style={{ gap: 6 }}>
                                    <div className="flex items-center justify-between px-1.5">
                                        <span className="text-[13px] leading-[18px] text-white/75">文字框</span>
                                        <EditorIconButton title="自适应内容" onClick={onFitTextBox}>
                                            <BoundingBoxIcon size={14} weight="regular" />
                                            <span className="text-xs">自适应</span>
                                        </EditorIconButton>
                                    </div>
                                    <TwoColumnGrid>
                                        <EditorField label="位置 X">
                                            <EditorNumberField value={textBox.x} onChange={(v) => patchTextBox({ x: v })} />
                                        </EditorField>
                                        <EditorField label="位置 Y">
                                            <EditorNumberField value={textBox.y} onChange={(v) => patchTextBox({ y: v })} />
                                        </EditorField>
                                    </TwoColumnGrid>
                                    <TwoColumnGrid>
                                        <EditorField label="宽 (W)">
                                            <EditorNumberField
                                                value={textBox.width}
                                                min={1}
                                                onChange={(v) => patchTextBox({ width: Math.max(1, v) })}
                                            />
                                        </EditorField>
                                        <EditorField label="高 (H)">
                                            <EditorNumberField
                                                value={textBox.height}
                                                min={1}
                                                onChange={(v) => patchTextBox({ height: Math.max(1, v) })}
                                            />
                                        </EditorField>
                                    </TwoColumnGrid>
                                </div>
                                <EditorField label="最大长度">
                                    <EditorNumberField
                                        value={layer.maxLength ?? 20}
                                        min={1}
                                        onChange={(v) => onLayerPatch({ maxLength: Math.max(1, Math.floor(v)) })}
                                    />
                                </EditorField>
                            </div>
                        </EditorSection>
                    )}

                    {/* 位置 / 旋转 / 尺寸 */}
                    {showsTransformBox && (
                        <>
                            <TwoColumnGrid>
                                <EditorField label="位置 X">
                                    <EditorNumberField value={transform.x ?? 0} onChange={(v) => patchTransform({ x: v })} />
                                </EditorField>
                                <EditorField label="位置 Y">
                                    <EditorNumberField value={transform.y ?? 0} onChange={(v) => patchTransform({ y: v })} />
                                </EditorField>
                            </TwoColumnGrid>
                            <EditorField label="旋转">
                                <div
                                    className="grid w-full"
                                    style={{ gridTemplateColumns: "140px repeat(3, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
                                >
                                    <EditorNumberField value={transform.rotation ?? 0} onChange={(v) => patchTransform({ rotation: v })} />
                                    <EditorIconButton title="向左旋转 15°" onClick={() => patchTransform({ rotation: (transform.rotation ?? 0) - 15 })}>
                                        <ArrowCounterClockwiseIcon size={16} weight="regular" />
                                    </EditorIconButton>
                                    <EditorIconButton title="向右旋转 15°" onClick={() => patchTransform({ rotation: (transform.rotation ?? 0) + 15 })}>
                                        <ArrowRightIcon size={16} weight="regular" />
                                    </EditorIconButton>
                                    <EditorIconButton title="重置" onClick={() => patchTransform({ rotation: 0 })}>
                                        ×
                                    </EditorIconButton>
                                </div>
                            </EditorField>
                            {isAsset && rect && (
                                <TwoColumnGrid>
                                    <EditorField label="宽 (W)">
                                        <EditorNumberField value={rect.width ?? 1} onChange={(v) => onLayerPatch({ rect: { ...rect, width: v } })} />
                                    </EditorField>
                                    <EditorField label="高 (H)">
                                        <EditorNumberField value={rect.height ?? 1} onChange={(v) => onLayerPatch({ rect: { ...rect, height: v } })} />
                                    </EditorField>
                                </TwoColumnGrid>
                            )}
                        </>
                    )}

                    {/* 明暗层 */}
                    {isTint && (
                        <>
                            <ControlTriple
                                label="明暗程度"
                                control={layer.amount}
                                onChange={(patch) => patchControl("amount", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                                onDragStateChange={onRenderSimplifyChange}
                            />
                            <TwoColumnGrid>
                                <EditorField label="亮色">
                                    <EditorTextInput value={layer.lightColor ?? "#ffffff"} onChange={(v) => onLayerPatch({ lightColor: v })} />
                                </EditorField>
                                <EditorField label="暗色">
                                    <EditorTextInput value={layer.darkColor ?? "#000000"} onChange={(v) => onLayerPatch({ darkColor: v })} />
                                </EditorField>
                            </TwoColumnGrid>
                        </>
                    )}

                    {/* 透明度 / 模糊 / 背景模糊 */}
                    <ControlTriple
                        label="透明度"
                        control={layer.opacity}
                        onChange={(patch) => patchControl("opacity", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                        onDragStateChange={onRenderSimplifyChange}
                    />
                    <ControlTriple
                        label="模糊"
                        control={layer.blur}
                        onChange={(patch) => patchControl("blur", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                        onDragStateChange={onRenderSimplifyChange}
                    />
                    <ControlTriple
                        label="背景模糊"
                        control={layer.backdropBlur}
                        onChange={(patch) => patchControl("backdropBlur", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                        onDragStateChange={onRenderSimplifyChange}
                    />

                    {/* 着色 (asset tint / text color) */}
                    {(isAsset || isText) && colorControl && (
                        <EditorField label="着色">
                            <EditorColorDots
                                colors={colorControl.options?.length ? colorControl.options : [colorControl.default]}
                                selected={colorControl.default}
                                allowCustom={colorControl.allowCustom}
                                onSelect={(color) =>
                                    onLayerPatch({
                                        color: {
                                            ...colorControl,
                                            default: color,
                                            options: colorControl.options?.includes(color)
                                                ? colorControl.options
                                                : [...(colorControl.options ?? []), color],
                                        },
                                    })
                                }
                            />
                        </EditorField>
                    )}

                    {/* 混合模式 */}
                    <EditorField label="混合模式">
                        <EditorSelect
                            value={blendValue}
                            options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                            onChange={(value) => {
                                const current: { default?: string; adjustable?: boolean; options?: string[] } =
                                    typeof layer.blendMode === "string" ? {} : layer.blendMode ?? {};
                                onLayerPatch({
                                    blendMode: { ...current, default: value, adjustable: current.adjustable ?? false },
                                });
                            }}
                        />
                    </EditorField>

                    {/* 用户可修改 */}
                    <EditorSection title="用户可修改" noDivider className="pt-[9px]">
                        <div className="flex w-full flex-col" style={{ gap: 40 }}>
                            {(
                                [
                                    { key: "opacity", label: "透明度" },
                                    { key: "blur", label: "模糊" },
                                    { key: "backdropBlur", label: "背景模糊" },
                                    ...(isTint
                                        ? ([{ key: "amount", label: "明暗程度" }] as const)
                                        : []),
                                ] as const
                            ).map(({ key, label }) => (
                                <div
                                    key={key}
                                    className="flex items-center justify-between"
                                    style={{ paddingLeft: 17, paddingRight: 19 }}
                                >
                                    <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
                                    <EditorSwitch
                                        checked={controlAdjustable(layer[key])}
                                        onCheckedChange={(v) => patchControl(key, "adjustable", v)}
                                    />
                                </div>
                            ))}
                        </div>
                    </EditorSection>
                </div>
            </div>
        </aside>
    );
}

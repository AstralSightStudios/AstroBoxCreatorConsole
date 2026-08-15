import { useRef } from "react";
import {
    ArrowCounterClockwiseIcon,
    ArrowRightIcon,
    ImageIcon,
} from "@phosphor-icons/react";
import type {
    WallpaperColorControlConfig,
    WallpaperControlValue,
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

function ControlTriple({
    label,
    control,
    onChange,
    onDragStateChange,
}: {
    label: string;
    control: WallpaperControlValue | undefined;
    onChange: (patch: Partial<{ default: number; min: number; max: number; step: number }>) => void;
    onDragStateChange?: (dragging: boolean) => void;
}) {
    return (
        <NumericControlEditor
            label={label}
            control={control}
            onChange={onChange}
            onDragStateChange={onDragStateChange}
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
    onClearMask,
    canvas,
    onCanvasPatch,
    onRenderSimplifyChange,
}: InspectorProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const maskInputRef = useRef<HTMLInputElement | null>(null);

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

    const patchControl = (
        field: "opacity" | "blur" | "backdropBlur" | "amount",
        key: "default" | "min" | "max" | "step" | "adjustable",
        value: number | boolean,
    ) => {
        onLayerPatch({ [field]: patchControlValue(layer[field], { [key]: value }) } as Partial<WallpaperLayerConfig>);
    };

    const patchTransform = (patch: Partial<{ x: number; y: number; scale: number; rotation: number }>) => {
        onLayerPatch({ transform: { ...transform, ...patch } });
    };

    const patchText = (patch: Partial<NonNullable<WallpaperLayerConfig["text"]>>) => {
        onLayerPatch({ text: { ...(layer.text ?? {}), ...patch } });
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
                        仅本图层：透明度 / 模糊 / 背景模糊 / 混合模式 应用于所有设备
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

                    {/* 内容 (text) */}
                    {isText && (
                        <EditorField label="内容">
                            <EditorTextInput
                                value={
                                    typeof layer.text?.content === "string"
                                        ? layer.text.content
                                        : layer.text?.content?.default ?? ""
                                }
                                placeholder="输入文字"
                                onChange={(v) => patchText({ content: { default: v, adjustable: true } })}
                            />
                        </EditorField>
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

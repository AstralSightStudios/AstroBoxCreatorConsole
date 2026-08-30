import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { AlertDialog, Button, Checkbox, Popover } from "@radix-ui/themes";
import {
    ArrowClockwiseIcon,
    BoundingBoxIcon,
    CaretDownIcon,
    FlipHorizontalIcon,
    FlipVerticalIcon,
    ImageIcon,
    InfoIcon,
    PlusIcon,
    SunIcon,
} from "@phosphor-icons/react";
import type {
    WallpaperColorControlConfig,
    WallpaperControlValue,
    WallpaperFontControlConfig,
    WallpaperFontOptionConfig,
    WallpaperGlassBlendMode,
    WallpaperGlassGeometryConfig,
    WallpaperGlassMaterialConfig,
    WallpaperLayerConfig,
    WallpaperLayerBlendMode,
    WallpaperLayerKind,
    WallpaperTemplateConfig,
} from "~/logic/wallpaper/types";
import {
    GLASS_BLEND_MODES,
    GLASS_MATERIAL_DEFAULTS,
    LAYER_BLEND_MODES,
} from "~/logic/wallpaper/types";
import { controlAdjustable, controlDefault, patchControlValue } from "~/logic/wallpaper/control";
import {
    EditorColorOpacityField,
    EditorColorDots,
    EditorField,
    EditorIconButton,
    EditorNumberField,
    EditorSection,
    EditorSelect,
    EditorSlider,
    EditorSwitch,
    EditorTextInput,
    NumericControlEditor,
    TwoColumnGrid,
} from "./controls";
import { formatEditorColorOpacity, parseEditorColorOpacity } from "./color-opacity";

export interface InspectorProps {
    mode: "layer" | "canvas";
    layer: WallpaperLayerConfig | null;
    onLayerPatch: (patch: Partial<WallpaperLayerConfig>) => void;
    onAssetUpload: (file: File) => void;
    onAssetFlip: (axis: "x" | "y") => void;
    onMaskUpload: (file: File) => void;
    onFontUpload: (file: File) => void;
    onFitTextBox: () => void;
    onClearMask: () => void;
    canvas: WallpaperTemplateConfig | null;
    onCanvasPatch: (patch: Partial<WallpaperTemplateConfig>) => void;
    wallpaperTransform: {
        scale: WallpaperControlValue | undefined;
        rotation: WallpaperControlValue | undefined;
        onScaleChange: (patch: Partial<{ default: number; min: number; max: number; step: number; adjustable: boolean }>) => void;
        onRotationChange: (patch: Partial<{ default: number; min: number; max: number; step: number; adjustable: boolean }>) => void;
    };
    /** 数值拖动时通知编辑器暂停模糊/混合模式渲染。 */
    onRenderSimplifyChange?: (dragging: boolean) => void;
}

const GLASS_BLEND_MODE_LABELS: Record<WallpaperGlassBlendMode, string> = {
    normal: "正常",
    multiply: "正片叠底",
    screen: "滤色",
    overlay: "叠加",
    darken: "变暗",
    lighten: "变亮",
    "color-dodge": "颜色减淡",
    "color-burn": "颜色加深",
    "hard-light": "强光",
    "soft-light": "柔光",
    difference: "差值",
    exclusion: "排除",
    "linear-dodge": "线性减淡",
    "linear-burn": "线性加深",
};

const GLASS_BLEND_MODE_OPTIONS: Array<{ value: string; label: string }> = GLASS_BLEND_MODES.map(
    (mode) => ({ value: mode, label: `${mode} ${GLASS_BLEND_MODE_LABELS[mode]}` }),
);

const LAYER_BLEND_MODE_LABELS: Record<WallpaperLayerBlendMode, string> = {
    normal: "正常",
    multiply: "正片叠底",
    screen: "滤色",
    overlay: "叠加",
    darken: "变暗",
    lighten: "变亮",
    "color-dodge": "颜色减淡",
    "color-burn": "颜色加深",
    "hard-light": "强光",
    "soft-light": "柔光",
    difference: "差值",
    exclusion: "排除",
    hue: "色相",
    saturation: "饱和度",
    color: "颜色",
    luminosity: "明度",
};

const LAYER_BLEND_MODE_OPTIONS: Array<{ value: string; label: string }> =
    LAYER_BLEND_MODES.map((mode) => ({
        value: mode,
        label: `${mode} ${LAYER_BLEND_MODE_LABELS[mode]}`,
    }));

const TYPE_OPTIONS: Array<{ value: WallpaperLayerKind; label: string }> = [
    { value: "wallpaper", label: "壁纸" },
    { value: "asset", label: "图片素材" },
    { value: "text", label: "文字" },
    { value: "glass", label: "玻璃" },
    { value: "tint", label: "明暗" },
];

const MASK_IMPORT_NOTICE_KEY = "astrobox.wallpaper.mask-import-notice.v1";
const COLOR_EDIT_NOTICE_KEY = "astrobox.wallpaper.color-edit-notice.v1";

function LuminanceMaskDiagram() {
    return (
        <div
            className="grid overflow-hidden"
            aria-label="白色完全显示，灰色半透明，黑色完全隐藏"
            style={{
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "var(--editor-control-gap)",
                borderRadius: "var(--editor-control-radius)",
                background: "var(--color-editor-divider)",
            }}
        >
            {[
                { color: "#ffffff", tone: "白色", result: "完全显示", text: "#111111" },
                { color: "#808080", tone: "灰色", result: "半透明", text: "#ffffff" },
                { color: "#000000", tone: "黑色", result: "完全隐藏", text: "#ffffff" },
            ].map((item) => (
                <div
                    key={item.tone}
                    className="flex h-16 flex-col items-center justify-center"
                    style={{ background: item.color, color: item.text }}
                >
                    <span className="text-[11px] font-medium">{item.tone}</span>
                    <span className="text-[10px] opacity-70">{item.result}</span>
                </div>
            ))}
        </div>
    );
}

function ColorEditGuide({
    showTitle = true,
    showDescription = true,
}: {
    showTitle?: boolean;
    showDescription?: boolean;
}) {
    return (
        <div className="flex flex-col" style={{ gap: 8 }}>
            {showTitle && <strong className="text-[12px] font-medium">着色说明</strong>}
            {showDescription && (
                <p className="text-[11px] leading-4 text-gray-11">
                    图片着色会把所有非透明像素替换为所选颜色，保留原透明度和轮廓，但不会保留原图颜色；更适合单色图标或装饰素材。
                </p>
            )}
            <div className="flex flex-col overflow-hidden" style={{ gap: "var(--editor-control-gap)" }}>
                {[
                    ["选中颜色", "单击修改颜色"],
                    ["未选中颜色", "单击选中，双击修改"],
                    ["任意颜色", "右键选择删除"],
                    ["加号", "添加新颜色"],
                ].map(([name, action]) => (
                    <div
                        key={name}
                        className="flex items-center justify-between px-2 text-[11px]"
                        style={{
                            height: "var(--editor-control-height)",
                            borderRadius: "var(--editor-control-radius)",
                            background: "var(--color-editor-control)",
                        }}
                    >
                        <span className="text-white/75">{name}</span>
                        <span className="text-white/45">{action}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

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

function clampAxis(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function axisStep(axis: { min: number; max: number }): number {
    const range = axis.max - axis.min;
    if (range <= 0) return 1;
    return range > 20 ? 1 : Math.max(0.01, range / 100);
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

function AdjustableCheckboxRow({
    label,
    checked,
    onCheckedChange,
    disabled = false,
}: {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div
            className="flex items-center"
            style={{
                height: "var(--editor-control-height)",
                gap: 8,
                paddingInline: 10,
                borderRadius: "var(--editor-control-radius)",
                background: "var(--color-editor-control)",
                opacity: disabled ? 0.4 : 1,
            }}
        >
            <Checkbox
                disabled={disabled}
                checked={checked}
                onCheckedChange={(value) => onCheckedChange(value === true)}
            />
            <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
        </div>
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

function GlassLightField({
    angle,
    intensity,
    onAngleChange,
    onIntensityChange,
}: {
    angle: number;
    intensity: number;
    onAngleChange: (value: number) => void;
    onIntensityChange: (value: number) => void;
}) {
    const padRef = useRef<HTMLDivElement | null>(null);
    const updateAngleFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = padRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = event.clientX - (rect.left + rect.width / 2);
        const y = event.clientY - (rect.top + rect.height / 2);
        const next = (Math.atan2(x, -y) * 180) / Math.PI;
        onAngleChange(Math.round((next + 360) % 360));
    };
    const angleInRadians = (angle * Math.PI) / 180;
    const indicatorX = 50 + Math.sin(angleInRadians) * 32;
    const indicatorY = 50 - Math.cos(angleInRadians) * 32;

    return (
        <div className="flex w-full items-center" style={{ gap: 8 }}>
            <span className="w-[42px] shrink-0 text-[13px] leading-[18px] text-white/75">
                方向
            </span>
            <div className="flex min-w-0 flex-1 items-center" style={{ gap: 8 }}>
                <div
                    ref={padRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="光照角度"
                    aria-valuemin={0}
                    aria-valuemax={360}
                    aria-valuenow={Math.round(angle)}
                    className="relative h-[72px] w-[104px] shrink-0 cursor-crosshair overflow-hidden"
                    style={{
                        borderRadius: "var(--editor-control-radius)",
                        background:
                            "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 42%, rgba(0,0,0,0.32))",
                    }}
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        updateAngleFromPointer(event);
                    }}
                    onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            updateAngleFromPointer(event);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                            event.preventDefault();
                            onAngleChange((angle + 359) % 360);
                        }
                        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                            event.preventDefault();
                            onAngleChange((angle + 1) % 360);
                        }
                    }}
                >
                    <div
                        className="absolute left-1/2 top-1/2 h-px w-[34px] origin-left"
                        style={{
                            background: "var(--color-editor-blue-fg)",
                            transform: `rotate(${angle - 90}deg)`,
                        }}
                    />
                    <div
                        className="absolute grid h-[24px] w-[24px] place-items-center"
                        style={{
                            left: `${indicatorX}%`,
                            top: `${indicatorY}%`,
                            borderRadius: "50%",
                            background: "var(--color-editor-blue-bg)",
                            color: "var(--color-editor-blue-fg)",
                            transform: "translate(-50%, -50%)",
                        }}
                    >
                        <SunIcon size={16} weight="regular" />
                    </div>
                    <div
                        className="absolute left-1/2 top-1/2 h-1.5 w-1.5"
                        style={{
                            borderRadius: "50%",
                            background: "var(--color-editor-blue-fg)",
                            transform: "translate(-50%, -50%)",
                        }}
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 4 }}>
                    <EditorNumberField
                        value={Math.round(angle)}
                        min={0}
                        max={360}
                        step={1}
                        suffix="°"
                        onChange={(value) => onAngleChange(value)}
                    />
                    <EditorNumberField
                        value={Math.round(intensity * 100)}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        onChange={(value) => onIntensityChange(value / 100)}
                    />
                </div>
            </div>
        </div>
    );
}

function GlassSliderField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    onDragStateChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    onDragStateChange?: (dragging: boolean) => void;
}) {
    return (
        <div className="flex w-full items-center" style={{ gap: 8 }}>
            <span className="w-[80px] shrink-0 text-[13px] leading-[18px] text-white/75">
                {label}
            </span>
            <div className="min-w-0 flex-1">
                <EditorSlider
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={onChange}
                    onDragStateChange={onDragStateChange}
                />
            </div>
            <div className="w-[72px] shrink-0">
                <EditorNumberField
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={onChange}
                />
            </div>
        </div>
    );
}

function CanvasInspector({
    canvas,
    onCanvasPatch,
    wallpaperTransform,
    onRenderSimplifyChange,
}: {
    canvas: WallpaperTemplateConfig;
    onCanvasPatch: InspectorProps["onCanvasPatch"];
    wallpaperTransform: InspectorProps["wallpaperTransform"];
    onRenderSimplifyChange?: (dragging: boolean) => void;
}) {
    const patchCanvas = (patch: Partial<WallpaperTemplateConfig>) => onCanvasPatch(patch);
    const canvasSize = canvas.canvas ?? {};
    const canvasBackground = parseEditorColorOpacity(canvasSize.background ?? "transparent");
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
                            radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
                            onChange={(v) => patchCanvas({ canvas: { ...canvasSize, width: Math.max(1, v) } })}
                        />
                    </EditorField>
                    <EditorField label="画布高">
                        <EditorNumberField
                            value={canvasSize.height ?? 0}
                            min={1}
                            radius="0 var(--editor-control-radius) var(--editor-control-radius) 0"
                            onChange={(v) => patchCanvas({ canvas: { ...canvasSize, height: Math.max(1, v) } })}
                        />
                    </EditorField>
                </TwoColumnGrid>
                <EditorField label="画布背景">
                    <EditorColorOpacityField
                        color={canvasBackground.color}
                        opacity={canvasBackground.opacity}
                        onChange={({ color, opacity }) => patchCanvas({
                            canvas: {
                                ...canvasSize,
                                background: formatEditorColorOpacity(color, opacity),
                            },
                        })}
                        onColorChange={(color) => patchCanvas({
                            canvas: {
                                ...canvasSize,
                                background: formatEditorColorOpacity(color, canvasBackground.opacity),
                            },
                        })}
                        onOpacityChange={(opacity) => patchCanvas({
                            canvas: {
                                ...canvasSize,
                                background: formatEditorColorOpacity(canvasBackground.color, opacity),
                            },
                        })}
                    />
                </EditorField>
                <TwoColumnGrid>
                    <EditorField label="边框圆角">
                        <EditorNumberField
                            value={frame.radius ?? 0}
                            min={0}
                            radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
                            onChange={(v) => patchCanvas({ frame: { ...frame, radius: Math.max(0, v) } })}
                        />
                    </EditorField>
                    <EditorField label="预览圆角">
                        <EditorNumberField
                            value={preview.radius ?? 0}
                            min={0}
                            radius="0 var(--editor-control-radius) var(--editor-control-radius) 0"
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
                <div className="flex w-full flex-col pt-[9px]" style={{ gap: "var(--editor-field-group-gap)" }}>
                    <NumericControlEditor
                        label="整体缩放"
                        control={wallpaperTransform.scale}
                        onChange={wallpaperTransform.onScaleChange}
                        onDragStateChange={onRenderSimplifyChange}
                    />
                    <NumericControlEditor
                        label="整体旋转"
                        control={wallpaperTransform.rotation}
                        onChange={wallpaperTransform.onRotationChange}
                        onDragStateChange={onRenderSimplifyChange}
                    />
                </div>
                <EditorSection title="用户可修改" noDivider className="pt-[9px]">
                    <p className="px-1.5 text-[11px] leading-4 text-white/45">
                        勾选后，用户可在使用壁纸时调整对应属性。
                    </p>
                    <div className="flex w-full flex-col" style={{ gap: "var(--editor-control-gap)", marginTop: 8 }}>
                        <AdjustableCheckboxRow
                            label="整体缩放"
                            checked={controlAdjustable(wallpaperTransform.scale)}
                            onCheckedChange={(adjustable) => wallpaperTransform.onScaleChange({ adjustable })}
                        />
                        <AdjustableCheckboxRow
                            label="整体旋转"
                            checked={controlAdjustable(wallpaperTransform.rotation)}
                            onCheckedChange={(adjustable) => wallpaperTransform.onRotationChange({ adjustable })}
                        />
                    </div>
                </EditorSection>
            </div>
        </div>
    );
}

export function Inspector({
    mode,
    layer,
    onLayerPatch,
    onAssetUpload,
    onAssetFlip,
    onMaskUpload,
    onFontUpload,
    onFitTextBox,
    onClearMask,
    canvas,
    onCanvasPatch,
    wallpaperTransform,
    onRenderSimplifyChange,
}: InspectorProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const maskInputRef = useRef<HTMLInputElement | null>(null);
    const fontInputRef = useRef<HTMLInputElement | null>(null);
    const pendingColorActionRef = useRef<(() => void) | null>(null);
    const [picker, setPicker] = useState<{
        mode: "add" | "replace";
        targetColor?: string;
        color: string;
        x: number;
        y: number;
    } | null>(null);
    const [axesOpen, setAxesOpen] = useState(false);
    const [glassAdvancedOpen, setGlassAdvancedOpen] = useState(false);
    const [maskImportNoticeOpen, setMaskImportNoticeOpen] = useState(false);
    const [colorEditNoticeOpen, setColorEditNoticeOpen] = useState(false);

    const requestMaskImport = () => {
        let noticeConfirmed = false;
        try {
            noticeConfirmed = window.localStorage.getItem(MASK_IMPORT_NOTICE_KEY) === "confirmed";
        } catch {
            noticeConfirmed = false;
        }
        if (noticeConfirmed) {
            maskInputRef.current?.click();
            return;
        }
        setMaskImportNoticeOpen(true);
    };

    const confirmMaskImport = () => {
        try {
            window.localStorage.setItem(MASK_IMPORT_NOTICE_KEY, "confirmed");
        } catch {
            // 本地存储不可用时仍允许继续选择蒙版。
        }
        maskInputRef.current?.click();
    };

    const requestColorAction = (action: () => void) => {
        let noticeConfirmed = false;
        try {
            noticeConfirmed = window.localStorage.getItem(COLOR_EDIT_NOTICE_KEY) === "confirmed";
        } catch {
            noticeConfirmed = false;
        }
        if (noticeConfirmed) {
            action();
            return;
        }
        pendingColorActionRef.current = action;
        setColorEditNoticeOpen(true);
    };

    const confirmColorAction = () => {
        try {
            window.localStorage.setItem(COLOR_EDIT_NOTICE_KEY, "confirmed");
        } catch {
            // 本地存储不可用时仍允许继续操作着色。
        }
        const action = pendingColorActionRef.current;
        pendingColorActionRef.current = null;
        action?.();
    };

    const handleColorNoticeOpenChange = (open: boolean) => {
        setColorEditNoticeOpen(open);
        if (!open) pendingColorActionRef.current = null;
    };

    if (mode === "canvas" && canvas) {
        return (
            <aside
                className="flex h-full w-[var(--editor-inspector-width)] shrink-0 flex-col"
                style={{ background: "var(--color-editor-bg)" }}
            >
                <div className="flex h-[60px] shrink-0 items-center gap-2 p-2">
                    <span className="grid shrink-0 place-items-center text-white/70">
                        <ImageIcon size={18} weight="regular" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-px">
                        <span className="text-[13px] font-medium leading-[18px] text-white">画布属性</span>
                        <span className="truncate text-[12px] leading-4 text-white/45">
                            {canvas.watchface?.name || canvas.deviceKey || canvas.id}
                        </span>
                    </div>
                </div>
                <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                <CanvasInspector
                    canvas={canvas}
                    onCanvasPatch={onCanvasPatch}
                    wallpaperTransform={wallpaperTransform}
                    onRenderSimplifyChange={onRenderSimplifyChange}
                />
            </aside>
        );
    }

    if (!layer) {
        return (
            <aside
                className="flex h-full w-[var(--editor-inspector-width)] shrink-0 flex-col items-center justify-center"
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
    const isGlass = layer.type === "glass";
    const showsTransformBox = isAsset || isText;
    const textContentValue =
        typeof layer.content === "string" ? layer.content : (layer.content?.default ?? "");

    const fontDefault = typeof layer.font === "string" ? layer.font : (layer.font?.default ?? "sans-serif");
    const fontOptions = fontOptionList(layer.font);
    const currentFont = fontOptions.find((option) => option.id === fontDefault) ?? fontOptions[0];
    const currentFontAxes = currentFont?.axes ?? [];
    const hasWghtAxis = currentFontAxes.some((axis) => axis.tag === "wght");
    const nonWghtAxes = currentFontAxes.filter((axis) => axis.tag !== "wght");
    const patchAxisDefault = (tag: string, value: number) => {
        if (typeof layer.font !== "object" || !layer.font) return;
        const fontControl = layer.font;
        const options = (fontControl.options ?? []).map((option) => {
            if (option.id !== fontControl.default) return option;
            return {
                ...option,
                axes: (option.axes ?? []).map((axis) =>
                    axis.tag === tag ? { ...axis, default: clampAxis(value, axis.min, axis.max) } : axis,
                ),
            };
        });
        onLayerPatch({ font: { ...fontControl, options } });
    };

    const patchControl = (
        field: "opacity" | "blur" | "backdropBlur" | "amount" | "fontSize" | "fontWeight" | "letterSpacing" | "lineHeight",
        key: "default" | "min" | "max" | "step" | "adjustable",
        value: number | boolean,
    ) => {
        onLayerPatch({ [field]: patchControlValue(layer[field], { [key]: value }) } as Partial<WallpaperLayerConfig>);
    };

    const patchTransform = (
        patch: Partial<{ x: number; y: number; scale: number; rotation: number }>,
    ) => {
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

    const glassGeometry: WallpaperGlassGeometryConfig =
        layer.geometry?.type === "circle"
            ? layer.geometry
            : layer.geometry && layer.geometry.type === "rounded-rect"
              ? layer.geometry
              : {
                    type: "circle",
                    diameter: Math.max(
                        1,
                        Math.min(canvas?.canvas?.width ?? 200, canvas?.canvas?.height ?? 200) / 2,
                    ),
                };
    const rawMaterial = layer.material;
    const legacyCurvature =
        typeof (rawMaterial as { curvature?: unknown } | undefined)?.curvature === "number"
            ? (rawMaterial as unknown as { curvature: number }).curvature
            : undefined;
    const glassMaterial: WallpaperGlassMaterialConfig = {
        ...GLASS_MATERIAL_DEFAULTS,
        ...(rawMaterial ?? {}),
        // 旧版 curvature（0..1）映射为 thickness（与引擎 parseGlassMaterial 一致）。
        ...(legacyCurvature !== undefined && rawMaterial?.thickness === undefined
            ? { thickness: GLASS_MATERIAL_DEFAULTS.thickness * (0.9 + 0.2 * legacyCurvature) }
            : {}),
    };
    const glassTransform = {
        x: layer.transform?.x ?? 0,
        y: layer.transform?.y ?? 0,
        scaleX: layer.transform?.scaleX ?? layer.transform?.scale ?? 1,
        scaleY: layer.transform?.scaleY ?? layer.transform?.scale ?? 1,
        rotation: layer.transform?.rotation ?? 0,
    };
    const patchGlassMaterial = (patch: Partial<WallpaperGlassMaterialConfig>) => {
        onLayerPatch({ material: { ...glassMaterial, ...patch } });
    };
    const patchGlassGeometry = (patch: Partial<WallpaperGlassGeometryConfig>) => {
        onLayerPatch({ geometry: { ...glassGeometry, ...patch } as WallpaperGlassGeometryConfig });
    };
    const patchGlassTransform = (
        patch: Partial<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number }>,
    ) => {
        onLayerPatch({ transform: { ...glassTransform, ...patch } });
    };
    const glassBaseWidth = glassGeometry.type === "circle" ? glassGeometry.diameter : glassGeometry.width;
    const glassBaseHeight = glassGeometry.type === "circle" ? glassGeometry.diameter : glassGeometry.height;
    const flipGlass = (axis: "x" | "y") => {
        if (axis === "x") {
            const nextScaleX = -glassTransform.scaleX;
            patchGlassTransform({
                x: glassTransform.x + (glassBaseWidth * glassTransform.scaleX) / 2 - (glassBaseWidth * nextScaleX) / 2,
                scaleX: nextScaleX,
            });
            return;
        }
        const nextScaleY = -glassTransform.scaleY;
        patchGlassTransform({
            y: glassTransform.y + (glassBaseHeight * glassTransform.scaleY) / 2 - (glassBaseHeight * nextScaleY) / 2,
            scaleY: nextScaleY,
        });
    };

    const patchColor = (patch: Partial<WallpaperColorControlConfig>) => {        const base: WallpaperColorControlConfig = colorControl ?? {
            default: "#ffffff",
            options: [],
            adjustable: false,
            allowCustom: true,
        };
        onLayerPatch({ color: { ...base, ...patch } });
    };
    const addColor = (newColor: string) => {
        const base: WallpaperColorControlConfig = colorControl ?? {
            default: newColor,
            options: [],
            adjustable: false,
            allowCustom: true,
        };
        const options = base.options?.includes(newColor)
            ? base.options
            : [...(base.options ?? []), newColor];
        onLayerPatch({ color: { ...base, default: newColor, options } });
    };
    const replaceColor = (targetColor: string, newColor: string) => {
        if (!colorControl) return;
        const currentOptions = colorControl.options ?? [];
        const hasTarget = currentOptions.includes(targetColor);
        const options = Array.from(new Set([
            ...currentOptions.map((color) => (color === targetColor ? newColor : color)),
            ...(hasTarget ? [] : [newColor]),
        ]));
        onLayerPatch({
            color: {
                ...colorControl,
                default: colorControl.default === targetColor ? newColor : colorControl.default,
                options,
            },
        });
    };
    const removeColor = (targetColor: string) => {
        if (!colorControl) return;
        const options = (colorControl.options ?? []).filter((color) => color !== targetColor);
        const adjustable = options.length > 1 || colorControl.allowCustom === true
            ? colorControl.adjustable
            : false;
        onLayerPatch({
            color: {
                ...colorControl,
                default: colorControl.default === targetColor
                    ? (options[0] ?? colorControl.default)
                    : colorControl.default,
                adjustable,
                options,
            },
        });
    };
    const canAdjustColor = Boolean(
        colorControl
        && ((colorControl.options?.length ?? 0) > 1 || colorControl.allowCustom === true),
    );
    const hexColor =
        colorControl && /^#[0-9a-fA-F]{6}$/.test(colorControl.default)
            ? colorControl.default
            : "#ffffff";

    const applyPickerColor = (color: string) => {
        const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
        if (!match) return undefined;
        return match[1].length === 3
            ? `#${match[1].split("").map((ch) => ch + ch).join("")}`
            : color.toLowerCase();
    };
    const openPicker = (mode: "add" | "replace", rect: DOMRect, targetColor?: string) => {
        const initialColor = targetColor && /^#[0-9a-fA-F]{6}$/.test(targetColor)
            ? targetColor
            : hexColor;
        setPicker({
            mode,
            targetColor,
            color: initialColor,
            x: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 228)),
            y: Math.min(Math.max(8, rect.bottom + 6), Math.max(8, window.innerHeight - 268)),
        });
    };
    const applyPicker = () => {
        if (!picker) return;
        const color = applyPickerColor(picker.color);
        if (!color) return;
        if (picker.mode === "add") addColor(color);
        else replaceColor(picker.targetColor ?? colorControl?.default ?? color, color);
        setPicker(null);
    };

    const blendValue =
        typeof layer.blendMode === "string"
            ? layer.blendMode
            : typeof layer.blendMode?.default === "string"
              ? layer.blendMode.default
              : "normal";

    const blendAdjustable =
        typeof layer.blendMode === "object" && layer.blendMode.adjustable === true;

    const patchBlendAdjustable = (checked: boolean) => {
        const current: { default?: string; adjustable?: boolean; options?: string[] } =
            typeof layer.blendMode === "string" ? {} : layer.blendMode ?? {};
        onLayerPatch({
            blendMode: checked
                ? {
                      ...current,
                      default: blendValue,
                      adjustable: true,
                      options:
                          Array.isArray(current.options) && current.options.length > 0
                              ? current.options
                              : [...LAYER_BLEND_MODES],
                  }
                : { ...current, default: blendValue, adjustable: false },
        });
    };

    return (
        <aside
            className="flex h-full w-[var(--editor-inspector-width)] shrink-0 flex-col"
            style={{ background: "var(--color-editor-bg)" }}
        >
            <div className="flex h-[60px] shrink-0 items-center gap-2 p-2">
                <span className="grid shrink-0 place-items-center text-white/70">
                    <ImageIcon size={18} weight="regular" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[13px] font-medium leading-[18px] text-white">
                        {layer.name || layer.id}
                    </span>
                    <span className="truncate text-[12px] leading-4 text-white/45">
                        {TYPE_OPTIONS.find((option) => option.value === layer.type)?.label ?? "图层"}
                        {layer.syncAcrossDevices === true ? " / 多设备同步" : " / 当前设备"}
                    </span>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-white/45" title="将该图层的通用样式同步到全部设备">
                    同步
                    <EditorSwitch
                        checked={layer.syncAcrossDevices === true}
                        compact
                        onCheckedChange={(value) => onLayerPatch({ syncAcrossDevices: value })}
                    />
                </span>
            </div>
            <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />

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
                                    { value: "frame", label: "表盘区域" },
                                    { value: "canvas", label: "完整画布" },
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
                        <EditorField
                            label="蒙版"
                            labelRight={
                                <Popover.Root>
                                    <Popover.Trigger>
                                        <button
                                            type="button"
                                            title="查看明度蒙版说明"
                                            aria-label="查看明度蒙版说明"
                                            className="grid place-items-center text-white/40 transition hover:text-white/75"
                                            style={{ width: 18, height: 18 }}
                                        >
                                            <InfoIcon size={14} weight="regular" />
                                        </button>
                                    </Popover.Trigger>
                                    <Popover.Content size="1" style={{ width: 280 }}>
                                        <div className="flex flex-col" style={{ gap: 8 }}>
                                            <strong className="text-[12px] font-medium">明度蒙版</strong>
                                            <LuminanceMaskDiagram />
                                            <p className="text-[11px] leading-4 text-gray-11">
                                                白色区域完全显示，黑色区域完全隐藏，灰色按明度呈现半透明。蒙版必须使用与画布尺寸完全一致的灰度图。我们推荐蒙版使用PNG，更稳定。
                                            </p>
                                        </div>
                                    </Popover.Content>
                                </Popover.Root>
                            }
                        >
                            <div className="flex items-center" style={{ gap: "var(--editor-control-gap)" }}>
                                <div
                                    className="flex flex-1 cursor-pointer items-center gap-2 px-2"
                                    style={{
                                        height: "var(--editor-control-height)",
                                        borderRadius: "var(--editor-control-radius)",
                                        background: "var(--color-editor-control)",
                                    }}
                                    onClick={requestMaskImport}
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
                                {hasWghtAxis ? (
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
                                ) : (
                                    <EditorField label="字重">
                                        <div
                                            className="flex items-center gap-1.5 px-2"
                                            style={{
                                                height: "var(--editor-control-height)",
                                                borderRadius: "var(--editor-control-radius)",
                                                background: "var(--color-editor-control)",
                                            }}
                                        >
                                            <span className="text-sm text-white/45">
                                                {controlDefault(layer.fontWeight, 400)}
                                            </span>
                                            <span className="text-[11px] text-white/30">
                                                当前字体无字重轴，不可调整
                                            </span>
                                        </div>
                                    </EditorField>
                                )}
                                {nonWghtAxes.length > 0 && (
                                    <div className="flex w-full flex-col" style={{ gap: 6 }}>
                                        <button
                                            type="button"
                                            onClick={() => setAxesOpen((open) => !open)}
                                            className="flex cursor-pointer items-center justify-between px-1.5 py-0.5"
                                        >
                                            <span className="text-[13px] leading-[18px] text-white/75">
                                                可变属性
                                            </span>
                                            <CaretDownIcon
                                                size={14}
                                                weight="regular"
                                                className={`text-white/60 transition-transform ${axesOpen ? "" : "-rotate-90"}`}
                                            />
                                        </button>
                                        {axesOpen && (
                                            <div className="flex w-full flex-col" style={{ gap: 16 }}>
                                                {nonWghtAxes.map((axis) => (
                                                    <div
                                                        key={axis.tag}
                                                        className="flex w-full flex-col"
                                                        style={{ gap: 6 }}
                                                    >
                                                        <span className="px-1.5 text-[13px] leading-[18px] text-white/75">
                                                            {axis.name ?? axis.tag}
                                                            <span className="ml-1 text-[11px] text-white/35">{axis.tag}</span>
                                                        </span>
                                                        <EditorSlider
                                                            value={axis.default}
                                                            min={axis.min}
                                                            max={axis.max}
                                                            step={axisStep(axis)}
                                                            onChange={(v) => patchAxisDefault(axis.tag, v)}
                                                            onDragStateChange={onRenderSimplifyChange}
                                                        />
                                                        <EditorNumberField
                                                            value={axis.default}
                                                            min={axis.min}
                                                            max={axis.max}
                                                            step={axisStep(axis)}
                                                            onChange={(v) => patchAxisDefault(axis.tag, v)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
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
                                                onChange={(value) => {
                                                    const nextFont = patchFont(layer.font, { default: value });
                                                    const nextWght = fontOptionList(layer.font)
                                                        .find((option) => option.id === value)
                                                        ?.axes?.find((axis) => axis.tag === "wght");
                                                    onLayerPatch({
                                                        font: nextFont,
                                                        fontWeight: nextWght
                                                            ? {
                                                                  default: clampAxis(nextWght.default, nextWght.min, nextWght.max),
                                                                  min: nextWght.min,
                                                                  max: nextWght.max,
                                                                  step: 1,
                                                                  adjustable: true,
                                                              }
                                                            : { default: 400, min: 400, max: 400, step: 1, adjustable: false },
                                                    });
                                                }}
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
                            <EditorField label="位置">
                                <div
                                    className="grid w-full"
                                    style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
                                >
                                    <EditorNumberField
                                        value={transform.x ?? 0}
                                        prefix="X"
                                        suffix="px"
                                        radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
                                        onChange={(v) => patchTransform({ x: v })}
                                    />
                                    <EditorNumberField
                                        value={transform.y ?? 0}
                                        prefix="Y"
                                        suffix="px"
                                        radius="0 var(--editor-control-radius) var(--editor-control-radius) 0"
                                        onChange={(v) => patchTransform({ y: v })}
                                    />
                                </div>
                            </EditorField>
                            <EditorField label="旋转">
                                <div
                                    className="grid w-full"
                                    style={{ gridTemplateColumns: isAsset ? "minmax(0, 3fr) repeat(3, minmax(0, 1fr))" : "minmax(0, 3fr) minmax(0, 1fr)", gap: "var(--editor-control-gap)" }}
                                >
                                    <EditorNumberField
                                        value={transform.rotation ?? 0}
                                        suffix="°"
                                        radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
                                        onChange={(v) => patchTransform({ rotation: v })}
                                    />
                                    <EditorIconButton
                                        title="顺时针旋转 15°"
                                        style={{ borderRadius: 0 }}
                                        onClick={() => patchTransform({ rotation: (transform.rotation ?? 0) + 15 })}
                                    >
                                        <ArrowClockwiseIcon size={16} weight="regular" />
                                    </EditorIconButton>
                                    {isAsset ? (
                                        <>
                                            <EditorIconButton
                                                title="水平镜像"
                                                selected={transform.flipX === true}
                                                style={{ borderRadius: 0 }}
                                                onClick={() => onAssetFlip("x")}
                                            >
                                                <FlipHorizontalIcon size={16} weight="regular" />
                                            </EditorIconButton>
                                            <EditorIconButton
                                                title="垂直镜像"
                                                selected={transform.flipY === true}
                                                style={{ borderRadius: "0 var(--editor-control-radius) var(--editor-control-radius) 0" }}
                                                onClick={() => onAssetFlip("y")}
                                            >
                                                <FlipVerticalIcon size={16} weight="regular" />
                                            </EditorIconButton>
                                        </>
                                    ) : (
                                        <EditorIconButton
                                            title="旋转 180°"
                                            style={{ borderRadius: "0 var(--editor-control-radius) var(--editor-control-radius) 0" }}
                                            onClick={() => patchTransform({ rotation: (transform.rotation ?? 0) + 180 })}
                                        >
                                            <ArrowClockwiseIcon size={16} weight="regular" />
                                        </EditorIconButton>
                                    )}
                                </div>
                            </EditorField>
                            {isAsset && rect && (
                                <EditorField label="尺寸">
                                    <div
                                        className="grid w-full"
                                        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
                                    >
                                        <EditorNumberField
                                            value={rect.width ?? 1}
                                            prefix="W"
                                            suffix="px"
                                            radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
                                            onChange={(v) => onLayerPatch({ rect: { ...rect, width: v } })}
                                        />
                                        <EditorNumberField
                                            value={rect.height ?? 1}
                                            prefix="H"
                                            suffix="px"
                                            radius="0 var(--editor-control-radius) var(--editor-control-radius) 0"
                                            onChange={(v) => onLayerPatch({ rect: { ...rect, height: v } })}
                                        />
                                    </div>
                                </EditorField>
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

                    {/* 玻璃层 */}
                    {isGlass && (
                        <>
                            <EditorSection title="形状" noDivider>
                                <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                                    <EditorField label="玻璃可见">
                                        <EditorSwitch
                                            checked={layer.visible !== false}
                                            onCheckedChange={(v) => onLayerPatch({ visible: v })}
                                        />
                                    </EditorField>
                                    <EditorField label="几何形状">
                                        <EditorSelect
                                            value={glassGeometry.type}
                                            options={[
                                                { value: "rounded-rect", label: "圆角矩形" },
                                                { value: "circle", label: "圆形" },
                                            ]}
                                            onChange={(value) => {
                                                if (value === "circle") {
                                                    const diameter = Math.max(
                                                        1,
                                                        Math.round(
                                                            Math.min(
                                                                glassGeometry.type === "rounded-rect" ? glassGeometry.width : glassGeometry.diameter,
                                                                glassGeometry.type === "rounded-rect" ? glassGeometry.height : glassGeometry.diameter,
                                                            ),
                                                        ),
                                                    );
                                                    onLayerPatch({ geometry: { type: "circle", diameter } });
                                                } else {
                                                    const width =
                                                        glassGeometry.type === "circle" ? glassGeometry.diameter : glassGeometry.width;
                                                    const height =
                                                        glassGeometry.type === "circle" ? glassGeometry.diameter : glassGeometry.height;
                                                    onLayerPatch({
                                                        geometry: {
                                                            type: "rounded-rect",
                                                            width,
                                                            height,
                                                            radius: Math.max(0, glassGeometry.type === "circle" ? Math.round(width / 4) : glassGeometry.radius),
                                                        },
                                                    });
                                                }
                                            }}
                                        />
                                    </EditorField>
                                    {glassGeometry.type === "rounded-rect" ? (
                                        <>
                                            <TwoColumnGrid>
                                                <EditorField label="宽">
                                                    <EditorNumberField
                                                        value={glassGeometry.width}
                                                        onChange={(v) => patchGlassGeometry({ width: Math.max(1, v) })}
                                                    />
                                                </EditorField>
                                                <EditorField label="高">
                                                    <EditorNumberField
                                                        value={glassGeometry.height}
                                                        onChange={(v) => patchGlassGeometry({ height: Math.max(1, v) })}
                                                    />
                                                </EditorField>
                                            </TwoColumnGrid>
                                            <EditorField label="圆角半径">
                                                <EditorNumberField
                                                    value={glassGeometry.radius}
                                                    onChange={(v) =>
                                                        patchGlassGeometry({ radius: Math.max(0, Math.min(v, glassGeometry.width / 2, glassGeometry.height / 2)) })
                                                    }
                                                />
                                            </EditorField>
                                        </>
                                    ) : (
                                        <EditorField label="直径">
                                            <EditorNumberField
                                                value={glassGeometry.diameter}
                                                onChange={(v) => patchGlassGeometry({ diameter: Math.max(1, v) })}
                                            />
                                        </EditorField>
                                    )}
                                </div>
                            </EditorSection>
                            <EditorSection title="光照" className="pt-[9px]">
                                <GlassLightField
                                    angle={glassMaterial.lightAngle}
                                    intensity={glassMaterial.highlight}
                                    onAngleChange={(value) => patchGlassMaterial({ lightAngle: value })}
                                    onIntensityChange={(value) => patchGlassMaterial({ highlight: value })}
                                />
                            </EditorSection>
                            <EditorSection title="材质" className="pt-[9px]">
                                <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                                    <GlassSliderField
                                        label="折射"
                                        value={glassMaterial.refraction}
                                        min={0}
                                        max={4}
                                        step={0.1}
                                        onChange={(v) => patchGlassMaterial({ refraction: v })}
                                        onDragStateChange={onRenderSimplifyChange}
                                    />
                                    <GlassSliderField
                                        label="厚度"
                                        value={glassMaterial.thickness}
                                        min={0}
                                        max={40}
                                        step={0.5}
                                        onChange={(v) => patchGlassMaterial({ thickness: v })}
                                        onDragStateChange={onRenderSimplifyChange}
                                    />
                                    <GlassSliderField
                                        label="色散"
                                        value={glassMaterial.dispersion}
                                        min={0}
                                        max={4}
                                        step={0.05}
                                        onChange={(v) => patchGlassMaterial({ dispersion: v })}
                                        onDragStateChange={onRenderSimplifyChange}
                                    />
                                    <GlassSliderField
                                        label="雾化"
                                        value={glassMaterial.blur}
                                        min={0}
                                        max={100}
                                        step={1}
                                        onChange={(v) => patchGlassMaterial({ blur: v })}
                                        onDragStateChange={onRenderSimplifyChange}
                                    />
                                    <GlassSliderField
                                        label="对比度"
                                        value={glassMaterial.contrast}
                                        min={0.5}
                                        max={1.5}
                                        step={0.01}
                                        onChange={(v) => patchGlassMaterial({ contrast: v })}
                                        onDragStateChange={onRenderSimplifyChange}
                                    />
                                    <button
                                        type="button"
                                        aria-expanded={glassAdvancedOpen}
                                        className="flex h-[var(--editor-control-height)] w-full cursor-pointer items-center justify-between px-2 text-left text-[13px] text-white/65 transition hover:text-white"
                                        style={{
                                            borderRadius: "var(--editor-control-radius)",
                                            background: "var(--color-editor-control)",
                                        }}
                                        onClick={() => setGlassAdvancedOpen((open) => !open)}
                                    >
                                        <span>更多材质参数</span>
                                        <CaretDownIcon
                                            size={14}
                                            weight="regular"
                                            style={{ transform: glassAdvancedOpen ? "rotate(180deg)" : undefined }}
                                        />
                                    </button>
                                    {glassAdvancedOpen && (
                                        <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                                            <EditorField label="着色">
                                                <EditorColorOpacityField
                                                    color={glassMaterial.tint}
                                                    opacity={glassMaterial.tintOpacity}
                                                    onChange={({ color, opacity }) => patchGlassMaterial({
                                                        tint: color,
                                                        tintOpacity: opacity,
                                                    })}
                                                    onColorChange={(tint) => patchGlassMaterial({ tint })}
                                                    onOpacityChange={(tintOpacity) => patchGlassMaterial({ tintOpacity })}
                                                />
                                            </EditorField>
                                            <GlassSliderField
                                                label="饱和度"
                                                value={glassMaterial.saturation}
                                                min={0}
                                                max={2}
                                                step={0.01}
                                                onChange={(v) => patchGlassMaterial({ saturation: v })}
                                                onDragStateChange={onRenderSimplifyChange}
                                            />
                                            <GlassSliderField
                                                label="高光"
                                                value={glassMaterial.highlight}
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                onChange={(v) => patchGlassMaterial({ highlight: v })}
                                                onDragStateChange={onRenderSimplifyChange}
                                            />
                                            <EditorField label="高光混合模式">
                                                <EditorSelect
                                                    value={glassMaterial.highlightBlendMode}
                                                    options={GLASS_BLEND_MODE_OPTIONS}
                                                    onChange={(v) => patchGlassMaterial({ highlightBlendMode: v as WallpaperGlassBlendMode })}
                                                />
                                            </EditorField>
                                            <GlassSliderField
                                                label="阴影"
                                                value={glassMaterial.shadow}
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                onChange={(v) => patchGlassMaterial({ shadow: v })}
                                                onDragStateChange={onRenderSimplifyChange}
                                            />
                                            <EditorField label="阴影混合模式">
                                                <EditorSelect
                                                    value={glassMaterial.shadowBlendMode}
                                                    options={GLASS_BLEND_MODE_OPTIONS}
                                                    onChange={(v) => patchGlassMaterial({ shadowBlendMode: v as WallpaperGlassBlendMode })}
                                                />
                                            </EditorField>
                                            <GlassSliderField
                                                label="Bevel 宽度"
                                                value={glassMaterial.bezelWidth}
                                                min={0}
                                                max={40}
                                                step={0.5}
                                                onChange={(v) => patchGlassMaterial({ bezelWidth: v })}
                                                onDragStateChange={onRenderSimplifyChange}
                                            />
                                        </div>
                                    )}
                                </div>
                            </EditorSection>
                            <EditorSection title="位置与大小" className="pt-[9px]">
                                <div className="flex w-full flex-col" style={{ gap: "var(--editor-field-group-gap)" }}>
                                    <TwoColumnGrid>
                                        <EditorField label="位置 X">
                                            <EditorNumberField value={glassTransform.x} onChange={(v) => patchGlassTransform({ x: v })} />
                                        </EditorField>
                                        <EditorField label="位置 Y">
                                            <EditorNumberField value={glassTransform.y} onChange={(v) => patchGlassTransform({ y: v })} />
                                        </EditorField>
                                    </TwoColumnGrid>
                                    <TwoColumnGrid>
                                        <EditorField label="缩放 X">
                                            <EditorNumberField value={glassTransform.scaleX} onChange={(v) => patchGlassTransform({ scaleX: v })} />
                                        </EditorField>
                                        <EditorField label="缩放 Y">
                                            <EditorNumberField value={glassTransform.scaleY} onChange={(v) => patchGlassTransform({ scaleY: v })} />
                                        </EditorField>
                                    </TwoColumnGrid>
                                    <EditorField label="旋转">
                                        <EditorNumberField
                                            value={glassTransform.rotation}
                                            onChange={(v) => patchGlassTransform({ rotation: v })}
                                        />
                                    </EditorField>
                                    <EditorField label="镜像">
                                        <div
                                            className="grid w-full"
                                            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
                                        >
                                            <EditorIconButton
                                                title="水平镜像"
                                                onClick={() => flipGlass("x")}
                                                style={{ borderRadius: "var(--editor-control-radius) 0 0 var(--editor-control-radius)" }}
                                            >
                                                <FlipHorizontalIcon size={16} weight="regular" />
                                            </EditorIconButton>
                                            <EditorIconButton
                                                title="垂直镜像"
                                                onClick={() => flipGlass("y")}
                                                style={{ borderRadius: "0 var(--editor-control-radius) var(--editor-control-radius) 0" }}
                                            >
                                                <FlipVerticalIcon size={16} weight="regular" />
                                            </EditorIconButton>
                                        </div>
                                    </EditorField>
                                </div>
                            </EditorSection>
                        </>
                    )}

                    {/* 透明度 / 模糊 / 背景模糊 */}
                    <ControlTriple
                        label="透明度"
                        control={layer.opacity}
                        onChange={(patch) => patchControl("opacity", Object.keys(patch)[0] as never, Object.values(patch)[0] as never)}
                        onDragStateChange={onRenderSimplifyChange}
                    />
                    {/* 液态玻璃不使用元素通用的模糊 / 背景模糊（引擎强制为 0，模糊由材质 blur 走整帧管线） */}
                    {!isGlass && (
                        <>
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
                        </>
                    )}

                    {/* 着色 (asset tint / text color) */}
                    {(isAsset || isText) && (
                        <EditorField
                            label="着色"
                            labelRight={
                                <Popover.Root>
                                    <Popover.Trigger>
                                        <button
                                            type="button"
                                            title="查看着色说明"
                                            aria-label="查看着色说明"
                                            className="grid place-items-center text-white/40 transition hover:text-white/75"
                                            style={{ width: 18, height: 18 }}
                                        >
                                            <InfoIcon size={14} weight="regular" />
                                        </button>
                                    </Popover.Trigger>
                                    <Popover.Content size="1" style={{ width: 300 }}>
                                        <ColorEditGuide />
                                    </Popover.Content>
                                </Popover.Root>
                            }
                        >
                            {colorControl ? (
                                <EditorColorDots
                                    colors={colorControl.options?.length ? colorControl.options : [colorControl.default]}
                                    selected={colorControl.default}
                                    onSelect={(color) => requestColorAction(() => patchColor({ default: color }))}
                                    onEdit={(color, rect) => requestColorAction(() => openPicker("replace", rect, color))}
                                    onRemove={(color) => requestColorAction(() => removeColor(color))}
                                    onAdd={(rect) => requestColorAction(() => openPicker("add", rect))}
                                />
                            ) : (
                                <button
                                    type="button"
                                    title="添加着色"
                                    onClick={(event) => {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        requestColorAction(() => openPicker("add", rect));
                                    }}
                                    className="flex cursor-pointer items-center gap-1.5 px-2 text-sm text-white/70 transition hover:text-white"
                                    style={{
                                        height: "var(--editor-control-height)",
                                        borderRadius: "var(--editor-control-radius)",
                                        background: "var(--color-editor-control)",
                                        width: "100%",
                                    }}
                                >
                                    <PlusIcon size={14} weight="regular" />
                                    添加着色
                                </button>
                            )}
                        </EditorField>
                    )}

                    {/* 混合模式 */}
                    <EditorField label="混合模式">
                        <EditorSelect
                            value={blendValue}
                            options={LAYER_BLEND_MODE_OPTIONS}
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
                        <p className="px-1.5 text-[11px] leading-4 text-white/45">
                            勾选后，用户可在使用壁纸时调整对应属性。
                        </p>
                        <div
                            className="flex w-full flex-col"
                            style={{ gap: "var(--editor-control-gap)", marginTop: 8 }}
                        >
                            {(
                                [
                                    { key: "opacity", label: "透明度" },
                                    ...(isGlass
                                        ? []
                                        : ([
                                              { key: "blur", label: "模糊" },
                                              { key: "backdropBlur", label: "背景模糊" },
                                          ] as const)),
                                    ...(isTint
                                        ? ([{ key: "amount", label: "明暗程度" }] as const)
                                        : []),
                                ] as const
                            ).map(({ key, label }) => (
                                <div
                                    key={key}
                                    className="flex items-center"
                                    style={{
                                        height: "var(--editor-control-height)",
                                        gap: 8,
                                        paddingInline: 10,
                                        borderRadius: "var(--editor-control-radius)",
                                        background: "var(--color-editor-control)",
                                    }}
                                >
                                    <Checkbox
                                        checked={controlAdjustable(layer[key])}
                                        onCheckedChange={(value) => patchControl(key, "adjustable", value === true)}
                                    />
                                    <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
                                </div>
                            ))}
                            {(isAsset || isText) && (
                                <div
                                    className="flex items-center"
                                    style={{
                                        height: "var(--editor-control-height)",
                                        gap: 8,
                                        paddingInline: 10,
                                        borderRadius: "var(--editor-control-radius)",
                                        background: "var(--color-editor-control)",
                                        opacity: canAdjustColor ? 1 : 0.4,
                                    }}
                                >
                                    <Checkbox
                                        disabled={!canAdjustColor}
                                        checked={canAdjustColor && colorControl?.adjustable === true}
                                        onCheckedChange={(value) => patchColor({ adjustable: value === true })}
                                    />
                                    <span className="text-[13px] leading-[18px] text-white/75">着色</span>
                                </div>
                            )}
                            <div
                                className="flex items-center"
                                style={{
                                    height: "var(--editor-control-height)",
                                    gap: 8,
                                    paddingInline: 10,
                                    borderRadius: "var(--editor-control-radius)",
                                    background: "var(--color-editor-control)",
                                }}
                            >
                                <Checkbox
                                    checked={blendAdjustable}
                                    onCheckedChange={(value) => patchBlendAdjustable(value === true)}
                                />
                                <span className="text-[13px] leading-[18px] text-white/75">混合模式</span>
                            </div>
                        </div>
                    </EditorSection>
                </div>
            </div>
            <AlertDialog.Root open={maskImportNoticeOpen} onOpenChange={setMaskImportNoticeOpen}>
                <AlertDialog.Content maxWidth="420px">
                    <AlertDialog.Title>导入明度蒙版</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        蒙版必须使用与当前画布尺寸完全一致的灰度图。白色区域显示，黑色区域隐藏，灰色区域按明度呈现半透明。格式推荐使用PNG，不建议使用SVG。请确认文件符合要求后再继续。
                    </AlertDialog.Description>
                    <div className="mt-3">
                        <LuminanceMaskDiagram />
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">取消</Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button onClick={confirmMaskImport}>已了解，继续选择</Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Root>
            <AlertDialog.Root open={colorEditNoticeOpen} onOpenChange={handleColorNoticeOpenChange}>
                <AlertDialog.Content maxWidth="440px">
                    <AlertDialog.Title>首次使用着色</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        图片着色会把所有非透明像素替换为所选颜色，保留原透明度和轮廓，但不会保留原图颜色；更适合单色图标或装饰素材。
                    </AlertDialog.Description>
                    <div className="mt-3">
                        <ColorEditGuide showTitle={false} showDescription={false} />
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">取消</Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button onClick={confirmColorAction}>已了解，继续操作</Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Root>
            {picker &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setPicker(null)} />
                        <div
                            className="fixed z-[61] flex flex-col"
                            style={{
                                left: picker.x,
                                top: picker.y,
                                width: 204,
                                gap: 8,
                                padding: 10,
                                borderRadius: 10,
                                background: "var(--color-editor-bg)",
                                border: "1px solid var(--color-editor-divider)",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                            }}
                        >
                            <HexColorPicker
                                color={picker.color}
                                onChange={(color) => setPicker({ ...picker, color })}
                                style={{ width: "100%", height: 150 }}
                            />
                            <input
                                type="text"
                                value={picker.color}
                                onChange={(e) => setPicker({ ...picker, color: e.target.value })}
                                className="w-full bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/30"
                                style={{
                                    height: "var(--editor-control-height)",
                                    borderRadius: "var(--editor-control-radius)",
                                    background: "var(--color-editor-control)",
                                }}
                            />
                            <div className="flex justify-end" style={{ gap: 6 }}>
                                <button
                                    type="button"
                                    onClick={() => setPicker(null)}
                                    className="cursor-pointer rounded px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    onClick={applyPicker}
                                    className="cursor-pointer rounded px-2 py-1 text-xs font-medium"
                                    style={{
                                        background: "var(--color-editor-blue-bg)",
                                        color: "var(--color-editor-blue-fg)",
                                    }}
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </>,
                    document.body,
                )}
        </aside>
    );
}

import {
  Button,
  Select,
  Switch,
} from "@radix-ui/themes";
import { PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { WallpaperControlValue } from "~/logic/wallpaper/types";
import {
  controlDefault,
  controlMax,
  controlMin,
  controlStep,
} from "~/logic/wallpaper/control";

export function EditorSlider({
  value,
  min,
  max,
  step,
  onChange,
  onDragStateChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? Math.max(max, lo) : lo;
  const stepValue = Number.isFinite(step) && step > 0 ? step : 0.01;
  const clamped = Number.isFinite(value)
    ? Math.min(Math.max(value, lo), hi)
    : lo;
  return (
    <input
      type="range"
      min={lo}
      max={hi}
      step={stepValue}
      value={clamped}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerDown={() => onDragStateChange?.(true)}
      onPointerUp={() => onDragStateChange?.(false)}
      onPointerCancel={() => onDragStateChange?.(false)}
      className="editor-slider w-full"
      style={{ accentColor: "var(--color-editor-blue-fg)" }}
    />
  );
}

/** 可调数值控件：当前值 = 滑块 + 输入框并存，区间/步长用小输入框，可调开关放 header 右侧。 */
export function NumericControlEditor({
  label,
  control,
  onChange,
  onDragStateChange,
  headerRight,
}: {
  label: string;
  control: WallpaperControlValue | undefined;
  onChange: (
    patch: Partial<{ default: number; min: number; max: number; step: number }>,
  ) => void;
  onDragStateChange?: (dragging: boolean) => void;
  headerRight?: ReactNode;
}) {
  const def = controlDefault(control, 0);
  const min = controlMin(control, 0);
  const max = controlMax(control, 100);
  const step = controlStep(control, 0.01);
  const patch = (key: "default" | "min" | "max" | "step", value: number) =>
    onChange({ [key]: value });
  return (
    <div className="flex w-full flex-col" style={{ gap: 6 }}>
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
        {headerRight}
      </div>
      <EditorSlider
        value={def}
        min={min}
        max={max}
        step={step}
        onChange={(v) => patch("default", v)}
        onDragStateChange={onDragStateChange}
      />
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "var(--editor-control-gap)",
        }}
      >
        <EditorNumberField value={def} step={step} onChange={(v) => patch("default", v)} />
        <div
          className="grid min-w-0 grid-cols-2"
          style={{ gap: "var(--editor-control-gap)" }}
        >
          <EditorNumberField value={min} onChange={(v) => patch("min", v)} />
          <EditorNumberField value={max} onChange={(v) => patch("max", v)} />
        </div>
        <EditorNumberField value={step} onChange={(v) => patch("step", v)} />
      </div>
    </div>
  );
}

export const editorVars = {
    control: {
        height: "var(--editor-control-height)",
        borderRadius: "var(--editor-control-radius)",
        background: "var(--color-editor-control)",
    },
    divider: {
        height: "var(--editor-divider-width)",
        background: "var(--color-editor-divider)",
    },
} as const;

export function EditorSection({
    title,
    children,
    noDivider,
    className,
}: {
    title?: string;
    children: ReactNode;
    noDivider?: boolean;
    className?: string;
}) {
    return (
        <section className={`flex w-full flex-col ${className ?? ""}`}>
            {title !== undefined && (
                <div className="flex w-full flex-col">
                    <h3
                        className="text-[13px] leading-[18px] text-white/85"
                        style={{ paddingLeft: 16 }}
                    >
                        {title}
                    </h3>
                    {!noDivider && <div className="mt-2 w-full" style={editorVars.divider} />}
                </div>
            )}
            {children}
        </section>
    );
}

export function EditorField({
    label,
    children,
    twoColumn,
}: {
    label: string;
    children: ReactNode;
    twoColumn?: boolean;
}) {
    return (
        <label className="flex flex-col" style={{ gap: "var(--editor-label-control-gap)" }}>
            <span
                className="text-[13px] leading-[18px] text-white/75"
                style={{ fontSize: "var(--editor-label-size)", lineHeight: "var(--editor-label-line-height)" }}
            >
                {label}
            </span>
            {children}
        </label>
    );
}

/** Grid wrapper for two equal columns: `140px + 2px + 140px`. */
export function TwoColumnGrid({ children }: { children: ReactNode }) {
    return (
        <div
            className="grid w-full"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
        >
            {children}
        </div>
    );
}

/** Grid wrapper for three equal columns with 2px gaps. */
export function ThreeColumnGrid({ children }: { children: ReactNode }) {
    return (
        <div
            className="grid w-full"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--editor-control-gap)" }}
        >
            {children}
        </div>
    );
}

const controlBase: React.CSSProperties = {
    height: "var(--editor-control-height)",
    borderRadius: "var(--editor-control-radius)",
    background: "var(--color-editor-control)",
    color: "#fff",
    width: "100%",
};

export function EditorNumberField({
    value,
    onChange,
    min,
    max,
    step,
    placeholder,
    prefix,
}: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    prefix?: string;
}) {
    const sanitize = (raw: number) => {
        if (!Number.isFinite(raw)) raw = 0;
        const lo = Number.isFinite(min) ? (min as number) : undefined;
        const hi = Number.isFinite(max) ? (max as number) : undefined;
        if (lo !== undefined && hi !== undefined && lo > hi) {
            return raw;
        }
        if (lo !== undefined && raw < lo) raw = lo;
        if (hi !== undefined && raw > hi) raw = hi;
        return raw;
    };

    const displayValue = Number.isFinite(value) ? value : "";
    return (
        <div className="flex items-center overflow-hidden" style={controlBase}>
            {prefix && (
                <span className="shrink-0 pl-2 text-xs text-white/45">{prefix}</span>
            )}
            <input
                type="number"
                value={displayValue}
                min={min}
                max={max}
                step={step}
                placeholder={placeholder}
                onChange={(e) => {
                    const parsed = e.target.valueAsNumber;
                    onChange(sanitize(Number.isFinite(parsed) ? parsed : (min ?? 0)));
                }}
                className="h-full w-full bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/30"
            />
        </div>
    );
}

export function EditorTextInput({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/30"
            style={controlBase}
        />
    );
}

export function EditorSelect({
    value,
    options,
    onChange,
    placeholder,
}: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    const stringValue = typeof value === "string" ? value : "";
    const safeOptions = options.filter(
        (option) => option && typeof option.value === "string",
    );
    return (
        <Select.Root value={stringValue || undefined} onValueChange={onChange}>
            <Select.Trigger
                placeholder={placeholder}
                className="w-full!"
                style={{
                    height: "var(--editor-control-height)",
                    borderRadius: "var(--editor-control-radius)",
                    background: "var(--color-editor-control)",
                }}
            />
            <Select.Content position="popper" align="start">
                {safeOptions.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                        {option.label}
                    </Select.Item>
                ))}
            </Select.Content>
        </Select.Root>
    );
}

export function EditorSwitch({
    checked,
    onCheckedChange,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            className="rt-SwitchRoot-editor"
            style={{
                width: "var(--editor-switch-width)",
                height: "var(--editor-switch-height)",
                borderRadius: "var(--editor-switch-radius)",
                "--switch-width": "var(--editor-switch-width)",
                "--switch-height": "var(--editor-switch-height)",
                "--switch-thumb-width": "calc(var(--editor-switch-height) - 4px)",
                "--switch-thumb-height": "calc(var(--editor-switch-height) - 4px)",
            } as React.CSSProperties}
        />
    );
}

export function EditorIconButton({
    onClick,
    disabled,
    title,
    children,
    selected,
    style,
}: {
    onClick?: (event: React.MouseEvent) => void;
    disabled?: boolean;
    title?: string;
    children: ReactNode;
    selected?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`flex items-center justify-center transition ${
                selected ? "text-[var(--color-editor-blue-fg)]" : "text-white/70 hover:text-white"
            } disabled:opacity-40`}
            style={{
                height: "var(--editor-control-height)",
                borderRadius: "var(--editor-control-radius)",
                background: selected ? "var(--color-editor-blue-bg)" : "var(--color-editor-control)",
                minWidth: 0,
                ...style,
            }}
        >
            {children}
        </button>
    );
}

export function EditorColorDots({
    colors,
    selected,
    onSelect,
    onAdd,
    allowCustom,
}: {
    colors: string[];
    selected: string;
    onSelect: (color: string) => void;
    onAdd?: () => void;
    allowCustom?: boolean;
}) {
    const safeColors = colors.filter((color) => typeof color === "string").map(String);
    const selectedKey = String(selected ?? "").toLowerCase();
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {safeColors.map((color) => {
                const isSelected = color.toLowerCase() === selectedKey;
                if (isSelected) {
                    return (
                        <button
                            key={color}
                            type="button"
                            onClick={() => onSelect(color)}
                            className="flex items-center justify-center"
                            style={{
                                width: 48,
                                height: 24,
                                borderRadius: 12,
                                background: "var(--color-editor-control)",
                                border: "1px solid var(--color-editor-blue-fg)",
                            }}
                        >
                            <span
                                className="block rounded-full"
                                style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    background: color,
                                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
                                }}
                            />
                        </button>
                    );
                }
                return (
                    <button
                        key={color}
                        type="button"
                        onClick={() => onSelect(color)}
                        className="block"
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: color,
                            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
                        }}
                    />
                );
            })}
            {safeColors.length === 0 && (
                <span className="text-xs text-white/40">未配置颜色</span>
            )}
            {(allowCustom || onAdd) && (
                <button
                    type="button"
                    onClick={onAdd}
                    title="添加颜色"
                    className="flex items-center justify-center text-white/60 transition hover:text-white"
                    style={{ width: 22, height: 22 }}
                >
                    <PlusIcon size={14} weight="regular" />
                </button>
            )}
        </div>
    );
}

export function EditorActionButton({
    icon,
    children,
    onClick,
    selected,
    disabled,
}: {
    icon?: ReactNode;
    children: ReactNode;
    onClick?: () => void;
    selected?: boolean;
    disabled?: boolean;
}) {
    return (
        <Button
            variant="soft"
            radius="medium"
            disabled={disabled}
            onClick={onClick}
            style={{
                height: "var(--editor-control-height)",
                borderRadius: "var(--editor-control-radius)",
                background: selected ? "var(--color-editor-blue-bg)" : "var(--color-editor-control)",
                color: selected ? "var(--color-editor-blue-fg)" : "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 10,
                paddingLeft: 12,
                paddingRight: 12,
                cursor: "pointer",
                width: "100%",
            }}
        >
            {icon}
            <span className="text-sm">{children}</span>
        </Button>
    );
}

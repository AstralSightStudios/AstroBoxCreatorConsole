import {
  Button,
  ContextMenu,
  Popover,
  Select,
  Switch,
} from "@radix-ui/themes";
import { CaretDownIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { HexAlphaColorPicker } from "react-colorful";
import type { WallpaperControlValue } from "~/logic/wallpaper/types";
import {
  controlDefault,
  controlMax,
  controlMin,
  controlStep,
} from "~/logic/wallpaper/control";
import {
  formatEditorColorOpacity,
  normalizeEditorHexColor,
  parseEditorColorOpacity,
} from "./color-opacity";
import { ScrubbableNumberField } from "./ScrubbableNumberField";

const MIN_CONTROL_STEP = 0.1;

function controlStepAdjustment(value: number): number {
  if (!Number.isFinite(value) || value < MIN_CONTROL_STEP) return MIN_CONTROL_STEP;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.max(MIN_CONTROL_STEP, magnitude / 10);
}

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

/** 可调数值控件：当前值支持拖拽调节，范围设置按需展开。 */
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
  const step = Math.max(MIN_CONTROL_STEP, controlStep(control, MIN_CONTROL_STEP));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patch = (key: "default" | "min" | "max" | "step", value: number) =>
    onChange({
      [key]:
        key === "step"
          ? Math.max(MIN_CONTROL_STEP, Number.isFinite(value) ? value : MIN_CONTROL_STEP)
          : value,
    });
  return (
    <div className="flex w-full flex-col" style={{ gap: 6 }}>
      <div className="flex items-center justify-between px-1.5">
        <div className="flex items-center" style={{ gap: 4 }}>
          <span className="text-[13px] leading-[18px] text-white/75">{label}</span>
          <Popover.Root>
            <Popover.Trigger>
              <button
                type="button"
                title="查看数值输入说明"
                aria-label="查看数值输入说明"
                className="grid place-items-center text-white/40 transition hover:text-white/75"
                style={{ width: 18, height: 18 }}
              >
                <InfoIcon size={14} weight="regular" />
              </button>
            </Popover.Trigger>
            <Popover.Content size="1" style={{ width: 360 }}>
              <div className="flex flex-col" style={{ gap: 8 }}>
                <strong className="text-[12px] font-medium">数值输入说明</strong>
                <div
                  className="grid w-full"
                  style={{
                    gridTemplateColumns: "minmax(0, 1fr) 106px",
                    gap: "var(--editor-control-gap)",
                  }}
                >
                  <div
                    className="grid min-w-0 items-center overflow-hidden bg-[var(--color-editor-control)]"
                    style={{
                      borderRadius: "var(--editor-control-radius) 0 0 var(--editor-control-radius)",
                      gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                    }}
                  >
                    <input
                      readOnly
                      tabIndex={-1}
                      value="最小值"
                      className="h-[var(--editor-control-height)] min-w-0 bg-transparent px-1 text-center text-[11px] text-white/75 outline-none"
                    />
                    <span className="select-none text-xs text-white/35">~</span>
                    <input
                      readOnly
                      tabIndex={-1}
                      value="最大值"
                      className="h-[var(--editor-control-height)] min-w-0 bg-transparent px-1 text-center text-[11px] text-white/75 outline-none"
                    />
                  </div>
                  <input
                    readOnly
                    tabIndex={-1}
                    value="步长"
                    className="h-[var(--editor-control-height)] min-w-0 bg-[var(--color-editor-control)] px-2 text-center text-[11px] text-white/75 outline-none"
                    style={{ borderRadius: "0 var(--editor-control-radius) var(--editor-control-radius) 0" }}
                  />
                </div>
                <p className="text-[11px] leading-4 text-gray-11">
                  最小值和最大值决定用户可调范围；步长决定每次调整的增量。
                </p>
              </div>
            </Popover.Content>
          </Popover.Root>
        </div>
        {headerRight}
      </div>
      <div
        className={`grid w-full gap-x-0.5 transition-[row-gap] duration-200 ease-out ${
          advancedOpen ? "gap-y-0.5" : "gap-y-0"
        }`}
        style={{ gridTemplateColumns: "minmax(0, 1fr) 72px 34px" }}
      >
        <div className="col-span-2 min-w-0 w-full">
          <EditorNumberField
            value={def}
            min={min}
            max={max}
            step={step}
            radius={
              advancedOpen
                ? "var(--editor-control-radius) 0 0 0"
                : "var(--editor-control-radius) 0 0 var(--editor-control-radius)"
            }
            onChange={(v) => patch("default", v)}
            onScrubStateChange={onDragStateChange}
          />
        </div>
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-label={advancedOpen ? "收起范围设置" : "展开范围设置"}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="col-start-3 flex h-[var(--editor-control-height)] w-full shrink-0 items-center justify-center text-white/55 transition hover:text-white/80"
          style={{
            borderRadius: advancedOpen
              ? "0 var(--editor-control-radius) 0 0"
              : "0 var(--editor-control-radius) var(--editor-control-radius) 0",
            background: "var(--color-editor-control)",
          }}
        >
          <CaretDownIcon
            size={14}
            weight="regular"
            className="transition-transform duration-200 ease-out"
            style={{ transform: advancedOpen ? "rotate(180deg)" : undefined }}
          />
        </button>
        <div
          aria-hidden={!advancedOpen}
          inert={!advancedOpen}
          className="col-span-3 overflow-hidden"
          style={{
            maxHeight: advancedOpen ? "var(--editor-control-height)" : 0,
            opacity: advancedOpen ? 1 : 0,
            pointerEvents: advancedOpen ? "auto" : "none",
            transitionProperty: "max-height, opacity",
            transitionDuration: advancedOpen ? "280ms, 160ms" : "280ms, 100ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1), ease",
            transitionDelay: advancedOpen ? "0ms, 70ms" : "0ms, 170ms",
          }}
        >
          <div
            className="grid gap-x-0.5"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 72px 34px" }}
          >
            <div className="min-w-0">
              <EditorRangeField
                min={min}
                max={max}
                step={step}
                radius="0 0 0 var(--editor-control-radius)"
                onMinChange={(value) => patch("min", value)}
                onMaxChange={(value) => patch("max", value)}
                onScrubStateChange={onDragStateChange}
              />
            </div>
            <div className="col-span-2 min-w-0">
              <EditorNumberField
                value={step}
                min={MIN_CONTROL_STEP}
                step={controlStepAdjustment(step)}
                radius="0 0 var(--editor-control-radius) 0"
                onChange={(v) => patch("step", v)}
              />
            </div>
          </div>
        </div>
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
                        className="px-1.5 text-[13px] leading-[18px] text-white/85"
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
    labelRight,
    children,
    twoColumn,
}: {
    label: string;
    labelRight?: ReactNode;
    children: ReactNode;
    twoColumn?: boolean;
}) {
    // 用 div 而非 label：避免浏览器把点击转发给内部的文件 input（蒙版/素材/字体），
    // 否则 WebKit 下 label 默认行为与程序化 input.click() 叠加会导致选择后 change 事件丢失。
    return (
        <div className="flex flex-col" style={{ gap: "var(--editor-label-control-gap)" }}>
            <div className="flex items-center px-1.5" style={{ gap: 4 }}>
                <span
                    className="text-[13px] leading-[18px] text-white/75"
                    style={{ fontSize: "var(--editor-label-size)", lineHeight: "var(--editor-label-line-height)" }}
                >
                    {label}
                </span>
                {labelRight}
            </div>
            {children}
        </div>
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
    suffix,
    radius,
    onScrubStateChange,
}: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    prefix?: ReactNode;
    suffix?: string;
    radius?: React.CSSProperties["borderRadius"];
    onScrubStateChange?: (scrubbing: boolean) => void;
}) {
    return (
        <ScrubbableNumberField
            value={value}
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            prefix={prefix}
            suffix={suffix}
            radius={radius ?? controlBase.borderRadius}
            onChange={onChange}
            onScrubStateChange={onScrubStateChange}
        />
    );
}

function EditorRangeField({
    min,
    max,
    step,
    radius,
    onMinChange,
    onMaxChange,
    onScrubStateChange,
}: {
    min: number;
    max: number;
    step: number;
    radius?: React.CSSProperties["borderRadius"];
    onMinChange: (value: number) => void;
    onMaxChange: (value: number) => void;
    onScrubStateChange?: (scrubbing: boolean) => void;
}) {
    return (
        <div
            className="grid min-w-0 items-center overflow-hidden"
            style={{
                ...controlBase,
                borderRadius: radius ?? 0,
                gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
            }}
        >
            <ScrubbableNumberField
                value={min}
                max={max}
                step={step}
                radius={0}
                ariaLabel="区间最小值"
                showStepper={false}
                onChange={onMinChange}
                onScrubStateChange={onScrubStateChange}
            />
            <span className="select-none text-xs text-white/35">~</span>
            <ScrubbableNumberField
                value={max}
                min={min}
                step={step}
                radius={0}
                ariaLabel="区间最大值"
                showStepper={false}
                onChange={onMaxChange}
                onScrubStateChange={onScrubStateChange}
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

export function EditorColorOpacityField({
    color,
    opacity,
    onColorChange,
    onOpacityChange,
    onChange,
}: {
    color: string;
    opacity: number;
    onColorChange: (color: string) => void;
    onOpacityChange: (opacity: number) => void;
    onChange?: (value: { color: string; opacity: number }) => void;
}) {
    const normalizedColor = normalizeEditorHexColor(color);
    const normalizedOpacity = Number.isFinite(opacity)
        ? Math.min(Math.max(opacity, 0), 1)
        : 1;
    const normalizedPercent = Math.round(normalizedOpacity * 100);
    const [colorDraft, setColorDraft] = useState(normalizedColor.slice(1));
    const [opacityDraft, setOpacityDraft] = useState(String(normalizedPercent));

    useEffect(() => {
        setColorDraft(normalizedColor.slice(1));
    }, [normalizedColor]);

    useEffect(() => {
        setOpacityDraft(String(normalizedPercent));
    }, [normalizedPercent]);

    const commitColor = (draft: string) => {
        const compact = draft.replace(/[^\da-f]/gi, "").slice(0, 6).toUpperCase();
        const nextColor = compact.length === 3 || compact.length === 6
            ? normalizeEditorHexColor(`#${compact}`, normalizedColor)
            : normalizedColor;
        setColorDraft(nextColor.slice(1));
        if (nextColor !== normalizedColor) onColorChange(nextColor);
    };

    const commitOpacity = (draft: string) => {
        const parsed = Number.parseFloat(draft);
        const nextPercent = Number.isFinite(parsed)
            ? Math.min(Math.max(parsed, 0), 100)
            : normalizedPercent;
        setOpacityDraft(String(nextPercent));
        if (nextPercent !== normalizedPercent) onOpacityChange(nextPercent / 100);
    };

    return (
        <div
            className="grid w-full min-w-0 overflow-hidden bg-[var(--color-editor-control)]"
            style={{
                height: "var(--editor-control-height)",
                borderRadius: "var(--editor-control-radius)",
                gridTemplateColumns: "minmax(0, 1fr) 94px",
            }}
        >
            <div className="flex min-w-0 items-center px-2" style={{ gap: 10 }}>
                <Popover.Root>
                    <Popover.Trigger>
                        <button
                            type="button"
                            aria-label="选择颜色"
                            title="选择颜色"
                            className="block h-4 w-4 shrink-0 overflow-hidden border border-white/20"
                            style={{
                                borderRadius: 3,
                                background: normalizedColor,
                            }}
                        />
                    </Popover.Trigger>
                    <Popover.Content
                        size="1"
                        style={{ width: 264, padding: 10, borderRadius: 16 }}
                    >
                        <HexAlphaColorPicker
                            className="editor-color-picker"
                            color={formatEditorColorOpacity(normalizedColor, normalizedOpacity)}
                            onChange={(nextColor) => {
                                const nextValue = parseEditorColorOpacity(nextColor);
                                if (onChange) {
                                    onChange(nextValue);
                                    return;
                                }
                                onColorChange(nextValue.color);
                                onOpacityChange(nextValue.opacity);
                            }}
                            style={{ width: "100%", height: 214 }}
                        />
                    </Popover.Content>
                </Popover.Root>
                <input
                    type="text"
                    value={colorDraft}
                    maxLength={6}
                    aria-label="十六进制颜色"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                        const nextDraft = event.target.value
                            .replace(/[^\da-f]/gi, "")
                            .slice(0, 6)
                            .toUpperCase();
                        setColorDraft(nextDraft);
                        if (nextDraft.length === 6) {
                            const nextColor = `#${nextDraft}`;
                            if (nextColor !== normalizedColor) onColorChange(nextColor);
                        }
                    }}
                    onBlur={() => commitColor(colorDraft)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm uppercase text-white outline-none"
                />
            </div>
            <div className="flex min-w-0 items-center border-l border-white/10 px-2" style={{ gap: 8 }}>
                <input
                    type="text"
                    inputMode="numeric"
                    value={opacityDraft}
                    aria-label="颜色透明度百分比"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                        const nextDraft = event.target.value;
                        if (!/^\d*$/.test(nextDraft)) return;
                        setOpacityDraft(nextDraft);
                        if (nextDraft === "") return;
                        const nextPercent = Number.parseFloat(nextDraft);
                        if (Number.isFinite(nextPercent)) {
                            onOpacityChange(Math.min(Math.max(nextPercent, 0), 100) / 100);
                        }
                    }}
                    onBlur={() => commitOpacity(opacityDraft)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="h-full min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-white outline-none"
                />
                <span className="shrink-0 select-none text-sm text-white/55">%</span>
            </div>
        </div>
    );
}

export function EditorSelect({
    value,
    options,
    onChange,
    placeholder,
    disabled = false,
}: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
}) {
    const stringValue = typeof value === "string" ? value : "";
    const safeOptions = options.filter(
        (option) => option && typeof option.value === "string",
    );
    return (
        <Select.Root value={stringValue || undefined} onValueChange={onChange} disabled={disabled}>
            <Select.Trigger
                placeholder={placeholder}
                className="editor-select-trigger w-full!"
                style={{
                    height: "var(--editor-control-height)",
                    borderRadius: "var(--editor-control-radius)",
                    background: "var(--color-editor-control)",
                    border: "none",
                    boxShadow: "none",
                    outline: "none",
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
    compact = false,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    compact?: boolean;
}) {
    return (
        <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            className="rt-SwitchRoot-editor"
            style={{
                width: compact ? 36 : "var(--editor-switch-width)",
                height: compact ? 18 : "var(--editor-switch-height)",
                borderRadius: compact ? 9 : "var(--editor-switch-radius)",
                "--switch-width": compact ? "36px" : "var(--editor-switch-width)",
                "--switch-height": compact ? "18px" : "var(--editor-switch-height)",
                "--switch-border-radius": compact ? "9px" : "var(--editor-switch-radius)",
                "--switch-thumb-width": compact ? "14px" : "calc(var(--editor-switch-height) - 4px)",
                "--switch-thumb-height": compact ? "14px" : "calc(var(--editor-switch-height) - 4px)",
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
    onEdit,
    onRemove,
    onAdd,
    allowCustom,
}: {
    colors: string[];
    selected: string;
    onSelect: (color: string) => void;
    onEdit: (color: string, rect: DOMRect) => void;
    onRemove: (color: string) => void;
    onAdd?: (rect: DOMRect) => void;
    allowCustom?: boolean;
}) {
    const safeColors = colors.filter((color) => typeof color === "string").map(String);
    const selectedKey = String(selected ?? "").toLowerCase();
    const canRemove = safeColors.length > 1;
    const showAdd = Boolean(allowCustom || onAdd);
    const colorRows: string[][] = [];
    let colorIndex = 0;
    while (safeColors.length - colorIndex > (showAdd ? 6 : 7)) {
        const remaining = safeColors.length - colorIndex;
        const rowSize = showAdd && remaining === 7 ? 6 : 7;
        colorRows.push(safeColors.slice(colorIndex, colorIndex + rowSize));
        colorIndex += rowSize;
    }
    if (colorIndex < safeColors.length || showAdd) {
        colorRows.push(safeColors.slice(colorIndex));
    }

    const renderColor = (color: string) => {
        const isSelected = color.toLowerCase() === selectedKey;
        return (
            <ContextMenu.Root key={color}>
                <ContextMenu.Trigger className="inline-flex h-[30px] items-center">
                    <button
                        type="button"
                        aria-pressed={isSelected}
                        title={isSelected ? "单击修改颜色，右键删除" : "单击选中，双击修改颜色，右键删除"}
                        onClick={(event) => {
                            if (event.detail >= 2) {
                                onEdit(color, event.currentTarget.getBoundingClientRect());
                                return;
                            }
                            if (isSelected) {
                                onEdit(color, event.currentTarget.getBoundingClientRect());
                            } else {
                                onSelect(color);
                            }
                        }}
                        className="block shrink-0"
                        style={{
                            width: isSelected ? 58 : 26,
                            height: isSelected ? 30 : 26,
                            borderRadius: isSelected ? 15 : 13,
                            background: color,
                            border: isSelected ? "2px solid rgba(255,255,255,0.78)" : 0,
                            boxShadow: isSelected
                                ? "inset 0 0 0 2px rgba(0,0,0,0.78)"
                                : "inset 0 0 0 1px rgba(255,255,255,0.25)",
                            transition: "width 220ms cubic-bezier(0.34, 1.56, 0.64, 1), height 220ms cubic-bezier(0.34, 1.56, 0.64, 1), border-radius 220ms cubic-bezier(0.34, 1.56, 0.64, 1), border-width 160ms ease, box-shadow 160ms ease",
                        }}
                    />
                </ContextMenu.Trigger>
                <ContextMenu.Content size="1">
                    <ContextMenu.Item
                        color="red"
                        disabled={!canRemove}
                        onSelect={() => onRemove(color)}
                    >
                        删除颜色
                    </ContextMenu.Item>
                </ContextMenu.Content>
            </ContextMenu.Root>
        );
    };

    return (
        <div className="flex flex-col" style={{ gap: 8, minHeight: 30 }}>
            {safeColors.length === 0 && (
                <span className="text-xs text-white/40">未配置颜色</span>
            )}
            {colorRows.map((row, rowIndex) => (
                <div
                    key={`color-row-${rowIndex}`}
                    className="flex h-[30px] shrink-0 items-center"
                    style={{ gap: 8 }}
                >
                    {row.map(renderColor)}
                    {showAdd && rowIndex === colorRows.length - 1 && (
                        <button
                            type="button"
                            onClick={(event) => onAdd?.(event.currentTarget.getBoundingClientRect())}
                            title="添加颜色"
                            className="flex items-center justify-center text-white/60 transition hover:text-white"
                            style={{ width: 26, height: 26 }}
                        >
                            <PlusIcon size={19} weight="regular" />
                        </button>
                    )}
                </div>
            ))}
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

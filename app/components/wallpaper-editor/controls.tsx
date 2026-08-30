import {
  Button,
  ContextMenu,
  Popover,
  Select,
  Switch,
} from "@radix-ui/themes";
import { CaretDownIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { WallpaperControlValue } from "~/logic/wallpaper/types";
import {
  controlDefault,
  controlMax,
  controlMin,
  controlStep,
} from "~/logic/wallpaper/control";
import { ScrubbableNumberField } from "./ScrubbableNumberField";

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
  const step = controlStep(control, 0.01);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patch = (key: "default" | "min" | "max" | "step", value: number) =>
    onChange({ [key]: value });
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
                    gridTemplateColumns: "minmax(118px, 1.3fr) minmax(70px, 0.85fr)",
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
      <div className="flex w-full items-center" style={{ gap: 8 }}>
        <div className="min-w-0 flex-1">
          <EditorNumberField
            value={def}
            min={min}
            max={max}
            step={step}
            onChange={(v) => patch("default", v)}
            onScrubStateChange={onDragStateChange}
          />
        </div>
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex h-[var(--editor-control-height)] w-[96px] shrink-0 items-center justify-between px-2 text-left text-[12px] text-white/55 transition hover:text-white/80"
          style={{
            borderRadius: "var(--editor-control-radius)",
            background: "var(--color-editor-control)",
          }}
        >
          <span>范围设置</span>
          <CaretDownIcon
            size={14}
            weight="regular"
            style={{ transform: advancedOpen ? "rotate(180deg)" : undefined }}
          />
        </button>
      </div>
      {advancedOpen && (
        <div
          className="grid w-full"
          style={{
            gridTemplateColumns: "minmax(118px, 1.3fr) minmax(70px, 0.85fr)",
            gap: "var(--editor-control-gap)",
          }}
        >
          <EditorRangeField
            min={min}
            max={max}
            radius="var(--editor-control-radius) 0 0 var(--editor-control-radius)"
            onMinChange={(value) => patch("min", value)}
            onMaxChange={(value) => patch("max", value)}
          />
          <EditorNumberField
            value={step}
            radius="0 var(--editor-control-radius) var(--editor-control-radius) 0"
            onChange={(v) => patch("step", v)}
          />
        </div>
      )}
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
    radius,
    onMinChange,
    onMaxChange,
}: {
    min: number;
    max: number;
    radius?: React.CSSProperties["borderRadius"];
    onMinChange: (value: number) => void;
    onMaxChange: (value: number) => void;
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
            <input
                type="number"
                value={min}
                max={max}
                aria-label="区间最小值"
                onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    onMinChange(Number.isFinite(value) ? value : 0);
                }}
                className="editor-number-input h-full min-w-0 w-full bg-transparent pl-2 pr-1 font-mono text-sm text-white outline-none"
            />
            <span className="select-none text-xs text-white/35">~</span>
            <input
                type="number"
                value={max}
                min={min}
                aria-label="区间最大值"
                onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    onMaxChange(Number.isFinite(value) ? value : min);
                }}
                className="editor-number-input h-full min-w-0 w-full bg-transparent pl-1 pr-2 font-mono text-sm text-white outline-none"
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

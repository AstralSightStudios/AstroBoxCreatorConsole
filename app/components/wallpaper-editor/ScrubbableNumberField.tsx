import { isTauri } from "@tauri-apps/api/core";
import {
    cursorPosition,
    getCurrentWindow,
    LogicalPosition,
} from "@tauri-apps/api/window";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import type {
    CSSProperties,
    KeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
    applyNumericScrubDelta,
    canStepNumericValue,
    clampNumericValue,
    formatNumericValue,
    numericScrubMultiplier,
    numericStepsToBoundary,
    normalizeNumericStep,
    NUMERIC_SCRUB_METRICS,
    resolveNumericScrubWarp,
    resolveNumericScrubTier,
    stepNumericValue,
} from "./numeric-scrub";
import type { NumericScrubTier } from "./numeric-scrub";

const STEPPER_CLICK_SUPPRESSION_MS = 250;

interface ScrubSession {
    pointerId: number;
    captureTarget: HTMLElement;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    pendingX: number;
    pendingY: number;
    verticalOffset: number;
    tier: NumericScrubTier;
    progress: number;
    startValue: number;
    currentValue: number;
    buttonDirection?: -1 | 1;
    active: boolean;
    cursorWrapDisabled: boolean;
    lastDomMoveAt: number;
    warp?: {
        targetX: number;
        startedAt: number;
    };
    cursorQueue: Promise<void>;
    stopNativeTracking?: () => void;
    removeWindowListeners?: () => void;
}

interface ScrubPointerMoveEvent {
    pointerId: number;
    clientX: number;
    clientY: number;
    preventDefault: () => void;
}

export interface ScrubbableNumberFieldProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    prefix?: ReactNode;
    suffix?: string;
    radius?: CSSProperties["borderRadius"];
    disabled?: boolean;
    readOnly?: boolean;
    ariaLabel?: string;
    showStepper?: boolean;
    onScrubStateChange?: (scrubbing: boolean) => void;
}

function ScrubRuler({
    value,
    progress,
    spacing,
    min,
    max,
    step,
}: {
    value: number;
    progress: number;
    spacing: number;
    min?: number;
    max?: number;
    step: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(rect.width * ratio);
        canvas.height = Math.ceil(rect.height * ratio);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);

        const center = rect.width / 2;
        const halfWidth = Math.max(1, center);
        const lineHeight = rect.height * 0.55;
        const top = (rect.height - lineHeight) / 2;
        const bottom = top + lineHeight;
        const phase = progress * spacing;
        const lineCount = Math.ceil(rect.width / spacing) + 2;
        const increaseCount = numericStepsToBoundary(max, value, step, true);
        const decreaseCount = numericStepsToBoundary(min, value, step, false);
        const color = getComputedStyle(canvas).color;

        context.lineCap = "round";
        context.lineWidth = 1;
        context.strokeStyle = color;
        for (let index = -lineCount; index <= lineCount; index += 1) {
            if (increaseCount !== undefined && index < -increaseCount) continue;
            if (decreaseCount !== undefined && index > decreaseCount) continue;
            const x = center + phase + index * spacing;
            if (x < -spacing || x > rect.width + spacing) continue;
            const distance = Math.min(1, Math.abs(x - center) / halfWidth);
            const opacity = Math.pow(1 - distance, 1.65) * 0.72;
            if (opacity <= 0.01) continue;
            context.globalAlpha = opacity;
            context.beginPath();
            context.moveTo(x, top);
            context.lineTo(x, bottom);
            context.stroke();
        }

        context.globalAlpha = 0.96;
        context.lineWidth = 1.25;
        context.beginPath();
        context.moveTo(center, top);
        context.lineTo(center, bottom);
        context.stroke();
        context.globalAlpha = 1;
    }, [max, min, progress, spacing, step, value]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="scrubbable-number-ruler"
        />
    );
}

export function ScrubbableNumberField({
    value,
    onChange,
    min,
    max,
    step,
    placeholder,
    prefix,
    suffix,
    radius,
    disabled = false,
    readOnly = false,
    ariaLabel,
    showStepper = true,
    onScrubStateChange,
}: ScrubbableNumberFieldProps) {
    const normalizedStep = normalizeNumericStep(step);
    const normalizedValue = clampNumericValue(value, min, max);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const valueRef = useRef(normalizedValue);
    const editingRef = useRef(false);
    const editingStartValueRef = useRef(normalizedValue);
    const onScrubStateChangeRef = useRef(onScrubStateChange);
    const sessionRef = useRef<ScrubSession | null>(null);
    const suppressStepperClickUntilRef = useRef(0);
    const draftRef = useRef(formatNumericValue(normalizedValue));
    const [draft, setDraft] = useState(draftRef.current);
    const [scrubVisual, setScrubVisual] = useState<{
        active: boolean;
        value: number;
        progress: number;
        spacing: number;
    }>({
        active: false,
        value: normalizedValue,
        progress: 0,
        spacing: NUMERIC_SCRUB_METRICS.baseSpacing,
    });
    const [overlayPosition, setOverlayPosition] = useState({ left: 0, top: 0 });
    const canAdjust =
        !disabled &&
        !readOnly &&
        (canStepNumericValue(normalizedValue, 1, min, max) ||
            canStepNumericValue(normalizedValue, -1, min, max));

    const updateDraft = (nextDraft: string) => {
        draftRef.current = nextDraft;
        setDraft(nextDraft);
    };

    useEffect(() => {
        valueRef.current = normalizedValue;
        if (!editingRef.current && !sessionRef.current?.active) {
            updateDraft(formatNumericValue(normalizedValue));
        }
    }, [normalizedValue]);

    useEffect(() => {
        onScrubStateChangeRef.current = onScrubStateChange;
    }, [onScrubStateChange]);

    useLayoutEffect(() => {
        if (!scrubVisual.active) return;
        const updatePosition = () => {
            const rect = rootRef.current?.getBoundingClientRect();
            if (!rect) return;
            setOverlayPosition({
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
            });
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [scrubVisual.active]);

    const emitValue = (nextValue: number) => {
        valueRef.current = nextValue;
        updateDraft(formatNumericValue(nextValue));
        onChange(nextValue);
    };

    const adjustBySteps = (steps: number) => {
        const nextValue = stepNumericValue(
            valueRef.current,
            steps,
            normalizedStep,
            min,
            max,
        );
        if (nextValue !== valueRef.current) emitValue(nextValue);
    };

    const setGlobalScrubCursor = (active: boolean) => {
        document.documentElement.classList.toggle("numeric-scrub-active", active);
    };

    const queueCursorPosition = (
        session: ScrubSession,
        x: number,
        y: number,
        onFailure?: () => void,
    ) => {
        if (!isTauri()) return;
        session.cursorQueue = session.cursorQueue
            .catch(() => undefined)
            .then(() =>
                getCurrentWindow().setCursorPosition(new LogicalPosition(x, y)),
            )
            .catch(() => {
                onFailure?.();
            });
    };

    const restoreCursor = (session: ScrubSession) => {
        if (!isTauri()) return;
        queueCursorPosition(session, session.startX, session.startY);
    };

    const finishScrub = (canceled: boolean) => {
        const session = sessionRef.current;
        if (!session) return;
        sessionRef.current = null;
        session.stopNativeTracking?.();
        session.removeWindowListeners?.();
        try {
            if (session.captureTarget.hasPointerCapture(session.pointerId)) {
                session.captureTarget.releasePointerCapture(session.pointerId);
            }
        } catch {
            // 指针捕获可能已由系统释放。
        }

        if (!session.active) return;

        if (session.buttonDirection) {
            suppressStepperClickUntilRef.current =
                performance.now() + STEPPER_CLICK_SUPPRESSION_MS;
        }

        if (canceled && session.currentValue !== session.startValue) {
            emitValue(session.startValue);
        }
        restoreCursor(session);
        setGlobalScrubCursor(false);
        setScrubVisual({
            active: false,
            value: canceled ? session.startValue : session.currentValue,
            progress: 0,
            spacing: NUMERIC_SCRUB_METRICS.baseSpacing,
        });
        onScrubStateChangeRef.current?.(false);
    };

    useEffect(() => {
        if (!scrubVisual.active) return;
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            finishScrub(true);
        };
        const handleWindowBlur = () => finishScrub(true);
        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") finishScrub(true);
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("blur", handleWindowBlur);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("blur", handleWindowBlur);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    });

    useEffect(
        () => () => {
            const session = sessionRef.current;
            session?.stopNativeTracking?.();
            session?.removeWindowListeners?.();
            if (session?.active) {
                restoreCursor(session);
                setGlobalScrubCursor(false);
                onScrubStateChangeRef.current?.(false);
            }
        },
        [],
    );

    const startNativeCursorTracking = (session: ScrubSession) => {
        if (!isTauri()) return;
        const appWindow = getCurrentWindow();
        let stopped = false;
        let polling = false;
        let intervalId: number | undefined;

        session.stopNativeTracking = () => {
            stopped = true;
            if (intervalId !== undefined) window.clearInterval(intervalId);
        };

        void Promise.all([
            cursorPosition(),
            appWindow.scaleFactor(),
        ]).then(([initialPosition, scaleFactor]) => {
            if (
                stopped ||
                sessionRef.current !== session ||
                !Number.isFinite(scaleFactor) ||
                scaleFactor <= 0
            ) {
                return;
            }

            let lastNativeX = initialPosition.x;
            let lastNativeY = initialPosition.y;

            const poll = async () => {
                if (
                    stopped ||
                    polling ||
                    sessionRef.current !== session
                ) {
                    return;
                }
                polling = true;
                try {
                    const position = await cursorPosition();
                    const deltaX = (position.x - lastNativeX) / scaleFactor;
                    const deltaY = (position.y - lastNativeY) / scaleFactor;
                    lastNativeX = position.x;
                    lastNativeY = position.y;
                    if (
                        stopped ||
                        sessionRef.current !== session ||
                        performance.now() - session.lastDomMoveAt <
                            NUMERIC_SCRUB_METRICS.nativeFallbackDelay
                    ) {
                        return;
                    }
                    handleScrubMove(
                        {
                            pointerId: session.pointerId,
                            clientX: session.lastX + deltaX,
                            clientY: session.lastY + deltaY,
                            preventDefault: () => undefined,
                        },
                        "native",
                    );
                } catch {
                    session.stopNativeTracking?.();
                } finally {
                    polling = false;
                }
            };

            intervalId = window.setInterval(
                () => void poll(),
                NUMERIC_SCRUB_METRICS.nativePollInterval,
            );
            void poll();
        }).catch(() => {
            session.stopNativeTracking?.();
        });
    };

    const beginScrub = (
        event: ReactPointerEvent<HTMLElement>,
        buttonDirection?: -1 | 1,
        preserveClick = false,
    ) => {
        if (
            !canAdjust ||
            sessionRef.current !== null ||
            event.button !== 0 ||
            (event.pointerType !== "mouse" && event.pointerType !== "pen")
        ) {
            return;
        }
        if (!preserveClick) event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const session: ScrubSession = {
            pointerId: event.pointerId,
            captureTarget: event.currentTarget,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            pendingX: 0,
            pendingY: 0,
            verticalOffset: 0,
            tier: 0,
            progress: 0,
            startValue: valueRef.current,
            currentValue: valueRef.current,
            buttonDirection,
            active: false,
            cursorWrapDisabled: false,
            lastDomMoveAt: performance.now(),
            cursorQueue: Promise.resolve(),
        };
        const handleWindowMove = (pointerEvent: PointerEvent) => {
            handleScrubMove(pointerEvent, "dom");
        };
        const handleWindowUp = (pointerEvent: PointerEvent) => {
            if (pointerEvent.pointerId === session.pointerId) finishScrub(false);
        };
        const handleWindowCancel = (pointerEvent: PointerEvent) => {
            if (pointerEvent.pointerId === session.pointerId) finishScrub(true);
        };
        window.addEventListener("pointermove", handleWindowMove, { passive: false });
        window.addEventListener("pointerup", handleWindowUp);
        window.addEventListener("pointercancel", handleWindowCancel);
        session.removeWindowListeners = () => {
            window.removeEventListener("pointermove", handleWindowMove);
            window.removeEventListener("pointerup", handleWindowUp);
            window.removeEventListener("pointercancel", handleWindowCancel);
        };
        sessionRef.current = session;
        if (event.pointerType === "mouse") startNativeCursorTracking(session);
    };

    const maybeWrapCursor = (
        session: ScrubSession,
        pointerX: number,
        pointerY: number,
        deltaX: number,
    ) => {
        if (!isTauri() || session.cursorWrapDisabled || session.warp || deltaX === 0) {
            return;
        }
        const left = NUMERIC_SCRUB_METRICS.edgeInset;
        const right = window.innerWidth - NUMERIC_SCRUB_METRICS.edgeInset;
        if (right <= left) return;
        const canIncrease = canStepNumericValue(session.currentValue, 1, min, max);
        const canDecrease = canStepNumericValue(session.currentValue, -1, min, max);
        let targetX: number | undefined;
        if (deltaX > 0 && canIncrease && pointerX >= right) {
            targetX = left;
        } else if (deltaX < 0 && canDecrease && pointerX <= left) {
            targetX = right;
        }
        if (targetX === undefined) return;

        session.warp = {
            targetX,
            startedAt: performance.now(),
        };
        queueCursorPosition(session, targetX, pointerY, () => {
            if (sessionRef.current !== session) return;
            session.cursorWrapDisabled = true;
            session.warp = undefined;
            session.lastX = pointerX;
            session.lastY = pointerY;
        });
    };

    const handleScrubMove = (
        event: ScrubPointerMoveEvent,
        source: "dom" | "native" = "dom",
    ) => {
        const session = sessionRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        event.preventDefault();
        if (source === "dom") session.lastDomMoveAt = performance.now();

        let deltaX: number;
        let deltaY: number;
        if (session.warp) {
            const resolution = resolveNumericScrubWarp(
                event.clientX,
                session.warp.targetX,
                performance.now() - session.warp.startedAt,
            );
            if (resolution.kind === "pending") return;
            if (resolution.kind === "expired") {
                session.cursorWrapDisabled = true;
                session.warp = undefined;
                session.lastX = event.clientX;
                session.lastY = event.clientY;
                return;
            }
            deltaX = resolution.deltaX;
            deltaY = event.clientY - session.lastY;
            session.warp = undefined;
        } else {
            deltaX = event.clientX - session.lastX;
            deltaY = event.clientY - session.lastY;
        }
        session.lastX = event.clientX;
        session.lastY = event.clientY;

        if (!session.active) {
            session.pendingX += deltaX;
            session.pendingY += deltaY;
            const distance = Math.hypot(
                event.clientX - session.startX,
                event.clientY - session.startY,
            );
            if (distance < NUMERIC_SCRUB_METRICS.activationDistance) return;
            session.active = true;
            session.buttonDirection = undefined;
            deltaX = session.pendingX;
            deltaY = session.pendingY;
            session.pendingX = 0;
            session.pendingY = 0;
            setGlobalScrubCursor(true);
            onScrubStateChangeRef.current?.(true);
        }

        session.verticalOffset += deltaY;
        session.tier = resolveNumericScrubTier(
            session.tier,
            session.verticalOffset,
        );
        const spacing =
            NUMERIC_SCRUB_METRICS.baseSpacing /
            numericScrubMultiplier(session.tier);
        const result = applyNumericScrubDelta({
            value: session.currentValue,
            progress: session.progress,
            deltaX,
            spacing,
            step: normalizedStep,
            min,
            max,
        });
        session.currentValue = result.value;
        session.progress = result.progress;
        if (result.value !== valueRef.current) emitValue(result.value);
        setScrubVisual({
            active: true,
            value: result.value,
            progress: result.progress,
            spacing,
        });
        maybeWrapCursor(session, event.clientX, event.clientY, deltaX);
    };

    const commitDraft = (keepEditing = false) => {
        const currentDraft = draftRef.current;
        const parsed = Number(currentDraft.trim());
        if (currentDraft.trim() === "" || !Number.isFinite(parsed)) {
            editingRef.current = keepEditing;
            updateDraft(formatNumericValue(valueRef.current));
            return;
        }
        const nextValue = clampNumericValue(parsed, min, max);
        if (nextValue !== valueRef.current) emitValue(nextValue);
        else updateDraft(formatNumericValue(nextValue));
        editingRef.current = keepEditing;
        editingStartValueRef.current = nextValue;
    };

    const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            adjustBySteps(event.key === "ArrowUp" ? 1 : -1);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            commitDraft(true);
            event.currentTarget.select();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            emitValue(editingStartValueRef.current);
            updateDraft(formatNumericValue(editingStartValueRef.current));
            event.currentTarget.select();
        }
    };

    const handleStepperClick = (direction: -1 | 1) => {
        if (performance.now() < suppressStepperClickUntilRef.current) {
            suppressStepperClickUntilRef.current = 0;
            return;
        }
        adjustBySteps(direction);
    };

    const canIncrease = canStepNumericValue(normalizedValue, 1, min, max);
    const canDecrease = canStepNumericValue(normalizedValue, -1, min, max);

    return (
        <div
            ref={rootRef}
            className={`scrubbable-number-field${scrubVisual.active ? " is-scrubbing" : ""}`}
            data-adjustable={canAdjust}
            data-has-suffix={Boolean(suffix)}
            data-has-stepper={showStepper}
            style={{ borderRadius: radius }}
            onPointerDown={(event) => beginScrub(event, undefined, true)}
            onLostPointerCapture={() => finishScrub(true)}
        >
            <div className="scrubbable-number-content">
                <span
                    className="scrubbable-number-prefix"
                    data-empty={prefix === undefined || prefix === null}
                    aria-hidden="true"
                    onPointerDown={(event) => beginScrub(event)}
                    onLostPointerCapture={() => finishScrub(true)}
                >
                    {prefix}
                </span>
                <div className="scrubbable-number-value">
                    <span
                        className="scrubbable-number-measure"
                        aria-hidden="true"
                    >
                        {draft || placeholder || "0"}
                    </span>
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="decimal"
                        role="spinbutton"
                        aria-label={ariaLabel}
                        aria-valuemin={Number.isFinite(min) ? min : undefined}
                        aria-valuemax={Number.isFinite(max) ? max : undefined}
                        aria-valuenow={Number.isFinite(normalizedValue) ? normalizedValue : undefined}
                        value={draft}
                        placeholder={placeholder}
                        disabled={disabled}
                        readOnly={readOnly}
                        onFocus={() => {
                            editingRef.current = true;
                            editingStartValueRef.current = valueRef.current;
                        }}
                        onChange={(event) => {
                            const nextDraft = event.target.value;
                            updateDraft(nextDraft);
                            const parsed = Number(nextDraft.trim());
                            if (nextDraft.trim() === "" || !Number.isFinite(parsed)) return;
                            const nextValue = clampNumericValue(parsed, min, max);
                            if (nextValue !== valueRef.current) {
                                valueRef.current = nextValue;
                                onChange(nextValue);
                            }
                        }}
                        onBlur={() => {
                            if (sessionRef.current?.active) {
                                editingRef.current = false;
                                finishScrub(true);
                                return;
                            }
                            commitDraft(false);
                        }}
                        onKeyDown={handleInputKeyDown}
                        className="editor-number-input scrubbable-number-input"
                    />
                </div>
                {suffix && <span className="scrubbable-number-suffix">{suffix}</span>}
                {showStepper && (
                    <div className="scrubbable-number-stepper">
                        <button
                            type="button"
                            aria-label="增加数值"
                            data-enabled={canIncrease}
                            onPointerDown={(event) => beginScrub(event, 1)}
                            onLostPointerCapture={() => finishScrub(true)}
                            onClick={() => handleStepperClick(1)}
                        >
                            <CaretUpIcon size={11} className="-mb-[1px]" weight="bold" />
                        </button>
                        <button
                            type="button"
                            aria-label="减少数值"
                            data-enabled={canDecrease}
                            onPointerDown={(event) => beginScrub(event, -1)}
                            onLostPointerCapture={() => finishScrub(true)}
                            onClick={() => handleStepperClick(-1)}
                        >
                            <CaretDownIcon size={11} className="-mt-[1px]" weight="bold" />
                        </button>
                    </div>
                )}
            </div>
            {scrubVisual.active && (
                <ScrubRuler
                    value={scrubVisual.value}
                    progress={scrubVisual.progress}
                    spacing={scrubVisual.spacing}
                    min={min}
                    max={max}
                    step={normalizedStep}
                />
            )}
            {scrubVisual.active &&
                createPortal(
                    <div
                        className="scrubbable-number-overlay"
                        style={{
                            left: overlayPosition.left,
                            top: overlayPosition.top,
                        }}
                        aria-hidden="true"
                    >
                        <span>{formatNumericValue(scrubVisual.value)}</span>
                        {suffix && <small>{suffix}</small>}
                    </div>,
                    document.body,
                )}
        </div>
    );
}

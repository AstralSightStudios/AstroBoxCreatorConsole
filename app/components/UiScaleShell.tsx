import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PropsWithChildren,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { UiScaleProvider } from "~/components/UiScaleContext";
import {
    calculateUiScaleMetrics,
    DEFAULT_UI_SCALE,
    useUiScale,
    type SafeAreaInsets,
} from "~/config/uiScale";

interface PhysicalViewport {
    width: number;
    height: number;
    safeArea: SafeAreaInsets;
}

interface UiScaleShellProps extends PropsWithChildren {
    disabled?: boolean;
}

type UiScaleStyle = CSSProperties & {
    "--ui-scale-factor": string;
    "--ui-viewport-width": string;
    "--ui-viewport-height": string;
    "--ui-viewport-height-30pct": string;
    "--ui-viewport-height-46pct": string;
    "--ui-viewport-height-52pct": string;
    "--ui-viewport-height-56pct": string;
    "--ui-viewport-height-64pct": string;
    "--ui-viewport-height-72pct": string;
    "--ui-viewport-height-78pct": string;
    "--ui-viewport-height-80pct": string;
    "--ui-safe-area-top": string;
    "--ui-safe-area-right": string;
    "--ui-safe-area-bottom": string;
    "--ui-safe-area-left": string;
    "--ui-titlebar-gradient-height": string;
    "--macos-titlebar-height": string;
    "--macos-titlebar-gradient-height": string;
};

const EMPTY_SAFE_AREA: SafeAreaInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

function readViewport(probe: HTMLDivElement | null): PhysicalViewport {
    const safeArea = probe
        ? (() => {
            const style = getComputedStyle(probe);
            return {
                top: Number.parseFloat(style.paddingTop) || 0,
                right: Number.parseFloat(style.paddingRight) || 0,
                bottom: Number.parseFloat(style.paddingBottom) || 0,
                left: Number.parseFloat(style.paddingLeft) || 0,
            };
        })()
        : EMPTY_SAFE_AREA;

    return {
        width: window.innerWidth,
        height: window.innerHeight,
        safeArea,
    };
}

function hasSameViewport(left: PhysicalViewport, right: PhysicalViewport) {
    return left.width === right.width &&
        left.height === right.height &&
        left.safeArea.top === right.safeArea.top &&
        left.safeArea.right === right.safeArea.right &&
        left.safeArea.bottom === right.safeArea.bottom &&
        left.safeArea.left === right.safeArea.left;
}

export default function UiScaleShell({
    children,
    disabled = false,
}: UiScaleShellProps) {
    const savedFactor = useUiScale();
    const factor = disabled ? 1 : savedFactor;
    const safeAreaProbeRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
    const [physicalViewport, setPhysicalViewport] = useState<PhysicalViewport>(() => ({
        width: typeof window === "undefined" ? 0 : window.innerWidth,
        height: typeof window === "undefined" ? 0 : window.innerHeight,
        safeArea: EMPTY_SAFE_AREA,
    }));

    const syncViewport = useCallback(() => {
        if (typeof window === "undefined") return;
        const nextViewport = readViewport(safeAreaProbeRef.current);
        setPhysicalViewport((currentViewport) =>
            hasSameViewport(currentViewport, nextViewport)
                ? currentViewport
                : nextViewport
        );
    }, []);

    useLayoutEffect(() => {
        const scheduleSync = () => {
            if (animationFrameRef.current !== null) return;
            animationFrameRef.current = window.requestAnimationFrame(() => {
                animationFrameRef.current = null;
                syncViewport();
            });
        };

        syncViewport();
        window.addEventListener("resize", scheduleSync);
        window.addEventListener("orientationchange", scheduleSync);
        window.visualViewport?.addEventListener("resize", scheduleSync);

        return () => {
            window.removeEventListener("resize", scheduleSync);
            window.removeEventListener("orientationchange", scheduleSync);
            window.visualViewport?.removeEventListener("resize", scheduleSync);
            if (animationFrameRef.current !== null) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [syncViewport]);

    const metrics = useMemo(
        () => calculateUiScaleMetrics(
            physicalViewport.width,
            physicalViewport.height,
            factor,
            physicalViewport.safeArea,
        ),
        [factor, physicalViewport],
    );

    useLayoutEffect(() => {
        const root = document.documentElement;
        root.dataset.uiNarrow = String(metrics.isNarrow);
        root.dataset.uiDesktop = String(metrics.isDesktop);
        root.dataset.uiScaleActive = String(savedFactor !== DEFAULT_UI_SCALE);

        return () => {
            delete root.dataset.uiNarrow;
            delete root.dataset.uiDesktop;
            delete root.dataset.uiScaleActive;
        };
    }, [metrics.isDesktop, metrics.isNarrow, savedFactor]);

    useEffect(() => {
        const isMacOS = document.documentElement.classList.contains("macos");
        if (!isMacOS || !("__TAURI_INTERNALS__" in window)) return;

        void invoke("set_ui_scale_active", {
            active: savedFactor !== DEFAULT_UI_SCALE,
        }).catch(() => undefined);
    }, [savedFactor]);

    const supportsZoom =
        typeof CSS !== "undefined" && CSS.supports("zoom", "1");
    const usesStandardTitlebar =
        metrics.isNarrow || savedFactor !== DEFAULT_UI_SCALE;
    const nativeTitlebarHeight = (usesStandardTitlebar ? 32 : 42) / factor;
    const stageStyle: UiScaleStyle = {
        width: `${metrics.logicalWidth}px`,
        height: `${metrics.logicalHeight}px`,
        "--ui-scale-factor": String(factor),
        "--ui-viewport-width": `${metrics.logicalWidth}px`,
        "--ui-viewport-height": `${metrics.logicalHeight}px`,
        "--ui-viewport-height-30pct": `${metrics.logicalHeight * 0.3}px`,
        "--ui-viewport-height-46pct": `${metrics.logicalHeight * 0.46}px`,
        "--ui-viewport-height-52pct": `${metrics.logicalHeight * 0.52}px`,
        "--ui-viewport-height-56pct": `${metrics.logicalHeight * 0.56}px`,
        "--ui-viewport-height-64pct": `${metrics.logicalHeight * 0.64}px`,
        "--ui-viewport-height-72pct": `${metrics.logicalHeight * 0.72}px`,
        "--ui-viewport-height-78pct": `${metrics.logicalHeight * 0.78}px`,
        "--ui-viewport-height-80pct": `${metrics.logicalHeight * 0.8}px`,
        "--ui-safe-area-top": `${metrics.safeArea.top}px`,
        "--ui-safe-area-right": `${metrics.safeArea.right}px`,
        "--ui-safe-area-bottom": `${metrics.safeArea.bottom}px`,
        "--ui-safe-area-left": `${metrics.safeArea.left}px`,
        "--ui-titlebar-gradient-height": `${metrics.safeArea.top + 96 / factor}px`,
        "--macos-titlebar-height": `${nativeTitlebarHeight}px`,
        "--macos-titlebar-gradient-height": `${nativeTitlebarHeight + 92 / factor}px`,
    };

    const contextValue = useMemo(
        () => ({
            factor,
            logicalWidth: metrics.logicalWidth,
            logicalHeight: metrics.logicalHeight,
            isNarrow: metrics.isNarrow,
            isDesktop: metrics.isDesktop,
            safeArea: metrics.safeArea,
            portalContainer,
        }),
        [factor, metrics, portalContainer],
    );

    return (
        <div className="ui-scale-viewport">
            <div ref={safeAreaProbeRef} className="ui-safe-area-probe" aria-hidden="true" />
            <UiScaleProvider value={contextValue}>
                <div
                    className="ui-scale-stage"
                    data-scale-renderer={supportsZoom ? "zoom" : "transform"}
                    style={stageStyle}
                >
                    {children}
                    <div
                        ref={setPortalContainer}
                        className="ui-scale-portal-host"
                    />
                </div>
            </UiScaleProvider>
        </div>
    );
}

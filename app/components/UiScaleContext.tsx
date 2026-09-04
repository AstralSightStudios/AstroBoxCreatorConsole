import { createContext, useContext, type ReactNode } from "react";
import type { SafeAreaInsets } from "~/config/uiScale";

// 为布局、导航与浮层共享同一套逻辑视口
export interface UiScaleViewportValue {
    factor: number;
    logicalWidth: number;
    logicalHeight: number;
    isNarrow: boolean;
    isDesktop: boolean;
    safeArea: SafeAreaInsets;
    portalContainer: HTMLElement | null;
}

const DEFAULT_SAFE_AREA: SafeAreaInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

const DEFAULT_VALUE: UiScaleViewportValue = {
    factor: 1,
    logicalWidth: 0,
    logicalHeight: 0,
    isNarrow: false,
    isDesktop: true,
    safeArea: DEFAULT_SAFE_AREA,
    portalContainer: null,
};

const UiScaleContext = createContext<UiScaleViewportValue>(DEFAULT_VALUE);

interface UiScaleProviderProps {
    value: UiScaleViewportValue;
    children: ReactNode;
}

export function UiScaleProvider({ value, children }: UiScaleProviderProps) {
    return (
        <UiScaleContext.Provider value={value}>
            {children}
        </UiScaleContext.Provider>
    );
}

export function useUiScaleViewport() {
    return useContext(UiScaleContext);
}

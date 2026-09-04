import { useSyncExternalStore } from "react";

// 界面缩放配置与纯计算逻辑
export interface UiScaleOption {
    id: string;
    label: string;
    factor: number;
    description: string;
}

export interface SafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface UiScaleMetrics {
    physicalWidth: number;
    physicalHeight: number;
    logicalWidth: number;
    logicalHeight: number;
    safeArea: SafeAreaInsets;
    isNarrow: boolean;
    isDesktop: boolean;
}

export interface NavigatorIdentity {
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
}

export const DEFAULT_UI_SCALE = 1;
export const UI_NARROW_MAX_WIDTH = 399.98;
export const UI_DESKTOP_MIN_WIDTH = 1280;

export const UI_SCALE_OPTIONS: UiScaleOption[] = [
    {
        id: "standard",
        label: "标准 100%",
        factor: 1,
        description: "默认界面比例，适配多数场景。",
    },
    {
        id: "large",
        label: "110%",
        factor: 1.1,
        description: "轻微放大文字与控件，兼顾空间与可读性。",
    },
    {
        id: "xlarge",
        label: "120%",
        factor: 1.2,
        description: "进一步放大文字与控件，提升阅读和触控体验。",
    },
];

const STORAGE_KEY = "ABCC_UI_SCALE_V1";
const EMPTY_SAFE_AREA: SafeAreaInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedScale: number | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeFactor(value: number): number {
    for (const option of UI_SCALE_OPTIONS) {
        if (option.factor === value) return value;
    }
    return DEFAULT_UI_SCALE;
}

function readScaleFromStorage(): number {
    if (!isBrowser()) return DEFAULT_UI_SCALE;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_UI_SCALE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_UI_SCALE;
    return normalizeFactor(parsed);
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedScale = readScaleFromStorage();
            notifySubscribers();
        }
    });
    storageListenerAttached = true;
}

export function calculateUiScaleMetrics(
    physicalWidth: number,
    physicalHeight: number,
    factor: number,
    physicalSafeArea: SafeAreaInsets = EMPTY_SAFE_AREA,
): UiScaleMetrics {
    const normalizedFactor = Number.isFinite(factor) && factor > 0
        ? factor
        : DEFAULT_UI_SCALE;
    const logicalWidth = physicalWidth / normalizedFactor;
    const logicalHeight = physicalHeight / normalizedFactor;

    return {
        physicalWidth,
        physicalHeight,
        logicalWidth,
        logicalHeight,
        safeArea: {
            top: physicalSafeArea.top / normalizedFactor,
            right: physicalSafeArea.right / normalizedFactor,
            bottom: physicalSafeArea.bottom / normalizedFactor,
            left: physicalSafeArea.left / normalizedFactor,
        },
        isNarrow: logicalWidth <= UI_NARROW_MAX_WIDTH,
        isDesktop: logicalWidth >= UI_DESKTOP_MIN_WIDTH,
    };
}

export function isDesktopMac(identity: NavigatorIdentity): boolean {
    const reportsMac =
        /Macintosh|Mac OS X/i.test(identity.userAgent) ||
        /^Mac/i.test(identity.platform);
    const reportsIPad =
        /iPad/i.test(identity.userAgent) ||
        (reportsMac && identity.maxTouchPoints > 1);

    return reportsMac && !reportsIPad;
}

export function loadUiScale(): number {
    if (typeof cachedScale !== "number") {
        cachedScale = readScaleFromStorage();
    }
    return cachedScale;
}

export function saveUiScale(factor: number) {
    cachedScale = normalizeFactor(factor);
    if (isBrowser()) localStorage.setItem(STORAGE_KEY, String(cachedScale));
    notifySubscribers();
}

export function useUiScale(): number {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadUiScale,
        () => DEFAULT_UI_SCALE,
    );
}

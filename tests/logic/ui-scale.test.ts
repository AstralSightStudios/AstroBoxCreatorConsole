import { describe, expect, test } from "bun:test";
import {
    calculateUiScaleMetrics,
    isDesktopMac,
    UI_SCALE_OPTIONS,
} from "../../app/config/uiScale";

describe("界面缩放尺寸", () => {
    test("只提供三档显示比例", () => {
        expect(UI_SCALE_OPTIONS.map((option) => option.factor)).toEqual([1, 1.1, 1.2]);
    });

    test("按照比例计算逻辑视口", () => {
        const metrics = calculateUiScaleMetrics(900, 600, 1.5);

        expect(metrics.logicalWidth).toBe(600);
        expect(metrics.logicalHeight).toBe(400);
        expect(metrics.isDesktop).toBe(false);
    });

    test("安全区经过缩放后保持物理尺寸", () => {
        const metrics = calculateUiScaleMetrics(900, 600, 1.5, {
            top: 45,
            right: 12,
            bottom: 30,
            left: 12,
        });

        expect(metrics.safeArea.top * 1.5).toBe(45);
        expect(metrics.safeArea.right * 1.5).toBe(12);
        expect(metrics.safeArea.bottom * 1.5).toBe(30);
        expect(metrics.safeArea.left * 1.5).toBe(12);
    });

    test("使用缩放后的逻辑宽度判断窄屏", () => {
        const metrics = calculateUiScaleMetrics(575, 900, 1.5);

        expect(metrics.logicalWidth).toBeCloseTo(383.33, 2);
        expect(metrics.isNarrow).toBe(true);
    });
});

describe("Apple 平台识别", () => {
    test("识别桌面 macOS", () => {
        expect(isDesktopMac({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            platform: "MacIntel",
            maxTouchPoints: 0,
        })).toBe(true);
    });

    test("不会将桌面模式 iPadOS 识别为 macOS", () => {
        expect(isDesktopMac({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
            platform: "MacIntel",
            maxTouchPoints: 5,
        })).toBe(false);
    });
});

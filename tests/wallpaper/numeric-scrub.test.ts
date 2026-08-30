import { describe, expect, test } from "bun:test";
import {
    applyNumericScrubDelta,
    formatNumericValue,
    numericScrubMultiplier,
    numericStepsToBoundary,
    resolveNumericScrubWarp,
    resolveNumericScrubTier,
    stepNumericValue,
} from "../../app/components/wallpaper-editor/numeric-scrub";

describe("numeric scrub speed tiers", () => {
    test("uses five vertical speed tiers", () => {
        expect(resolveNumericScrubTier(0, -49)).toBe(0);
        expect(resolveNumericScrubTier(0, -50)).toBe(-1);
        expect(resolveNumericScrubTier(-1, -150)).toBe(-2);
        expect(resolveNumericScrubTier(0, 50)).toBe(1);
        expect(resolveNumericScrubTier(1, 150)).toBe(2);

        expect(numericScrubMultiplier(-2)).toBe(4);
        expect(numericScrubMultiplier(-1)).toBe(2);
        expect(numericScrubMultiplier(0)).toBe(1);
        expect(numericScrubMultiplier(1)).toBe(0.5);
        expect(numericScrubMultiplier(2)).toBe(0.25);
    });

    test("keeps the active tier inside the return hysteresis", () => {
        expect(resolveNumericScrubTier(-1, -47)).toBe(-1);
        expect(resolveNumericScrubTier(-1, -46)).toBe(0);
        expect(resolveNumericScrubTier(-2, -147)).toBe(-2);
        expect(resolveNumericScrubTier(-2, -146)).toBe(-1);
        expect(resolveNumericScrubTier(1, 47)).toBe(1);
        expect(resolveNumericScrubTier(1, 46)).toBe(0);
    });
});

describe("numeric scrub stepping", () => {
    test("accumulates horizontal movement until one ruler tick is crossed", () => {
        const first = applyNumericScrubDelta({
            value: 0,
            progress: 0,
            deltaX: 7,
            spacing: 8,
            step: 1,
        });
        expect(first).toEqual({ value: 0, progress: 0.875 });

        const second = applyNumericScrubDelta({
            value: first.value,
            progress: first.progress,
            deltaX: 1,
            spacing: 8,
            step: 1,
        });
        expect(second).toEqual({ value: 1, progress: 0 });
    });

    test("discards overshoot at a bound so reversal responds immediately", () => {
        const bounded = applyNumericScrubDelta({
            value: 9,
            progress: 0,
            deltaX: 24,
            spacing: 8,
            step: 1,
            min: 0,
            max: 10,
        });
        expect(bounded).toEqual({ value: 10, progress: 0 });

        const reversed = applyNumericScrubDelta({
            value: bounded.value,
            progress: bounded.progress,
            deltaX: -8,
            spacing: 8,
            step: 1,
            min: 0,
            max: 10,
        });
        expect(reversed).toEqual({ value: 9, progress: 0 });
    });

    test("keeps decimal steps stable", () => {
        expect(stepNumericValue(0.2, 1, 0.1)).toBe(0.3);
        expect(stepNumericValue(0.3, -2, 0.1)).toBe(0.1);
        expect(formatNumericValue(0.1 + 0.2)).toBe("0.3");
    });

    test("counts partial boundary steps for the ruler", () => {
        expect(numericStepsToBoundary(10, 9, 3, true)).toBe(1);
        expect(numericStepsToBoundary(0, 9, 3, false)).toBe(3);
        expect(numericStepsToBoundary(undefined, 9, 3, true)).toBeUndefined();
    });
});

describe("numeric scrub cursor wrapping", () => {
    test("waits for the cursor to reach the wrapped edge", () => {
        expect(resolveNumericScrubWarp(995, 16, 20)).toEqual({
            kind: "pending",
        });
    });

    test("corrects movement after the cursor reaches the wrapped edge", () => {
        expect(resolveNumericScrubWarp(20, 16, 40)).toEqual({
            kind: "synchronized",
            deltaX: 4,
        });
    });

    test("expires an unacknowledged warp instead of blocking later movement", () => {
        expect(resolveNumericScrubWarp(995, 16, 160)).toEqual({
            kind: "expired",
        });
    });
});

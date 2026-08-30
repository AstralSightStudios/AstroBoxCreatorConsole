export type NumericScrubTier = -2 | -1 | 0 | 1 | 2;

export const NUMERIC_SCRUB_METRICS = {
    baseSpacing: 8,
    innerBandBoundary: 50,
    outerBandBoundary: 150,
    bandHysteresis: 4,
    activationDistance: 4,
    edgeInset: 16,
    warpSyncTolerance: 8,
    warpTimeout: 160,
    nativeFallbackDelay: 24,
    nativePollInterval: 16,
} as const;

export type NumericScrubWarpResolution =
    | { kind: "pending" }
    | { kind: "expired" }
    | { kind: "synchronized"; deltaX: number };

export function resolveNumericScrubWarp(
    pointerX: number,
    targetX: number,
    elapsed: number,
): NumericScrubWarpResolution {
    if (
        Math.abs(pointerX - targetX) <=
        NUMERIC_SCRUB_METRICS.warpSyncTolerance
    ) {
        return {
            kind: "synchronized",
            deltaX: pointerX - targetX,
        };
    }
    if (elapsed >= NUMERIC_SCRUB_METRICS.warpTimeout) {
        return { kind: "expired" };
    }
    return { kind: "pending" };
}

export function normalizeNumericStep(step: number | undefined): number {
    return Number.isFinite(step) && (step as number) > 0 ? (step as number) : 1;
}

export function clampNumericValue(
    value: number,
    min?: number,
    max?: number,
): number {
    if (!Number.isFinite(value)) return 0;
    const lower = Number.isFinite(min) ? min : undefined;
    const upper = Number.isFinite(max) ? max : undefined;
    if (lower !== undefined && upper !== undefined && lower > upper) return value;
    if (lower !== undefined && value < lower) return lower;
    if (upper !== undefined && value > upper) return upper;
    return value;
}

export function formatNumericValue(value: number): string {
    if (!Number.isFinite(value)) return "";
    return String(Number.parseFloat(value.toPrecision(15)));
}

export function canStepNumericValue(
    value: number,
    direction: number,
    min?: number,
    max?: number,
): boolean {
    if (!Number.isFinite(value) || direction === 0) return false;
    if (direction > 0 && Number.isFinite(max) && value >= (max as number)) return false;
    if (direction < 0 && Number.isFinite(min) && value <= (min as number)) return false;
    return true;
}

export function stepNumericValue(
    value: number,
    steps: number,
    step: number,
    min?: number,
    max?: number,
): number {
    if (!Number.isFinite(value) || steps === 0) return value;
    const direction = Math.sign(steps);
    if (!canStepNumericValue(value, direction, min, max)) return value;
    const stepped = value + normalizeNumericStep(step) * steps;
    if (!Number.isFinite(stepped)) return value;
    const rounded = Number.parseFloat(stepped.toPrecision(15));
    return clampNumericValue(rounded, min, max);
}

export function resolveNumericScrubTier(
    currentTier: NumericScrubTier,
    verticalOffset: number,
): NumericScrubTier {
    let tier = currentTier;
    while (true) {
        const previousTier = tier;
        switch (tier) {
            case -2:
                if (
                    verticalOffset >=
                    -NUMERIC_SCRUB_METRICS.outerBandBoundary +
                        NUMERIC_SCRUB_METRICS.bandHysteresis
                ) {
                    tier = -1;
                }
                break;
            case -1:
                if (verticalOffset <= -NUMERIC_SCRUB_METRICS.outerBandBoundary) {
                    tier = -2;
                } else if (
                    verticalOffset >=
                    -NUMERIC_SCRUB_METRICS.innerBandBoundary +
                        NUMERIC_SCRUB_METRICS.bandHysteresis
                ) {
                    tier = 0;
                }
                break;
            case 0:
                if (verticalOffset <= -NUMERIC_SCRUB_METRICS.innerBandBoundary) {
                    tier = -1;
                } else if (verticalOffset >= NUMERIC_SCRUB_METRICS.innerBandBoundary) {
                    tier = 1;
                }
                break;
            case 1:
                if (
                    verticalOffset <=
                    NUMERIC_SCRUB_METRICS.innerBandBoundary -
                        NUMERIC_SCRUB_METRICS.bandHysteresis
                ) {
                    tier = 0;
                } else if (verticalOffset >= NUMERIC_SCRUB_METRICS.outerBandBoundary) {
                    tier = 2;
                }
                break;
            case 2:
                if (
                    verticalOffset <=
                    NUMERIC_SCRUB_METRICS.outerBandBoundary -
                        NUMERIC_SCRUB_METRICS.bandHysteresis
                ) {
                    tier = 1;
                }
                break;
        }
        if (tier === previousTier) return tier;
    }
}

export function numericScrubMultiplier(tier: NumericScrubTier): number {
    switch (tier) {
        case -2:
            return 4;
        case -1:
            return 2;
        case 1:
            return 0.5;
        case 2:
            return 0.25;
        default:
            return 1;
    }
}

export function applyNumericScrubDelta({
    value,
    progress,
    deltaX,
    spacing,
    step,
    min,
    max,
}: {
    value: number;
    progress: number;
    deltaX: number;
    spacing: number;
    step: number;
    min?: number;
    max?: number;
}): { value: number; progress: number } {
    if (deltaX === 0 || !Number.isFinite(spacing) || spacing <= 0) {
        return { value, progress };
    }
    const direction = Math.sign(deltaX);
    if (!canStepNumericValue(value, direction, min, max)) {
        return { value, progress: 0 };
    }

    const combined = progress + deltaX / spacing;
    const steps = Math.trunc(combined);
    if (steps === 0) return { value, progress: combined };

    const nextValue = stepNumericValue(value, steps, step, min, max);
    if (nextValue === value) return { value, progress: 0 };
    const nextProgress = canStepNumericValue(nextValue, Math.sign(steps), min, max)
        ? combined - steps
        : 0;
    return { value: nextValue, progress: nextProgress };
}

export function numericStepsToBoundary(
    boundary: number | undefined,
    value: number,
    step: number,
    increasing: boolean,
): number | undefined {
    if (!Number.isFinite(boundary) || !Number.isFinite(value)) return undefined;
    const normalizedStep = normalizeNumericStep(step);
    const distance = increasing
        ? (boundary as number) - value
        : value - (boundary as number);
    if (distance <= 0) return 0;
    const ratio = distance / normalizedStep;
    const nearest = Math.round(ratio);
    const tolerance = 1e-9 * Math.max(1, Math.abs(ratio));
    return Math.abs(ratio - nearest) <= tolerance ? nearest : Math.ceil(ratio);
}

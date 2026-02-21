export function hasCreatorPlusOrAbove(plan?: string) {
    const normalized = (plan || "").trim().toLowerCase();
    if (!normalized) return false;

    // New backend enum values.
    if (normalized === "creatorplus" || normalized === "creatorpro") {
        return true;
    }

    // Backward compatibility for legacy tag formats.
    if (normalized.includes("creatorplus") || normalized.includes("creatorpro")) {
        return true;
    }
    if (normalized.includes("plus")) {
        return true;
    }

    return false;
}

export function canAccessAnalysisByPlan(plan?: string) {
    return hasCreatorPlusOrAbove(plan);
}

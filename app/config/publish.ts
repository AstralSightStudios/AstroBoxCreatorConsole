export const PUBLISH_CONFIG = {
    manifestFileName: "manifest_v2.json",
    mediaDirectory: "media",
    downloadsDirectory: "downloads",
    defaultBranch: "main",
    repoNamePrefix: "astrobox-resource-",
    targetPrRepoOwner: "AstralSightStudios",
    targetPrRepoName: "ABRepo-TestEnv",
    catalogFilePath: "index_v2.csv",
    upstreamRepoOwner: "AstralSightStudios",
    upstreamRepoName: "ABRepo-TestEnv",
    defaultPrTitle: "[ABCC] Add new resource",
};

export function buildRepoName(slug: string) {
    const safe = slug
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/--+/g, "-");
    return `${PUBLISH_CONFIG.repoNamePrefix}${safe || "submission"}`;
}

import { loadRepoEnv } from "./repoEnv";

interface PublishConfig {
    manifestFileName: string;
    mediaDirectory: string;
    downloadsDirectory: string;
    trialDownloadsDirectory: string;
    defaultBranch: string;
    repoNamePrefix: string;
    targetPrRepoOwner: string;
    targetPrRepoName: string;
    catalogFilePath: string;
    submissionRootPath: string;
    submissionCsvFileName: string;
    submissionRequestFileName: string;
    upstreamRepoOwner: string;
    upstreamRepoName: string;
    defaultPrTitle: string;
}

const STATIC_CONFIG = {
    manifestFileName: "manifest_v2.json",
    mediaDirectory: "media",
    downloadsDirectory: "downloads",
    trialDownloadsDirectory: "downloads/trial",
    repoNamePrefix: "astrobox-resource-",
    catalogFilePath: "index_v2.csv",
    submissionRootPath: "tmp/submissions",
    submissionCsvFileName: "res.csv",
    submissionRequestFileName: "request.json",
    defaultPrTitle: "[ABCC] Add new resource",
} as const;

export const PUBLISH_CONFIG: PublishConfig = new Proxy(
    {} as PublishConfig,
    {
        get(_target, prop: keyof PublishConfig) {
            const env = loadRepoEnv();
            switch (prop) {
                case "manifestFileName":
                case "mediaDirectory":
                case "downloadsDirectory":
                case "trialDownloadsDirectory":
                case "repoNamePrefix":
                case "catalogFilePath":
                case "submissionRootPath":
                case "submissionCsvFileName":
                case "submissionRequestFileName":
                case "defaultPrTitle":
                    return STATIC_CONFIG[prop];
                case "defaultBranch":
                    return env.defaultBranch;
                case "targetPrRepoOwner":
                case "upstreamRepoOwner":
                    return env.owner;
                case "targetPrRepoName":
                case "upstreamRepoName":
                    return env.repoName;
                default:
                    return undefined;
            }
        },
        ownKeys() {
            return [
                "manifestFileName",
                "mediaDirectory",
                "downloadsDirectory",
                "trialDownloadsDirectory",
                "defaultBranch",
                "repoNamePrefix",
                "targetPrRepoOwner",
                "targetPrRepoName",
                "catalogFilePath",
                "submissionRootPath",
                "submissionCsvFileName",
                "submissionRequestFileName",
                "upstreamRepoOwner",
                "upstreamRepoName",
                "defaultPrTitle",
            ];
        },
        getOwnPropertyDescriptor() {
            return { enumerable: true, configurable: true };
        },
    },
);

export function buildRepoName(slug: string) {
    const safe = slug
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/--+/g, "-");
    return `${PUBLISH_CONFIG.repoNamePrefix}${safe || "submission"}`;
}

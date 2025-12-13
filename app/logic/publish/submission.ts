import { PUBLISH_CONFIG, buildRepoName } from "~/config/publish";
import {
    createPullRequest,
    createUserRepo,
    getRepoFile,
    uploadBinaryFile,
    uploadTextFile,
    type RepoInfo,
} from "./github-actions";
import type {
    AssetDescriptor,
    DownloadAssetDescriptor,
    ManifestBuildResult,
} from "./manifest";

interface UploadManifestRequest {
    manifest: ManifestBuildResult;
    itemId: string;
    itemName: string;
    description: string;
    token: string;
    repoNameOverride?: string;
    onProgress?: (message: string) => void;
}

export async function uploadManifestAndAssets({
    manifest,
    itemId,
    itemName,
    description,
    token,
    repoNameOverride,
    onProgress,
}: UploadManifestRequest): Promise<RepoInfo & { commitSha: string }> {
    const repoName =
        repoNameOverride || buildRepoName(itemId || itemName || "resource");
    onProgress?.(`创建仓库 ${repoName}`);
    const repo = await createUserRepo(repoName, description || itemName || repoName);
    const normalizedRepo: RepoInfo = {
        owner: repo.owner,
        name: repo.name,
        branch: repo.branch || PUBLISH_CONFIG.defaultBranch,
        htmlUrl: repo.htmlUrl,
    };

    const uploadBatch = async (assets: AssetDescriptor[], messagePrefix: string) => {
        let lastSha = "";
        for (const asset of assets) {
            if (asset.skipUpload) continue;
            onProgress?.(`上传文件 ${asset.path}`);
            const res = await uploadBinaryFile(
                normalizedRepo,
                asset.path,
                asset.file,
                `${messagePrefix} ${asset.path}`,
                token,
            );
            lastSha = res?.commit?.sha ?? lastSha;
        }
        return lastSha;
    };

    let lastCommitSha = await uploadBatch(manifest.previewAssets, "Add preview");

    if (manifest.iconAsset) {
        if (!manifest.iconAsset.skipUpload) {
            onProgress?.("上传图标");
            const res = await uploadBinaryFile(
                normalizedRepo,
                manifest.iconAsset.path,
                manifest.iconAsset.file,
                "Add icon",
                token,
            );
            lastCommitSha = res?.commit?.sha ?? lastCommitSha;
        }
    }

    if (manifest.coverAsset) {
        if (!manifest.coverAsset.skipUpload) {
            onProgress?.("上传封面");
            const res = await uploadBinaryFile(
                normalizedRepo,
                manifest.coverAsset.path,
                manifest.coverAsset.file,
                "Add cover",
                token,
            );
            lastCommitSha = res?.commit?.sha ?? lastCommitSha;
        }
    }

    const downloadAssets: DownloadAssetDescriptor[] = manifest.downloadAssets;
    for (const asset of downloadAssets) {
        if (asset.skipUpload) continue;
        onProgress?.(`上传包体 ${asset.platformId}`);
        const res = await uploadBinaryFile(
            normalizedRepo,
            asset.path,
            asset.file,
            `Add package for ${asset.platformId}`,
            token,
        );
        lastCommitSha = res?.commit?.sha ?? lastCommitSha;
    }

    onProgress?.("上传 manifest_v2.json");
    const manifestRes = await uploadTextFile(
        normalizedRepo,
        PUBLISH_CONFIG.manifestFileName,
        manifest.manifestJson,
        "Add manifest_v2.json",
        token,
    );
    lastCommitSha = manifestRes?.commit?.sha ?? lastCommitSha;

    return { ...normalizedRepo, commitSha: lastCommitSha };
}

function isNotFoundError(error: unknown) {
    return error instanceof Error && /404/.test(error.message);
}

async function getExistingFileSha({
    repo,
    path,
    token,
}: {
    repo: RepoInfo;
    path: string;
    token: string;
}) {
    try {
        const res = await getRepoFile({
            repo,
            path,
            tokenOverride: token,
            ref: repo.branch,
        });
        return res?.sha as string | undefined;
    } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
    }
}

export async function upsertManifestAndAssets({
    manifest,
    repo,
    token,
    onProgress,
}: {
    manifest: ManifestBuildResult;
    repo: RepoInfo;
    token: string;
    onProgress?: (message: string) => void;
}): Promise<RepoInfo & { commitSha: string }> {
    const targetRepo: RepoInfo = {
        ...repo,
        branch: repo.branch || PUBLISH_CONFIG.defaultBranch,
    };

    let lastCommitSha = "";

    const uploadAsset = async (asset: AssetDescriptor | DownloadAssetDescriptor, msg: string) => {
        if (!asset || asset.skipUpload) return;
        const sha = await getExistingFileSha({
            repo: targetRepo,
            path: asset.path,
            token,
        }).catch(() => undefined);
        onProgress?.(`上传文件 ${asset.path}`);
        const res = await uploadBinaryFile(
            targetRepo,
            asset.path,
            asset.file,
            msg,
            token,
            { sha },
        );
        lastCommitSha = res?.commit?.sha ?? lastCommitSha;
    };

    for (const asset of manifest.previewAssets) {
        await uploadAsset(asset, `Update ${asset.path}`);
    }

    if (manifest.iconAsset) {
        await uploadAsset(manifest.iconAsset, "Update icon");
    }

    if (manifest.coverAsset) {
        await uploadAsset(manifest.coverAsset, "Update cover");
    }

    for (const asset of manifest.downloadAssets) {
        await uploadAsset(asset, `Update package for ${asset.platformId}`);
    }

    const manifestSha = await getExistingFileSha({
        repo: targetRepo,
        path: PUBLISH_CONFIG.manifestFileName,
        token,
    }).catch(() => undefined);

    onProgress?.("更新 manifest_v2.json");
    const manifestRes = await uploadTextFile(
        targetRepo,
        PUBLISH_CONFIG.manifestFileName,
        manifest.manifestJson,
        "Update manifest_v2.json",
        token,
        { sha: manifestSha },
    );
    lastCommitSha = manifestRes?.commit?.sha ?? lastCommitSha;

    return { ...targetRepo, commitSha: lastCommitSha };
}

export async function submitPullRequest({
    repo,
    token,
    title,
    body,
}: {
    repo: RepoInfo;
    token: string;
    title: string;
    body?: string;
}) {
    return createPullRequest({
        token,
        baseOwner: PUBLISH_CONFIG.targetPrRepoOwner,
        baseRepo: PUBLISH_CONFIG.targetPrRepoName,
        baseBranch: PUBLISH_CONFIG.defaultBranch,
        headOwner: repo.owner,
        headRepo: repo.name,
        headBranch: repo.branch,
        title,
        body,
    });
}

export type { RepoInfo } from "./github-actions";

import { PUBLISH_CONFIG, buildRepoName } from "~/config/publish";
import { log } from "~/logic/logging";
import { maskValue } from "~/logic/logging/mask";
import {
  createBlob,
  createCommit,
  createPullRequest,
  createTree,
  createUserRepo,
  getBranchHead,
  isGithubStatus,
  updateRef,
  uploadFileToRepo,
  validateRepoName,
  type GitBlobRef,
  type RepoInfo,
  ensureBase64,
  ensureMainResourceBranch,
} from "./github-actions";
import { MAIN_RESOURCE_BRANCH, toMainResourceRepo } from "./branch";
import type {
  AssetDescriptor,
  DownloadAssetDescriptor,
  ManifestBuildResult,
} from "./manifest";
import { encryptFileWithAes256Ecb } from "./encryption";
import { submitResourceCryptoInfo } from "~/api/astrobox/resource";
import { replaceWatchfaceIdInFile } from "./watchface-id";

interface UploadManifestRequest {
  manifest: ManifestBuildResult;
  itemId: string;
  itemName: string;
  description: string;
  token: string;
  repoNameOverride?: string;
  onProgress?: (message: string) => void;
}

interface PreparedAsset {
  path: string;
  base64Content: string;
}

async function prepareFileAsset(
  asset: AssetDescriptor,
): Promise<PreparedAsset | null> {
  if (asset.skipUpload || !asset.file) return null;
  const buffer = await asset.file.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error(`文件 ${asset.path} 内容为空，拒绝上传空文件。`);
  }
  return { path: asset.path, base64Content: ensureBase64(buffer) };
}

async function prepareTextAsset(
  path: string,
  text: string,
): Promise<PreparedAsset> {
  return { path, base64Content: ensureBase64(text) };
}

async function applyWatchfaceId(
  assets: DownloadAssetDescriptor[],
  id: string,
  onProgress?: (message: string) => void,
) {
  const files = new Map<File, File>();
  for (const asset of assets) {
    if (asset.skipUpload) continue;
    let updated = files.get(asset.file);
    if (!updated) {
      onProgress?.(`写入表盘 ID ${id}：${asset.path}`);
      updated = await replaceWatchfaceIdInFile(asset.file, id);
      files.set(asset.file, updated);
    }
    asset.file = updated;
  }
}

async function encryptDownloadAssets(
  downloadAssets: DownloadAssetDescriptor[],
  onProgress?: (message: string) => void,
): Promise<Map<string, { hash: string; key: string }>> {
  const encryptionInfoMap = new Map<string, { hash: string; key: string }>();
  const encryptedByPath = new Map<
    string,
    {
      encryptedFile: File;
      hash: string;
      key: string;
      sizeBefore: number;
      sizeAfter: number;
      platformIds: string[];
    }
  >();

  for (const asset of downloadAssets) {
    if (asset.skipUpload || !asset.encryptOnUpload) continue;

    const packageKey = asset.path.trim();
    const cached = encryptedByPath.get(packageKey);
    if (cached) {
      asset.file = cached.encryptedFile;
      cached.platformIds.push(asset.platformId);
      encryptionInfoMap.set(asset.platformId, {
        hash: cached.hash,
        key: cached.key,
      });
      onProgress?.(
        `复用加密包体 ${asset.platformId}：${packageKey}，hash ${cached.hash.slice(0, 12)}…`,
      );
      continue;
    }

    onProgress?.(`加密包体 ${asset.platformId}（AES-256-ECB）`);
    const originalSize = asset.file.size;
    const encrypted = await encryptFileWithAes256Ecb(asset.file);
    if (!encrypted.encryptedFile || encrypted.encryptedFile.size === 0) {
      throw new Error(
        `设备 ${asset.platformId} 加密失败：输出文件为空。原始文件不会被上传。`,
      );
    }

    asset.file = encrypted.encryptedFile;
    encryptionInfoMap.set(asset.platformId, {
      hash: encrypted.encryptedHash,
      key: encrypted.keyBase64,
    });
    encryptedByPath.set(packageKey, {
      encryptedFile: encrypted.encryptedFile,
      hash: encrypted.encryptedHash,
      key: encrypted.keyBase64,
      sizeBefore: originalSize,
      sizeAfter: encrypted.encryptedFile.size,
      platformIds: [asset.platformId],
    });
    onProgress?.(
      `已加密 ${asset.platformId}：${originalSize} → ${encrypted.encryptedFile.size} 字节`,
    );
    // 密钥经脱敏后随事件落盘（前4后4），完整密钥只提交给服务端，绝不入日志。
    log.info("publish/encrypt", `包体加密完成 ${asset.platformId}`, {
      data: {
        platformId: asset.platformId,
        path: packageKey,
        sizeBefore: originalSize,
        sizeAfter: encrypted.encryptedFile.size,
        sha256: encrypted.encryptedHash,
        keyMasked: maskValue(encrypted.keyBase64),
      },
    });
  }

  return encryptionInfoMap;
}

function isEmptyRepoError(error: unknown): boolean {
  // Empty repo: GitHub returns 404 (branch not found) or 409 ("Git Repository is empty")
  return isGithubStatus(error, 404, 409);
}

/** Append `wallpaper/wallpaper.json` + its assets to the upload list. */
async function appendWallpaperAssets(
  allAssets: PreparedAsset[],
  manifest: ManifestBuildResult,
  onProgress?: (msg: string) => void,
) {
  if (!manifest.wallpaperConfigJson) return;
  allAssets.push(
    await prepareTextAsset(
      manifest.wallpaperConfigPath || "wallpaper/wallpaper.json",
      manifest.wallpaperConfigJson,
    ),
  );
  for (const asset of manifest.wallpaperAssets) {
    if (asset.skipUpload) continue;
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }
  onProgress?.(
    `壁纸配置与 ${manifest.wallpaperAssets.length} 个素材文件已加入上传队列`,
  );
}

/**
 * Resolve all assets to base64, handle encryption pre-processing,
 * then upload everything in a single Git Data API commit.
 */
async function batchUpload(
  repo: RepoInfo,
  allAssets: PreparedAsset[],
  message: string,
  token: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const validAssets = allAssets.filter(Boolean) as PreparedAsset[];
  if (validAssets.length === 0) return "";

  // 1. Get current branch head — MUST happen before blob creation
  //    because GitHub Git Data API requires at least one commit to exist.
  onProgress?.("获取仓库状态...");
  let parentCommitSha: string;
  let baseTreeSha: string;
  let isEmptyRepo = false;
  try {
    const head = await getBranchHead(repo, token);
    parentCommitSha = head.commitSha;
    baseTreeSha = head.treeSha;
  } catch (error) {
    if (!isEmptyRepoError(error)) {
      throw error;
    }
    isEmptyRepo = true;
    parentCommitSha = "";
    baseTreeSha = "";
  }

  // 2. Handle empty repo: use Contents API for the first file to initialize the repo,
  //    then Git Data API for the rest.
  if (isEmptyRepo) {
    onProgress?.("仓库为空，使用 Contents API 初始化...");
    const firstAsset = validAssets[0];
    const remainingAssets = validAssets.slice(1);

    // Upload first file via Contents API (creates initial commit automatically)
    await uploadFileToRepo({
      token,
      repo,
      path: firstAsset.path,
      content: firstAsset.base64Content,
      message: `初始化仓库：添加 ${firstAsset.path}`,
    });

    if (remainingAssets.length === 0) {
      return ""; // Only one file, done
    }

    // Now the repo has a commit — proceed with Git Data API for remaining files
    onProgress?.(
      `仓库已初始化，批量上传剩余 ${remainingAssets.length} 个文件...`,
    );
    const head = await getBranchHead(repo, token);
    parentCommitSha = head.commitSha;
    baseTreeSha = head.treeSha;

    // Fall through to the normal Git Data API flow below with remaining assets
    return await batchUploadGitData(
      repo,
      remainingAssets,
      message,
      token,
      parentCommitSha,
      baseTreeSha,
      onProgress,
    );
  }

  // 3. Non-empty repo: use Git Data API for all files
  onProgress?.(`批量上传 ${validAssets.length} 个文件 (Git Data API)...`);
  return await batchUploadGitData(
    repo,
    validAssets,
    message,
    token,
    parentCommitSha,
    baseTreeSha,
    onProgress,
  );
}

/**
 * Git Data API batch upload (blobs → tree → commit → update ref).
 * Requires a non-empty repo with at least one existing commit.
 */
async function batchUploadGitData(
  repo: RepoInfo,
  assets: PreparedAsset[],
  message: string,
  token: string,
  parentCommitSha: string,
  baseTreeSha: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  // 1. Create blobs with low concurrency. GitHub 明确要求写请求避免并发，
  //    高并发 POST /git/blobs 会触发二级速率限制（secondary rate limit）。
  onProgress?.(`创建 ${assets.length} 个文件的 blob...`);
  const BLOB_CONCURRENCY = 2;
  const blobRefs: GitBlobRef[] = new Array(assets.length);
  let nextIndex = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= assets.length) return;
      const sha = await createBlob(repo, assets[i].base64Content, token);
      blobRefs[i] = {
        sha,
        path: assets[i].path,
        mode: "100644",
        type: "blob",
      };
      completed++;
      onProgress?.(`已上传 blob ${completed}/${assets.length}（${assets[i].path}）`);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(BLOB_CONCURRENCY, assets.length) },
      () => worker(),
    ),
  );

  // 2. Create tree
  onProgress?.("创建 tree...");
  const treeSha = await createTree(repo, baseTreeSha, blobRefs, token);

  // 3. Create commit
  onProgress?.("创建 commit...");
  const commitSha = await createCommit(
    repo,
    message,
    treeSha,
    parentCommitSha,
    token,
  );

  // 4. Update ref
  onProgress?.("更新分支引用...");
  await updateRef(repo, commitSha, token);

  return commitSha;
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

  if (repoNameOverride) {
    const nameError = validateRepoName(repoNameOverride);
    if (nameError) {
      throw new Error(`自定义仓库名无效：${nameError}`);
    }
  }

  onProgress?.(`创建仓库 ${repoName}`);
  const repo = await createUserRepo(
    repoName,
    `AstroBox resource of ${itemName}`,
    token,
  );
  const normalizedRepo: RepoInfo = toMainResourceRepo({
    owner: repo.owner,
    name: repo.name,
    branch: repo.branch,
    htmlUrl: repo.htmlUrl,
  });
  await ensureMainResourceBranch(normalizedRepo, token);

  const parsedManifest = JSON.parse(manifest.manifestJson) as {
    item?: { id?: string; restype?: string };
  };
  const downloadAssets = manifest.downloadAssets.map((asset) => ({ ...asset }));
  const trialDownloadAssets = manifest.trialDownloadAssets.map((asset) => ({ ...asset }));
  if (parsedManifest.item?.restype === "watchface") {
    await applyWatchfaceId(downloadAssets, itemId.trim(), onProgress);
    await applyWatchfaceId(trialDownloadAssets, itemId.trim(), onProgress);
  }
  const encryptionInfoMap = await encryptDownloadAssets(downloadAssets, onProgress);

  // --- Prepare all assets as base64 ---
  onProgress?.("准备文件...");
  const allAssets: PreparedAsset[] = [];

  for (const asset of manifest.previewAssets) {
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  if (manifest.iconAsset && !manifest.iconAsset.skipUpload) {
    const prepared = await prepareFileAsset(manifest.iconAsset);
    if (prepared) allAssets.push(prepared);
  }

  if (manifest.coverAsset && !manifest.coverAsset.skipUpload) {
    const prepared = await prepareFileAsset(manifest.coverAsset);
    if (prepared) allAssets.push(prepared);
  }

  allAssets.push(
    await prepareTextAsset(
      PUBLISH_CONFIG.manifestFileName,
      manifest.manifestJson,
    ),
  );

  for (const asset of downloadAssets) {
    if (asset.skipUpload) continue;
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  for (const asset of trialDownloadAssets) {
    if (asset.skipUpload) continue;
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  await appendWallpaperAssets(allAssets, manifest, onProgress);

  // --- Single commit upload ---
  onProgress?.(`批量上传 ${allAssets.length} 个文件...`);
  const commitSha = await batchUpload(
    normalizedRepo,
    allAssets,
    `Publish ${itemName || itemId || "resource"}`,
    token,
    onProgress,
  );

  // --- Submit encryption keys (after commit exists) ---
  for (const [platformId, info] of encryptionInfoMap) {
    onProgress?.(`提交加密密钥 ${platformId}`);
    try {
      await submitResourceCryptoInfo({
        id: itemId,
        deviceId: platformId,
        hash: info.hash,
        key: info.key,
        repoOwner: normalizedRepo.owner,
        repoName: normalizedRepo.name,
        commitSha,
      });
      log.info("publish/crypto", `加密信息已提交服务端 ${platformId}`, {
        data: {
          platformId,
          sha256: info.hash,
          keyMasked: maskValue(info.key),
          commitSha,
        },
      });
    } catch (error) {
      log.error("publish/crypto", `加密信息提交失败 ${platformId}: ${String(error)}`, {
        data: { platformId, keyMasked: maskValue(info.key), commitSha },
      });
      throw error;
    }
  }

  return { ...normalizedRepo, commitSha };
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
  const parsedManifest = JSON.parse(manifest.manifestJson) as {
    item?: { id?: string; name?: string; restype?: string };
  };
  const itemId = parsedManifest.item?.id?.trim() || "";
  const itemName = parsedManifest.item?.name?.trim() || "";
  if (!itemId) {
    throw new Error("缺少资源 ID，无法保存加密文件密钥。");
  }
  const targetRepo: RepoInfo = toMainResourceRepo({
    ...repo,
    branch: repo.branch || MAIN_RESOURCE_BRANCH,
  });
  await ensureMainResourceBranch(targetRepo, token);

  const downloadAssets = manifest.downloadAssets.map((asset) => ({ ...asset }));
  const trialDownloadAssets = manifest.trialDownloadAssets.map((asset) => ({ ...asset }));
  if (parsedManifest.item?.restype === "watchface") {
    await applyWatchfaceId(downloadAssets, itemId, onProgress);
    await applyWatchfaceId(trialDownloadAssets, itemId, onProgress);
  }
  const encryptionInfoMap = await encryptDownloadAssets(downloadAssets, onProgress);

  // --- Prepare all assets ---
  onProgress?.("准备文件...");
  const allAssets: PreparedAsset[] = [];

  for (const asset of manifest.previewAssets) {
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  if (manifest.iconAsset && !manifest.iconAsset.skipUpload) {
    const prepared = await prepareFileAsset(manifest.iconAsset);
    if (prepared) allAssets.push(prepared);
  }

  if (manifest.coverAsset && !manifest.coverAsset.skipUpload) {
    const prepared = await prepareFileAsset(manifest.coverAsset);
    if (prepared) allAssets.push(prepared);
  }

  allAssets.push(
    await prepareTextAsset(
      PUBLISH_CONFIG.manifestFileName,
      manifest.manifestJson,
    ),
  );

  for (const asset of downloadAssets) {
    if (asset.skipUpload) continue;
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  for (const asset of trialDownloadAssets) {
    if (asset.skipUpload) continue;
    const prepared = await prepareFileAsset(asset);
    if (prepared) allAssets.push(prepared);
  }

  await appendWallpaperAssets(allAssets, manifest, onProgress);

  // --- Single commit upload ---
  onProgress?.(`批量更新 ${allAssets.length} 个文件...`);
  const commitSha = await batchUpload(
    targetRepo,
    allAssets,
    `Update ${itemName || itemId || "resource"}`,
    token,
    onProgress,
  );

  // --- Submit encryption keys ---
  for (const [platformId, info] of encryptionInfoMap) {
    onProgress?.(`提交加密密钥 ${platformId}`);
    try {
      await submitResourceCryptoInfo({
        id: itemId,
        deviceId: platformId,
        hash: info.hash,
        key: info.key,
        repoOwner: targetRepo.owner,
        repoName: targetRepo.name,
        commitSha,
      });
      log.info("publish/crypto", `加密信息已提交服务端 ${platformId}`, {
        data: {
          platformId,
          sha256: info.hash,
          keyMasked: maskValue(info.key),
          commitSha,
        },
      });
    } catch (error) {
      log.error("publish/crypto", `加密信息提交失败 ${platformId}: ${String(error)}`, {
        data: { platformId, keyMasked: maskValue(info.key), commitSha },
      });
      throw error;
    }
  }

  return { ...targetRepo, commitSha };
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

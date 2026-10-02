import { PUBLISH_CONFIG, buildRepoName } from "~/config/publish";
import { log } from "~/logic/logging";
import { maskValue } from "~/logic/logging/mask";
import { getRepoTopicsForResourceType } from "./resource-type";
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
  setRepoTopics,
  setRepoHomepage,
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
import { upsertExternalAuthorization } from "~/api/astrobox/order";
import {
  clearExternalAuthorizationDraft,
  listExternalAuthorizationDrafts,
} from "~/logic/publish/external-authorization-drafts";
import { replaceWatchfaceIdInPackage } from "./watchface-id";
import {
  readCrpackThemeId,
  rewriteCrpackCorona,
  validateCrpack,
} from "./crpack-validate";
import { readPackageVersion } from "./package-version";
import { toast } from "sonner";

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
  size: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function prepareFileAsset(
  asset: AssetDescriptor,
): Promise<PreparedAsset | null> {
  if (asset.skipUpload || !asset.file) return null;
  const buffer = await asset.file.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error(`文件 ${asset.path} 内容为空，拒绝上传空文件。`);
  }
  return {
    path: asset.path,
    base64Content: ensureBase64(buffer),
    size: buffer.byteLength,
  };
}

async function prepareTextAsset(
  path: string,
  text: string,
): Promise<PreparedAsset> {
  return {
    path,
    base64Content: ensureBase64(text),
    size: new TextEncoder().encode(text).byteLength,
  };
}

/**
 * 包内 ID 被改写时告知创作者。创作者可能误传了别人的包，改写一旦静默发生，
 * 包内原主就再也追不回来了。只提示、不阻断，写错包由创作者自己负责。
 */
function notifyIdRewrite(kind: "表盘" | "资源包", fileName: string, original: string | undefined, next: string) {
  if (original && original === next) return;
  const scope = fileName ? `（${fileName}）` : "";
  toast.warning(
    original
      ? `已将${scope}包内${kind} ID 从「${original}」改为「${next}」，请确认上传的是本资源对应的包体。`
      : `已写入${scope}包内${kind} ID「${next}」。`,
    { duration: 8000 },
  );
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
      const info = await readPackageVersion(asset.file);
      notifyIdRewrite("表盘", asset.path, info.identity, id);
      updated = await replaceWatchfaceIdInPackage(asset.file, id);
      files.set(asset.file, updated);
    }
    asset.file = updated;
  }
}

/**
 * 改写 CRPack 包内 `corona.json` 的 themeId。
 *
 * 顺序要点：先读原值并 toast，再按包内原 themeId 做结构校验（放行「格式合法但
 * 与资源 id 不同」的情况，这正是要改写的），改写后再按目标 id 复验——themeId 变长
 * 会推高每条 TSV 规则的开销，可能从「不超」变成「超」。
 */
async function applyResPackThemeId(
  assets: DownloadAssetDescriptor[],
  themeId: string,
  onProgress?: (message: string) => void,
) {
  const files = new Map<File, File>();
  for (const asset of assets) {
    if (asset.skipUpload) continue;
    let updated = files.get(asset.file);
    if (!updated) {
      onProgress?.(`写入资源包 themeId ${themeId}：${asset.path}`);
      const bytes = new Uint8Array(await asset.file.arrayBuffer());
      const original = readCrpackThemeId(bytes);
      notifyIdRewrite("资源包", asset.path, original, themeId);

      // 结构校验按包内原 themeId 判定，themeId 不一致不算错，那正是要改的。
      const gate = original && validateCrpack(bytes, original).length === 0 ? original : undefined;
      const structural = validateCrpack(bytes, gate);
      if (structural.length > 0) {
        throw new Error(`资源包 ${asset.path} 校验未通过：\n${structural.join("\n")}`);
      }

      const rewritten = rewriteCrpackCorona(bytes, { themeId });
      const after = validateCrpack(rewritten, themeId);
      if (after.length > 0) {
        throw new Error(
          `资源包 ${asset.path} 写入 themeId「${themeId}」后校验未通过：\n${after.join("\n")}`,
        );
      }

      updated = new File([rewritten as BlobPart], asset.file.name, {
        type: asset.file.type || "application/octet-stream",
        lastModified: asset.file.lastModified,
      });
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
      message: `init: initialize repository with ${firstAsset.path}`,
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
  const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  onProgress?.(
    `创建 ${assets.length} 个文件的 blob（共 ${formatBytes(totalBytes)}）...`,
  );
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
      onProgress?.(
        `已上传 blob ${completed}/${assets.length}（${assets[i].path}，${formatBytes(assets[i].size)}，${sha.slice(0, 7)}）`,
      );
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
  onProgress?.(
    `提交完成：${commitSha.slice(0, 7)}（${assets.length} 个文件，共 ${formatBytes(totalBytes)}）`,
  );

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

  // Parse manifest early to get resource type for topics
  const parsedManifest = JSON.parse(manifest.manifestJson) as {
    item?: { id?: string; restype?: string };
  };

  // Set repository topics based on resource type
  const resourceTopics = getRepoTopicsForResourceType(parsedManifest.item?.restype);
  try {
    await setRepoTopics(normalizedRepo, resourceTopics, token);
    log.info("publish/topics", `仓库 topics 已设置: ${resourceTopics.join(", ")}`, {
      data: { repo: `${normalizedRepo.owner}/${normalizedRepo.name}`, topics: resourceTopics, restype: parsedManifest.item?.restype },
    });
  } catch (error) {
    log.warn("publish/topics", `设置仓库 topics 失败（不阻塞流程）: ${String(error)}`, {
      data: { repo: `${normalizedRepo.owner}/${normalizedRepo.name}` },
    });
  }

  // Set repository homepage (Website URL in GitHub About section)
  const resourceId = parsedManifest.item?.id?.trim();
  if (resourceId) {
    const homepage = `https://abox.run/open?source=resv2&id=${encodeURIComponent(resourceId)}&provider=OfficialV2`;
    try {
      await setRepoHomepage(normalizedRepo, homepage, token);
      log.info("publish/homepage", `仓库 homepage 已设置: ${homepage}`, {
        data: { repo: `${normalizedRepo.owner}/${normalizedRepo.name}`, homepage },
      });
    } catch (error) {
      log.warn("publish/homepage", `设置仓库 homepage 失败（不阻塞流程）: ${String(error)}`, {
        data: { repo: `${normalizedRepo.owner}/${normalizedRepo.name}` },
      });
    }
  }

  const downloadAssets = manifest.downloadAssets.map((asset) => ({ ...asset }));
  const trialDownloadAssets = manifest.trialDownloadAssets.map((asset) => ({ ...asset }));
  if (parsedManifest.item?.restype === "watchface") {
    await applyWatchfaceId(downloadAssets, itemId.trim(), onProgress);
    await applyWatchfaceId(trialDownloadAssets, itemId.trim(), onProgress);
  }
  if (parsedManifest.item?.restype === "res_pack") {
    // 不做归一化：表单已校验过格式，这里必须原样使用，
    // 否则 CSV id 与包内 themeId 会悄悄分叉。
    const themeId = itemId.trim();
    // 必须早于 encryptDownloadAssets：商店侧 sha256 是从改写后的包体算的。
    await applyResPackThemeId(downloadAssets, themeId, onProgress);
    await applyResPackThemeId(trialDownloadAssets, themeId, onProgress);
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
    `publish: ${itemName || itemId || "resource"}`,
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

  await registerExternalAuthorizationDrafts(itemId, normalizedRepo, commitSha, onProgress);

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

  // Ensure repository topics are set based on resource type (idempotent - safe to call on update)
  const resourceTopics = getRepoTopicsForResourceType(parsedManifest.item?.restype);
  try {
    await setRepoTopics(targetRepo, resourceTopics, token);
    log.info("publish/topics", `仓库 topics 已确保: ${resourceTopics.join(", ")}`, {
      data: { repo: `${targetRepo.owner}/${targetRepo.name}`, topics: resourceTopics, restype: parsedManifest.item?.restype },
    });
  } catch (error) {
    log.warn("publish/topics", `设置仓库 topics 失败（不阻塞流程）: ${String(error)}`, {
      data: { repo: `${targetRepo.owner}/${targetRepo.name}` },
    });
  }

  // Ensure repository homepage is set (idempotent - safe to call on update)
  if (itemId) {
    const homepage = `https://abox.run/open?source=resv2&id=${encodeURIComponent(itemId)}&provider=OfficialV2`;
    try {
      await setRepoHomepage(targetRepo, homepage, token);
      log.info("publish/homepage", `仓库 homepage 已确保: ${homepage}`, {
        data: { repo: `${targetRepo.owner}/${targetRepo.name}`, homepage },
      });
    } catch (error) {
      log.warn("publish/homepage", `设置仓库 homepage 失败（不阻塞流程）: ${String(error)}`, {
        data: { repo: `${targetRepo.owner}/${targetRepo.name}` },
      });
    }
  }

  const downloadAssets = manifest.downloadAssets.map((asset) => ({ ...asset }));
  const trialDownloadAssets = manifest.trialDownloadAssets.map((asset) => ({ ...asset }));
  if (parsedManifest.item?.restype === "watchface") {
    await applyWatchfaceId(downloadAssets, itemId, onProgress);
    await applyWatchfaceId(trialDownloadAssets, itemId, onProgress);
  }
  if (parsedManifest.item?.restype === "res_pack") {
    // 不做归一化：表单已校验过格式，这里必须原样使用，
    // 否则 CSV id 与包内 themeId 会悄悄分叉。
    const themeId = itemId.trim();
    await applyResPackThemeId(downloadAssets, themeId, onProgress);
    await applyResPackThemeId(trialDownloadAssets, themeId, onProgress);
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
    `update: ${itemName || itemId || "resource"}`,
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

  await registerExternalAuthorizationDrafts(itemId, targetRepo, commitSha, onProgress);

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

// 未上架资源在编辑器里暂存的自有网站授权配置，需要 commit 存在后带所有权证明登记。
// 登记失败直接抛出，让发布流程明确展示失败，而不是让作者误以为保护已生效。
async function registerExternalAuthorizationDrafts(
  itemId: string,
  repo: { owner: string; name: string },
  commitSha: string,
  onProgress?: (message: string) => void,
) {
  for (const draft of listExternalAuthorizationDrafts(itemId)) {
    onProgress?.(`登记自有网站授权 ${draft.deviceId}`);
    try {
      await upsertExternalAuthorization({
        ...draft,
        repoOwner: repo.owner,
        repoName: repo.name,
        commitSha,
      });
      clearExternalAuthorizationDraft(draft.resourceId, draft.deviceId);
      log.info("publish/external-auth", `自有网站授权已登记 ${draft.deviceId}`, {
        data: { deviceId: draft.deviceId, commitSha },
      });
    } catch (error) {
      log.error(
        "publish/external-auth",
        `自有网站授权登记失败 ${draft.deviceId}: ${String(error)}`,
        { data: { deviceId: draft.deviceId, commitSha } },
      );
      throw new Error(
        `自有网站授权登记失败（${draft.deviceId}）：${(error as Error)?.message || String(error)}`,
      );
    }
  }
}

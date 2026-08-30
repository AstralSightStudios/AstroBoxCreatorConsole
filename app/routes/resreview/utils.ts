import { openUrl } from "@tauri-apps/plugin-opener";
import {
  approvePullRequest,
  compareCommits,
  createPullRequestComment,
  getCurrentGithubPermission,
  listReviewPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  listRepoFilesAtCommit,
  type GithubIssueComment,
  type GithubPullFile,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import { PUBLISH_CONFIG } from "~/config/publish";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import { getRepoFile } from "~/logic/publish/github-actions";
import {
  decodeCatalogContent,
  getFileContent,
  parseCatalogCsv,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { type PrResourcePreview, type ResourcePackagePreview, CATALOG_CSV_HEADER } from "./types";
import {
  extractSubmissionPathFromFilePath,
  parseSubmissionCsv,
  parseSubmissionRequestJson,
  submissionCsvPath,
  submissionRequestPath,
} from "~/logic/publish/submission-protocol";

export function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path);
}

export function isVideoPath(path: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(path);
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** 并发受限地执行异步任务，避免一次性打爆 GitHub API（限流/超时）。 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function makeNeedFixId() {
  return Math.random().toString(36).slice(2, 8);
}

export function formatTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function decodeBase64(content?: string) {
  if (!content) return "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}

function isCatalogFile(filename?: string) {
  if (!filename) return false;
  return (
    filename === PUBLISH_CONFIG.catalogFilePath ||
    filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
  );
}

function parseCatalogEntryRow(row: string) {
  return parseCatalogCsv(`${CATALOG_CSV_HEADER}\n${row}`)[0];
}

function extractCatalogEntriesFromPatch(patch?: string) {
  if (!patch) return [];

  const byId = new Map<string, CatalogEntry>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const row = line.slice(1).trim();
    if (!row || row === CATALOG_CSV_HEADER) continue;

    const parsed = parseCatalogEntryRow(row);
    if (parsed) byId.set(parsed.id, parsed);
  }

  return Array.from(byId.values());
}

function extractOldCatalogEntriesFromPatch(patch?: string) {
  if (!patch) return [];

  const byId = new Map<string, CatalogEntry>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const row = line.slice(1).trim();
    if (!row || row === CATALOG_CSV_HEADER) continue;
    const parsed = parseCatalogEntryRow(row);
    if (parsed) byId.set(parsed.id, parsed);
  }
  return Array.from(byId.values());
}

function extractOldCatalogEntriesFromFiles(files: GithubPullFile[]) {
  const byId = new Map<string, CatalogEntry>();
  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    for (const entry of extractOldCatalogEntriesFromPatch(file.patch)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}

function extractCatalogEntriesFromFiles(files: GithubPullFile[]) {
  const oldById = new Map<string, CatalogEntry>();
  const newById = new Map<string, CatalogEntry>();
  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    for (const entry of extractOldCatalogEntriesFromPatch(file.patch)) {
      oldById.set(entry.id, entry);
    }
    for (const entry of extractCatalogEntriesFromPatch(file.patch)) {
      newById.set(entry.id, entry);
    }
  }
  // 只预览真正「新增」或「内容有变化」的目录行；纯重排/移动且内容一致的行
  // 不再逐个拉取 manifest，避免整文件重写型 PR 触发上百次 GitHub 请求。
  const changed: CatalogEntry[] = [];
  for (const [id, entry] of newById) {
    const old = oldById.get(id);
    if (!old || canonicalEntryKey(old) !== canonicalEntryKey(entry)) {
      changed.push(entry);
    }
  }
  return changed;
}

function canonicalEntryKey(entry: CatalogEntry): string {
  return JSON.stringify([
    entry.id,
    entry.name,
    entry.restype,
    entry.repo_owner,
    entry.repo_name,
    entry.repo_commit_hash,
    entry.icon,
    entry.cover,
    entry.tags,
    entry.device_vendors,
    entry.devices,
    entry.paid_type,
  ]);
}

export function buildResourceRawUrl(entry: CatalogEntry, ref: string, path?: string) {
  const cleanPath = (path || "").trim();
  if (!cleanPath) return "";
  return buildRawFileUrl(entry.repo_owner, entry.repo_name, ref, cleanPath);
}

export function getManifestReferencedFiles(manifest?: ManifestV2): string[] {
  if (!manifest?.item) return [];
  const files = new Set<string>();
  files.add(PUBLISH_CONFIG.manifestFileName);
  if (manifest.item.icon) files.add(manifest.item.icon);
  if (manifest.item.cover) files.add(manifest.item.cover);
  for (const p of manifest.item.preview ?? []) {
    if (p) files.add(p);
  }
  for (const info of Object.values(manifest.downloads ?? {})) {
    const fileName = (info as { file_name?: string })?.file_name;
    if (fileName) files.add(fileName);
  }
  const trialDownloads = manifest.ext?.trialDownloads as
    | Record<string, { file_name?: string }>
    | undefined;
  for (const info of Object.values(trialDownloads ?? {})) {
    if (info.file_name) files.add(info.file_name);
  }
  return Array.from(files);
}

function collectPackages(
  entry: CatalogEntry,
  ref: string,
  manifest?: ManifestV2,
): ResourcePackagePreview[] {
  if (!manifest) return [];

  const packages: ResourcePackagePreview[] = [];
  Object.entries(manifest.downloads ?? {}).forEach(([deviceId, info]) => {
    const record = info as {
      file_name?: string;
      version?: string;
      versionCode?: unknown;
      updatelogs?: unknown;
    };
    const fileName = record.file_name || "";
    if (!fileName) return;
    packages.push({
      kind: "正式包",
      deviceId,
      version: record.version || "",
      fileName,
      url: buildResourceRawUrl(entry, ref, fileName),
      versionCode:
        typeof record.versionCode === "number" &&
        Number.isFinite(record.versionCode)
          ? Math.trunc(record.versionCode)
          : undefined,
      updateLogs: Array.isArray(record.updatelogs)
        ? record.updatelogs.filter(
            (log): log is { version: string; content: string } =>
              Boolean(log) && typeof log === "object",
          )
        : undefined,
    });
  });

  const trialDownloads = manifest.ext?.trialDownloads as
    | Record<
        string,
        {
          version?: string;
          file_name?: string;
          versionCode?: unknown;
          updatelogs?: unknown;
        }
      >
    | undefined;
  Object.entries(trialDownloads ?? {}).forEach(([deviceId, info]) => {
    const fileName = info.file_name || "";
    if (!fileName) return;
    packages.push({
      kind: "试用包",
      deviceId,
      version: info.version || "",
      fileName,
      url: buildResourceRawUrl(entry, ref, fileName),
      versionCode:
        typeof info.versionCode === "number" &&
        Number.isFinite(info.versionCode)
          ? Math.trunc(info.versionCode)
          : undefined,
      updateLogs: Array.isArray(info.updatelogs)
        ? info.updatelogs.filter(
            (log): log is { version: string; content: string } =>
              Boolean(log) && typeof log === "object",
          )
        : undefined,
    });
  });

  return packages;
}

async function fetchManifest(entry: CatalogEntry, token: string) {
  const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
  const file = await getRepoFile({
    repo: {
      owner: entry.repo_owner,
      name: entry.repo_name,
      branch: MAIN_RESOURCE_BRANCH,
    },
    path: PUBLISH_CONFIG.manifestFileName,
    tokenOverride: token,
    ref,
  });
  return JSON.parse(decodeBase64(file.content)) as ManifestV2;
}

export async function loadPrResourcePreviews(
  files: GithubPullFile[],
  token: string,
): Promise<PrResourcePreview[]> {
  const entries = extractCatalogEntriesFromFiles(files);
  const MAX_PREVIEWS = 40;
  return runWithConcurrency(
    entries.map((entry, index) => ({ entry, index })),
    6,
    async ({ entry, index }) => {
      const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
      if (index >= MAX_PREVIEWS) {
        return {
          entry,
          ref,
          manifestError: `变更条目过多，已跳过 manifest 拉取（共 ${entries.length} 项，仅处理前 ${MAX_PREVIEWS} 项）`,
          iconUrl: buildResourceRawUrl(entry, ref, entry.icon),
          coverUrl: buildResourceRawUrl(entry, ref, entry.cover),
          previewUrls: [],
          packages: [],
        } satisfies PrResourcePreview;
      }
      try {
        const manifest = await fetchManifest(entry, token);
        const iconPath = manifest.item?.icon || entry.icon;
        const coverPath = manifest.item?.cover || entry.cover;
        return {
          entry,
          ref,
          manifest,
          iconUrl: buildResourceRawUrl(entry, ref, iconPath),
          coverUrl: buildResourceRawUrl(entry, ref, coverPath),
          previewUrls: (manifest.item?.preview ?? [])
            .map((path: string) => buildResourceRawUrl(entry, ref, path))
            .filter(Boolean),
          packages: collectPackages(entry, ref, manifest),
        } satisfies PrResourcePreview;
      } catch (err) {
        return {
          entry,
          ref,
          manifestError: getErrorMessage(err),
          iconUrl: buildResourceRawUrl(entry, ref, entry.icon),
          coverUrl: buildResourceRawUrl(entry, ref, entry.cover),
          previewUrls: [],
          packages: [],
        } satisfies PrResourcePreview;
      }
    },
  );
}

export async function loadStagingPrResourcePreviews(
  files: GithubPullFile[],
  token: string,
  openPull: GithubPullRequest,
): Promise<PrResourcePreview[]> {
  const submissionPaths = Array.from(
    new Set(
      files
        .map((file) => extractSubmissionPathFromFilePath(file.filename))
        .filter((path): path is string => Boolean(path)),
    ),
  );
  if (submissionPaths.length === 0) return [];

  // 基准行取目标仓库默认分支上「最新」的 index_v2.csv：合入时 Action 应用的是
  // 当前目录，而非 PR 创建时刻的 base.sha；这样仅改标签等目录字段的提交也能
  // 与将要被替换的那一行做逐字段对比。
  let baseEntries: CatalogEntry[] = [];
  try {
    const baseFile = await getFileContent(
      token,
      PUBLISH_CONFIG.targetPrRepoOwner,
      PUBLISH_CONFIG.targetPrRepoName,
      PUBLISH_CONFIG.catalogFilePath,
      PUBLISH_CONFIG.defaultBranch,
    );
    baseEntries = parseCatalogCsv(decodeCatalogContent(baseFile.content));
  } catch {
    baseEntries = [];
  }

  const headOwner = openPull.head.repo?.owner?.login || "";
  const headRepo = openPull.head.repo?.name || "";
  const headRef = openPull.head.ref;

  return runWithConcurrency(
    submissionPaths,
    4,
    async (submissionPath) => {
      const csvFile = await getFileContent(
        token,
        headOwner,
        headRepo,
        submissionCsvPath(submissionPath),
        headRef,
      );
      const requestFile = await getFileContent(
        token,
        headOwner,
        headRepo,
        submissionRequestPath(submissionPath),
        headRef,
      );
      const entry = parseSubmissionCsv(decodeCatalogContent(csvFile.content));
      const request = parseSubmissionRequestJson(
        decodeCatalogContent(requestFile.content),
      );
      const baseEntry = request.original_id
        ? baseEntries.find((item) => item.id === request.original_id)
        : undefined;
      const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;

      try {
        const manifest = await fetchManifest(entry, token);
        const iconPath = manifest.item?.icon || entry.icon;
        const coverPath = manifest.item?.cover || entry.cover;
        return {
          entry,
          baseEntry,
          ref,
          request,
          predictedAction:
            request.mode === "create"
              ? "新增资源，将追加到目录末尾"
              : "更新资源，将由仓库 Action 根据包内容判断原位替换或移尾",
          manifest,
          iconUrl: buildResourceRawUrl(entry, ref, iconPath),
          coverUrl: buildResourceRawUrl(entry, ref, coverPath),
          previewUrls: (manifest.item?.preview ?? [])
            .map((path: string) => buildResourceRawUrl(entry, ref, path))
            .filter(Boolean),
          packages: collectPackages(entry, ref, manifest),
        } satisfies PrResourcePreview;
      } catch (err) {
        return {
          entry,
          baseEntry,
          ref,
          request,
          predictedAction:
            request.mode === "create"
              ? "新增资源，将追加到目录末尾"
              : "更新资源，将由仓库 Action 根据包内容判断原位替换或移尾",
          manifestError: getErrorMessage(err),
          iconUrl: buildResourceRawUrl(entry, ref, entry.icon),
          coverUrl: buildResourceRawUrl(entry, ref, entry.cover),
          previewUrls: [],
          packages: [],
        } satisfies PrResourcePreview;
      }
    },
  );
}

export async function openAllPackages(packages: ResourcePackagePreview[]) {
  for (const item of packages) {
    if (!item.url) continue;
    await openUrl(item.url);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

export {
  approvePullRequest,
  compareCommits,
  createPullRequestComment,
  getCurrentGithubPermission,
  listReviewPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  listRepoFilesAtCommit,
  type GithubIssueComment,
  type GithubPullFile,
  type GithubPullRequest,
};

export { extractOldCatalogEntriesFromFiles };

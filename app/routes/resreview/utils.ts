import { openUrl } from "@tauri-apps/plugin-opener";
import {
  approvePullRequest,
  createPullRequestComment,
  getCurrentGithubPermission,
  listOpenPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  type GithubIssueComment,
  type GithubPullFile,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import { PUBLISH_CONFIG } from "~/config/publish";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import { getRepoFile } from "~/logic/publish/github-actions";
import { parseCatalogCsv, type CatalogEntry } from "~/logic/publish/catalog";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { type PrResourcePreview, type ResourcePackagePreview, CATALOG_CSV_HEADER } from "./types";

export function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path);
}

export function isVideoPath(path: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(path);
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function extractCatalogEntriesFromFiles(files: GithubPullFile[]) {
  const byId = new Map<string, CatalogEntry>();
  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    for (const entry of extractCatalogEntriesFromPatch(file.patch)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}

export function buildResourceRawUrl(entry: CatalogEntry, ref: string, path?: string) {
  const cleanPath = (path || "").trim();
  if (!cleanPath) return "";
  return buildRawFileUrl(entry.repo_owner, entry.repo_name, ref, cleanPath);
}

function collectPackages(
  entry: CatalogEntry,
  ref: string,
  manifest?: ManifestV2,
): ResourcePackagePreview[] {
  if (!manifest) return [];

  const packages: ResourcePackagePreview[] = [];
  Object.entries(manifest.downloads ?? {}).forEach(([deviceId, info]) => {
    const record = info as { file_name?: string; version?: string };
    const fileName = record.file_name || "";
    if (!fileName) return;
    packages.push({
      kind: "正式包",
      deviceId,
      version: record.version || "",
      fileName,
      url: buildResourceRawUrl(entry, ref, fileName),
    });
  });

  const trialDownloads = manifest.ext?.trialDownloads as
    | Record<string, { version?: string; file_name?: string }>
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
  return Promise.all(
    entries.map(async (entry) => {
      const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
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
    }),
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
  createPullRequestComment,
  getCurrentGithubPermission,
  listOpenPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  type GithubIssueComment,
  type GithubPullFile,
  type GithubPullRequest,
};

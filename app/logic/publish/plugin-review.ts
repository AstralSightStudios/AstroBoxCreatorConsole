import { isGithubStatus } from "~/logic/publish/github-actions";
import { getFileContent } from "~/logic/publish/catalog";
import {
  buildPluginFolderRawUrl,
  normalizePluginRepoBase,
  normalizePluginFolderPath,
  parsePluginIndexText,
  parsePluginRepoBase,
  pluginRepoBranchUrl,
  pluginRepoLabel,
  pluginRepoWebUrl,
  validatePluginIndexLine,
  type ParsedPluginRepoBase,
  type PluginIndexIssue,
} from "./plugin-index";
import {
  validatePluginManifest,
  type PluginManifestValidationResult,
} from "./plugin-manifest";
import {
  ngPluginDisplayName,
  type NgPluginIndexEntry,
  type NgPluginManifest,
} from "./plugin-repo";

export interface PluginFileCheck {
  path: string;
  label: string;
  url: string;
  exists: boolean | null;
  size?: number;
  error?: string;
}

export interface PluginManifestPreview {
  key: string;
  folder: string;
  manifestUrl: string;
  manifest?: NgPluginManifest;
  /** 即使 manifest 其他字段非法，也保留 name 用于同名检查和标签展示。 */
  rawName?: string;
  manifestError?: string;
  iconUrl: string;
  entryUrl: string;
  issueList: PluginIndexIssue[];
  files: PluginFileCheck[];
}

export interface PluginIndexEntryGroup {
  key: string;
  line: string;
  parsed: ParsedPluginRepoBase | null;
  repoWebUrl: string;
  repoBranchUrl: string;
  lineIssues: PluginIndexIssue[];
  folders: string[];
  plugins: PluginManifestPreview[];
  loadError?: string;
}

export interface PluginIndexLoadResult {
  groups: PluginIndexEntryGroup[];
  publishedError?: string;
}

const MAX_FOLDERS_PER_REPO = 20;

function decodeBase64Text(content?: string): string {
  if (!content) return "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await run(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function readGithubTextFile(params: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}) {
  const data = await getFileContent(
    params.token,
    params.owner,
    params.repo,
    params.path,
    params.ref,
  );
  if (data?.type && data.type !== "file") {
    throw new Error(`${params.path} 不是文件。`);
  }
  return {
    text: decodeBase64Text(data?.content),
    sha: typeof data?.sha === "string" ? data.sha : undefined,
  };
}

async function inspectPluginFile(params: {
  token: string;
  parsed: ParsedPluginRepoBase;
  folder: string;
  path: string;
  label: string;
}): Promise<PluginFileCheck> {
  const { token, parsed, folder, path, label } = params;
  const fullPath = folder ? `${folder}/${path}` : path;
  const url = buildPluginFolderRawUrl(parsed.raw, folder, path);
  try {
    const data = await getFileContent(
      token,
      parsed.owner,
      parsed.repo,
      fullPath,
      parsed.ref,
    );
    if (data?.type !== "file") {
      return {
        path,
        label,
        url,
        exists: false,
        error: "目标不是文件。",
      };
    }
    const size = typeof data.size === "number" ? data.size : undefined;
    if (size === 0) {
      return { path, label, url, exists: false, size, error: "文件为空。" };
    }
    return { path, label, url, exists: true, size };
  } catch (error) {
    if (isGithubStatus(error, 404)) {
      return { path, label, url, exists: false, error: "文件不存在（HTTP 404）。" };
    }
    return {
      path,
      label,
      url,
      exists: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadManifestPreview(params: {
  token: string;
  group: PluginIndexEntryGroup;
  parsed: ParsedPluginRepoBase;
  folder: string;
}): Promise<PluginManifestPreview> {
  const { token, group, parsed, folder } = params;
  const manifestUrl = buildPluginFolderRawUrl(parsed.raw, folder, "manifest.json");
  const key = `${group.key}:${folder}`;
  const base: PluginManifestPreview = {
    key,
    folder,
    manifestUrl,
    iconUrl: "",
    entryUrl: "",
    issueList: [],
    files: [],
  };

  let validation: PluginManifestValidationResult;
  let rawName = "";
  try {
    const file = await readGithubTextFile({
      token,
      owner: parsed.owner,
      repo: parsed.repo,
      path: folder ? `${folder}/manifest.json` : "manifest.json",
      ref: parsed.ref,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      return {
        ...base,
        manifestError: "manifest.json 不是合法 JSON。",
        issueList: [{ level: "error", message: "manifest.json 不是合法 JSON。" }],
      };
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const value = (raw as { name?: unknown }).name;
      rawName = typeof value === "string" ? value.trim() : "";
    }
    validation = validatePluginManifest(raw);
  } catch (error) {
    const message = isGithubStatus(error, 404)
      ? "manifest.json 不存在（HTTP 404）。"
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      ...base,
      manifestError: message,
      issueList: [{ level: "error", message }],
    };
  }

  if (!validation.manifest) {
    return {
      ...base,
      rawName,
      manifestError: validation.issues.find((issue) => issue.level === "error")?.message,
      issueList: validation.issues,
    };
  }

  const manifest = validation.manifest;
  const files = await mapWithConcurrency(
    [
      { path: manifest.icon, label: "图标" },
      { path: manifest.entry, label: "入口 wasm" },
      ...(manifest.additional_files ?? []).map((path, index) => ({
        path,
        label: `附加文件 ${index + 1}`,
      })),
    ],
    4,
    (item) =>
      inspectPluginFile({
        token,
        parsed,
        folder,
        path: item.path,
        label: item.label,
      }),
  );

  const fileIssues: PluginIndexIssue[] = [];
  for (const file of files) {
    if (file.exists === false) {
      fileIssues.push({
        level: "error",
        message: `${file.label} ${file.path} 不存在或为空${file.error ? `：${file.error}` : ""}`,
      });
    } else if (file.exists === null) {
      fileIssues.push({
        level: "warn",
        message: `${file.label} ${file.path} 无法确认：${file.error || "未知错误"}`,
      });
    }
  }

  return {
    ...base,
    rawName,
    manifest,
    iconUrl: buildPluginFolderRawUrl(parsed.raw, folder, manifest.icon),
    entryUrl: buildPluginFolderRawUrl(parsed.raw, folder, manifest.entry),
    issueList: [...validation.issues, ...fileIssues],
    files,
  };
}

async function loadGroup(params: {
  token: string;
  line: string;
  index: number;
  lineIssues: PluginIndexIssue[];
}): Promise<PluginIndexEntryGroup> {
  const { token, line, index, lineIssues } = params;
  const parsed = parsePluginRepoBase(line);
  const group: PluginIndexEntryGroup = {
    key: `${index}:${normalizePluginRepoBase(line)}`,
    line,
    parsed,
    repoWebUrl: parsed ? pluginRepoWebUrl(parsed) : "",
    repoBranchUrl: parsed ? pluginRepoBranchUrl(parsed) : "",
    lineIssues,
    folders: [],
    plugins: [],
  };
  if (!parsed) return group;

  let indexText: string;
  try {
    indexText = (
      await readGithubTextFile({
        token,
        owner: parsed.owner,
        repo: parsed.repo,
        path: "index.txt",
        ref: parsed.ref,
      })
    ).text;
  } catch (error) {
    group.loadError = isGithubStatus(error, 404)
      ? `作者仓库缺少 index.txt（${pluginRepoLabel(parsed)}）。`
      : error instanceof Error
        ? error.message
        : String(error);
    return group;
  }

  const folders = parsePluginIndexText(indexText)
    .map(normalizePluginFolderPath)
    .filter(Boolean);
  if (folders.length === 0) {
    group.loadError = "作者仓库 index.txt 没有列出任何构建产物文件夹。";
    return group;
  }

  const acceptedFolders = folders.slice(0, MAX_FOLDERS_PER_REPO);
  if (folders.length > MAX_FOLDERS_PER_REPO) {
    group.lineIssues = [
      ...group.lineIssues,
      {
        level: "warn",
        message: `作者仓库 index.txt 列出了 ${folders.length} 个文件夹，仅检查前 ${MAX_FOLDERS_PER_REPO} 个。`,
      },
    ];
  }
  const folderIssues: PluginIndexIssue[] = [];
  const validFolders: string[] = [];
  for (const folder of acceptedFolders) {
    if (folder.split("/").some((part) => part === ".." || part === ".")) {
      folderIssues.push({
        level: "error",
        message: `作者仓库 index.txt 中的文件夹路径不安全：${folder}`,
      });
      continue;
    }
    validFolders.push(folder);
  }
  group.folders = validFolders;
  group.lineIssues = [...group.lineIssues, ...folderIssues];

  group.plugins = await mapWithConcurrency(validFolders, 3, (folder) =>
    loadManifestPreview({ token, group, parsed, folder }),
  );
  return group;
}

export function applyPluginNameChecks(
  groups: PluginIndexEntryGroup[],
  publishedPlugins: readonly NgPluginIndexEntry[],
): void {
  const publishedByName = new Map<string, NgPluginIndexEntry[]>();
  for (const entry of publishedPlugins) {
    const name = ngPluginDisplayName(entry).trim();
    if (!name) continue;
    const list = publishedByName.get(name) ?? [];
    list.push(entry);
    publishedByName.set(name, list);
  }
  const publishedByLower = new Map<string, string[]>();
  for (const name of publishedByName.keys()) {
    const key = name.toLowerCase();
    const list = publishedByLower.get(key) ?? [];
    list.push(name);
    publishedByLower.set(key, list);
  }

  const occurrences = new Map<string, Array<{ group: PluginIndexEntryGroup; plugin: PluginManifestPreview }>>();
  for (const group of groups) {
    for (const plugin of group.plugins) {
      const name = (plugin.manifest?.name || plugin.rawName || "").trim();
      if (!name) continue;
      const list = occurrences.get(name) ?? [];
      list.push({ group, plugin });
      occurrences.set(name, list);
    }
  }

  for (const [name, list] of occurrences) {
    for (const item of list) {
      const { group, plugin } = item;
      if (list.length > 1) {
        plugin.issueList = [
          ...plugin.issueList,
          {
            level: "error",
            message: `本次 PR 中有 ${list.length} 个插件使用了同一个名称「${name}」，插件名必须全局唯一。`,
          },
        ];
      }

      const published = publishedByName.get(name) ?? [];
      if (published.length > 0) {
        plugin.issueList = [
          ...plugin.issueList,
          {
            level: "error",
            message: `插件名「${name}」已被 ${published
              .map((entry) => entry.repo)
              .join("、")} 使用，插件名必须全局唯一。`,
          },
        ];
      } else {
        const lowerMatches = publishedByLower.get(name.toLowerCase()) ?? [];
        if (lowerMatches.length > 0) {
          plugin.issueList = [
            ...plugin.issueList,
            {
              level: "warn",
              message: `存在仅大小写不同的同名插件（${lowerMatches.join("、")}），容易造成捆绑关系歧义。`,
            },
          ];
        }
      }
    }
  }
}

/**
 * 解析一个 PR 中所有新增的 index.txt 行，并加载作者仓库 index.txt + manifest。
 * 返回顺序与 addedLines 一致。
 */
export async function loadPluginIndexEntries(params: {
  addedLines: readonly string[];
  token: string;
  existingLines: readonly string[];
  publishedPlugins: readonly NgPluginIndexEntry[];
}): Promise<PluginIndexLoadResult> {
  const { addedLines, token, existingLines, publishedPlugins } = params;
  const seen = new Set<string>();
  const issueList = addedLines.map((line) => {
    const issues = validatePluginIndexLine(line, {
      existingLines,
      seenLines: seen,
    });
    const normalized = normalizePluginRepoBase(line);
    if (normalized) seen.add(normalized);
    return issues;
  });
  const groups = await mapWithConcurrency(addedLines, 3, async (line, index) =>
    loadGroup({ token, line, index, lineIssues: issueList[index] }),
  );
  applyPluginNameChecks(groups, publishedPlugins);
  return { groups };
}

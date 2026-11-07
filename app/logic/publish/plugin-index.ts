import {
  parseRawGithubUrl,
  RAW_GITHUB_ORIGIN,
} from "~/logic/github-raw";

/** GitHub owner / repo 允许的字符集。 */
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export type PluginIndexIssueLevel = "error" | "warn";

export interface PluginIndexIssue {
  level: PluginIndexIssueLevel;
  message: string;
}

export interface ParsedPluginRepoBase {
  /** 归一化后的 raw 基地址，保证以 `/` 结尾。 */
  raw: string;
  owner: string;
  repo: string;
  ref: string;
  branch: string;
  /** refs/heads 或 refs/tags。 */
  refKind: "heads" | "tags";
  /** 原始输入是否为 github.com 短格式。 */
  shortForm: boolean;
}

/**
 * 与插件仓库 Action 的 normalizeRawRepoBase 保持一致：
 * - raw 地址去尾部斜杠后补一个 `/`；
 * - github.com 短格式补成 raw + refs/heads/main（Action 写死 main）；
 * - 其他字符串只补尾部 `/`。
 */
export function normalizePluginRepoBase(input: string): string {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(`${RAW_GITHUB_ORIGIN}/`)) {
    return `${trimmed.replace(/\/+$/, "")}/`;
  }
  if (trimmed.startsWith("https://github.com/")) {
    return `${trimmed
      .replace(/\/+$/, "")
      .replace("https://github.com/", `${RAW_GITHUB_ORIGIN}/`)}/refs/heads/main/`;
  }
  return `${trimmed.replace(/\/+$/, "")}/`;
}

export function parsePluginRepoBase(
  input: string,
): ParsedPluginRepoBase | null {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("https://github.com/")) {
    const parts = trimmed
      .replace(/\/+$/, "")
      .replace("https://github.com/", "")
      .split("/");
    if (parts.length !== 2 || !GITHUB_NAME_PATTERN.test(parts[0]) || !GITHUB_NAME_PATTERN.test(parts[1])) {
      return null;
    }
    return {
      raw: normalizePluginRepoBase(trimmed),
      owner: parts[0],
      repo: parts[1],
      ref: "refs/heads/main",
      branch: "main",
      refKind: "heads",
      shortForm: true,
    };
  }

  if (!trimmed.startsWith(`${RAW_GITHUB_ORIGIN}/`)) return null;
  const raw = normalizePluginRepoBase(trimmed);
  const parsed = parseRawGithubUrl(`${raw}index.txt`);
  if (!parsed || parsed.path !== "index.txt") return null;
  if (!GITHUB_NAME_PATTERN.test(parsed.owner) || !GITHUB_NAME_PATTERN.test(parsed.repo)) {
    return null;
  }
  const match = parsed.ref.match(/^refs\/(heads|tags)\/(.+)$/);
  if (!match) return null;
  return {
    raw,
    owner: parsed.owner,
    repo: parsed.repo,
    ref: parsed.ref,
    branch: match[2],
    refKind: match[1] as "heads" | "tags",
    shortForm: false,
  };
}

export function parsePluginIndexText(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/g)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export interface PluginIndexLineValidationOptions {
  /** 当前上游 index.txt 里已有的行（未归一化也可以）。 */
  existingLines?: readonly string[];
  /** 本次 PR 中在它之前已经出现过的行。 */
  seenLines?: ReadonlySet<string>;
}

/**
 * 校验一条准备追加到插件仓库 index.txt 的地址。
 * 注意：这里只做“写进去是否合法”的判断，不代表能直接合入（同名等检查另行处理）。
 */
export function validatePluginIndexLine(
  line: string,
  options: PluginIndexLineValidationOptions = {},
): PluginIndexIssue[] {
  const issues: PluginIndexIssue[] = [];
  const raw = String(line ?? "");
  const trimmed = raw.trim();

  if (!trimmed) {
    return [{ level: "error", message: "新增行为空。" }];
  }
  if (CONTROL_PATTERN.test(trimmed)) {
    issues.push({ level: "error", message: "新增行包含控制字符或不可见字符。" });
  }
  if (raw !== trimmed) {
    issues.push({ level: "warn", message: "新增行首尾存在空白字符。" });
  }
  if (/\s/.test(trimmed)) {
    issues.push({ level: "error", message: "新增行中间不能包含空白字符。" });
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    issues.push({ level: "error", message: "新增行必须是 http(s) 地址。" });
  }
  if (/manifest\.json/i.test(trimmed)) {
    issues.push({
      level: "error",
      message: "不能填写 manifest.json 的完整地址，请只保留到分支根目录并以 / 结尾。",
    });
  }

  const existing = new Set(
    (options.existingLines ?? [])
      .map((item) => normalizePluginRepoBase(item))
      .filter(Boolean),
  );
  const seen = options.seenLines ?? new Set<string>();
  const normalized = normalizePluginRepoBase(trimmed);
  if (normalized && existing.has(normalized)) {
    issues.push({ level: "error", message: "该地址已存在于上游 index.txt 中。" });
  }
  if (normalized && seen.has(normalized)) {
    issues.push({ level: "error", message: "本次 PR 内重复添加了同一个地址。" });
  }

  if (trimmed.startsWith("https://github.com/")) {
    const parsed = parsePluginRepoBase(trimmed);
    if (!parsed) {
      issues.push({
        level: "error",
        message: "github.com 短格式必须且只能是 https://github.com/<owner>/<repo>。",
      });
    } else {
      issues.push({
        level: "warn",
        message: "github.com 短格式会被 Action 固定按 main 分支解析，建议改用完整 raw 地址。",
      });
    }
    return issues;
  }

  if (!trimmed.startsWith(`${RAW_GITHUB_ORIGIN}/`)) {
    issues.push({
      level: "error",
      message: `地址必须位于 ${RAW_GITHUB_ORIGIN} 下。`,
    });
    return issues;
  }

  const parsed = parsePluginRepoBase(trimmed);
  if (!parsed) {
    issues.push({
      level: "error",
      message: "无法解析作者仓库地址，请使用 https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/。",
    });
    return issues;
  }

  if (!trimmed.endsWith("/")) {
    issues.push({ level: "warn", message: "地址末尾建议保留 /。" });
  }
  if (parsed.refKind !== "heads") {
    issues.push({
      level: "warn",
      message: "当前使用 refs/tags 引用，插件更新不会跟随分支变化，通常应使用 refs/heads/<branch>/。",
    });
  }
  if (!parsed.branch.trim() || parsed.branch.includes("/")) {
    issues.push({
      level: "error",
      message: "分支名不能为空，也不能包含 /（否则会和后续文件路径混淆）。",
    });
  }

  return issues;
}

export interface PluginIndexPatchAnalysis {
  addedLines: string[];
  removedLines: string[];
}

/** 从 index.txt 的 patch 中提取所有新增 / 删除行。 */
export function extractPluginIndexPatch(
  patch: string | undefined,
): PluginIndexPatchAnalysis {
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  if (!patch) return { addedLines, removedLines };
  for (const line of patch.split(/\r?\n/g)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removedLines.push(line.slice(1));
    }
  }
  return { addedLines, removedLines };
}

export interface PluginIndexMergeResult {
  content: string;
  appended: string[];
  duplicates: string[];
}

/**
 * 把一个“纯追加”的 PR 解析到最新 index.txt 上。
 * 保留 base 的原始内容与换行风格，只追加 base 中尚不存在的行。
 */
export function resolvePluginIndexConflict(
  baseText: string,
  addedLines: readonly string[],
): PluginIndexMergeResult {
  const base = String(baseText ?? "");
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const existing = new Set(parsePluginIndexText(base).map(normalizePluginRepoBase));
  const seen = new Set<string>();
  const appended: string[] = [];
  const duplicates: string[] = [];

  for (const raw of addedLines) {
    const line = String(raw ?? "").trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = normalizePluginRepoBase(line);
    if (!normalized) continue;
    if (existing.has(normalized)) {
      duplicates.push(line);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(line);
      continue;
    }
    seen.add(normalized);
    appended.push(line);
  }

  if (appended.length === 0) {
    return { content: base, appended, duplicates };
  }

  let content = base;
  if (!content) {
    content = `${appended.join(eol)}${eol}`;
  } else {
    if (!content.endsWith("\n")) content += eol;
    content += `${appended.join(eol)}${eol}`;
  }
  return { content, appended, duplicates };
}

export function normalizePluginFolderPath(folder: string): string {
  return String(folder || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function isSafePluginFolderPath(folder: string): boolean {
  const normalized = normalizePluginFolderPath(folder);
  if (!normalized) return false;
  if (normalized.split("/").some((part) => part === ".." || part === ".")) {
    return false;
  }
  return true;
}

export function buildPluginFolderRawUrl(
  base: string,
  folder: string,
  file: string,
): string {
  const normalizedBase = normalizePluginRepoBase(base);
  const normalizedFolder = normalizePluginFolderPath(folder);
  const normalizedFile = String(file || "").replace(/^\/+/, "");
  if (!normalizedFolder) return `${normalizedBase}${normalizedFile}`;
  return `${normalizedBase}${normalizedFolder}/${normalizedFile}`;
}

export function pluginRepoWebUrl(parsed: ParsedPluginRepoBase): string {
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

export function pluginRepoBranchUrl(parsed: ParsedPluginRepoBase): string {
  return `https://github.com/${parsed.owner}/${parsed.repo}/tree/${encodeURIComponent(parsed.branch)}`;
}

export function pluginRepoLabel(parsed: ParsedPluginRepoBase): string {
  return `${parsed.owner}/${parsed.repo}`;
}

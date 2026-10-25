import { loadRepoEnv } from "~/config/repoEnv";

export type AuditLookupInput =
  | {
      kind: "pr";
      number: number;
      source: "url" | "number";
    }
  | {
      kind: "resource";
      resourceId: string;
    };

function parsePositiveInteger(value: string, label: string) {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label}必须是正整数。`);
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label}必须是正整数。`);
  }
  return number;
}

function tryParseGithubUrl(input: string): URL | null {
  if (/^https?:\/\//i.test(input)) {
    try {
      return new URL(input);
    } catch {
      throw new Error("PR 链接格式不正确。");
    }
  }
  if (/^(?:www\.)?github\.com\//i.test(input)) {
    try {
      return new URL(`https://${input}`);
    } catch {
      throw new Error("PR 链接格式不正确。");
    }
  }
  return null;
}

function parsePrUrl(input: string): AuditLookupInput {
  const url = tryParseGithubUrl(input);
  if (!url) {
    throw new Error("无法识别 PR 链接。");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new Error("仅支持 GitHub PR 链接。");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const pullIndex = segments.findIndex(
    (segment) => segment === "pull" || segment === "pulls",
  );
  if (pullIndex !== 2 || pullIndex + 1 >= segments.length) {
    throw new Error("链接不是 GitHub PR 地址。");
  }

  const owner = segments[pullIndex - 2];
  const repo = segments[pullIndex - 1];
  const env = loadRepoEnv();
  if (
    owner.toLowerCase() !== env.owner.toLowerCase() ||
    repo.toLowerCase() !== env.repoName.toLowerCase()
  ) {
    throw new Error(`仅支持 ${env.owner}/${env.repoName} 的 PR。`);
  }

  return {
    kind: "pr",
    number: parsePositiveInteger(segments[pullIndex + 1], "PR 序号"),
    source: "url",
  };
}

/**
 * 解析提交回查输入。界面引导使用 `#123` 表示 PR 序号、`id:123` 表示资源 ID；
 * 纯数字仍兼容按 PR 处理。其他非空输入按资源 ID 处理，便于直接粘贴目录中的 ID。
 */
export function parseAuditLookupInput(raw: string): AuditLookupInput {
  const input = raw.trim();
  if (!input) {
    throw new Error("请输入 PR 链接、#序号或 id:资源 ID。");
  }

  const lower = input.toLowerCase();
  if (lower.startsWith("id:")) {
    const resourceId = input.slice(3).trim();
    if (!resourceId) throw new Error("资源 ID 不能为空。");
    return { kind: "resource", resourceId };
  }
  if (lower.startsWith("pr:")) {
    return {
      kind: "pr",
      number: parsePositiveInteger(input.slice(3), "PR 序号"),
      source: "number",
    };
  }

  const prLabelMatch = input.match(/^pr\s*#?\s*(\d+)$/i);
  if (prLabelMatch) {
    return {
      kind: "pr",
      number: parsePositiveInteger(prLabelMatch[1], "PR 序号"),
      source: "number",
    };
  }

  if (/^#?\d+$/.test(input)) {
    return {
      kind: "pr",
      number: parsePositiveInteger(input.replace(/^#/, ""), "PR 序号"),
      source: "number",
    };
  }

  if (
    /^https?:\/\//i.test(input) ||
    /^(?:www\.)?github\.com\//i.test(input)
  ) {
    return parsePrUrl(input);
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw new Error("只能输入 GitHub PR 链接或资源 ID。");
  }

  return { kind: "resource", resourceId: input };
}

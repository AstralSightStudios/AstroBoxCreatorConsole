/**
 * AI 审核草稿：把一次提交整理成服务端 `/admin/review/ai/runs` 要的请求，以及把模型给出的
 * 每个问题排成一条可以直接发出去的评论。
 *
 * 模型在服务端调用（审核标准与官方封面示例图由服务端当系统提示词带上），这里只负责准备
 * 「这次提交长什么样」：资源信息、自动检查结论、PR 里已有的审核往来，以及缩小后的素材图片。
 */
import {
  composeReviewReply,
  resolveGuidelineRefs,
  type GuidelineIndex,
} from "./guidelines";

export interface ReviewAiModel {
  id: string;
  label: string;
  vendor: string;
}

export type ReviewAiSeverity = "must_fix" | "suggestion";
export type ReviewAiVerdict = "approve" | "needs_changes" | "reject";

export interface ReviewAiIssue {
  title: string;
  severity: ReviewAiSeverity;
  /** 问题针对的对象：cover / icon / preview / name / description / … */
  target: string;
  /** 引用的准则（引用键） */
  rules: string[];
  /** 发给创作者的评论正文 */
  comment: string;
}

export interface ReviewAiResult {
  verdict: ReviewAiVerdict;
  /** 给审核员看的总评，不发给创作者 */
  summary: string;
  issues: ReviewAiIssue[];
  /** 模型给出但文档里不存在、被服务端丢掉的引用 */
  droppedRules: string[];
}

export interface ReviewAiRun {
  id: string;
  status: "pending" | "done" | "failed";
  reviewerId: string;
  prNumber: number;
  resourceId: string;
  revision: string;
  model: string;
  instruction: string;
  imageCount: number;
  docsRevision: string;
  result: ReviewAiResult | null;
  error: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    cost: number | null;
  };
  createdAt: string;
  finishedAt: string | null;
}

export type ReviewAiImageRole = "icon" | "cover" | "preview";

export interface ReviewAiImage {
  role: ReviewAiImageRole;
  mime: "image/jpeg" | "image/png" | "image/webp";
  /** base64，不带 data: 前缀 */
  data: string;
  /** 原图的真实规格：模型看到的是缩小后的副本 */
  note?: string;
}

/** 与服务端 `AdminReviewModel.aiGenerateBody` 一致。 */
export interface ReviewAiRequest {
  model: string;
  pr: { number: number; title: string; author?: string; mode?: "create" | "edit" | "delete" };
  resource: {
    id: string;
    name: string;
    restype: string;
    description: string;
    tags: string[];
    paidType: string;
    authors: Array<{ name: string; bindABAccount: boolean }>;
    links: Array<{ title: string; url: string; icon: string }>;
    devices: string[];
    downloads: Array<{
      device: string;
      kind: string;
      version: string;
      versionCode?: number;
      fileName: string;
      updateLog?: string;
    }>;
    ext?: string;
    repo?: string;
    revision?: string;
  };
  previous?: {
    id: string;
    name: string;
    restype: string;
    tags: string[];
    paidType: string;
    devices: string[];
  };
  checks?: Array<{ title: string; status: "pass" | "fail" | "warn" | "manual"; detail: string }>;
  images: ReviewAiImage[];
  thread?: Array<{ author: string; role: "reviewer" | "creator" | "other"; at?: string; body: string }>;
  instruction?: string;
}

// 下面这些结构只列出用得到的字段，审核页的 PrResourcePreview / RuleCheckItem /
// GithubIssueComment 在结构上都满足，逻辑层不必反过来依赖路由里的类型。

interface CatalogRowLike {
  id: string;
  name: string;
  restype: string;
  repo_owner: string;
  repo_name: string;
  repo_commit_hash: string;
  tags: string;
  devices: string;
  paid_type: string;
}

export interface ReviewAiResourceSource {
  entry: CatalogRowLike;
  baseEntry?: CatalogRowLike;
  ref?: string;
  request?: { mode: "create" | "edit" | "delete" };
  manifest?: {
    item: {
      description?: string;
      author?: Array<{ name: string; bindABAccount?: boolean }>;
    };
    links?: Array<{ title?: string; url?: string; icon?: string }>;
    ext?: Record<string, unknown>;
  };
  packages: Array<{
    kind: string;
    deviceId: string;
    version: string;
    fileName: string;
    versionCode?: number;
    updateLogs?: Array<{ version: string; content: string }>;
  }>;
}

export interface ReviewAiCheckSource {
  title: string;
  status: "pass" | "fail" | "warn" | "manual";
  detail: string;
}

export interface ReviewAiCommentSource {
  body?: string;
  created_at?: string;
  user?: { login: string };
}

// 与服务端的字段上限保持一致，超出的部分在这里截断，避免整个请求被 422 拒掉。
const LIMITS = {
  title: 300,
  name: 200,
  description: 8000,
  tag: 64,
  tags: 60,
  link: 20,
  devices: 80,
  downloads: 80,
  updateLog: 2000,
  ext: 6000,
  checks: 80,
  checkDetail: 1200,
  thread: 40,
  comment: 2000,
  instruction: 1000,
} as const;

const clip = (value: unknown, max: number) =>
  (typeof value === "string" ? value : "").slice(0, max);

function splitList(raw: string | undefined, maxItems: number, maxLength: number): string[] {
  return (raw ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

// ext 里对判断没有帮助、体积又可能很大的键
const EXT_OMITTED_KEYS = new Set(["trialDownloads", "wallpaperGenerator"]);

function serializeExt(ext: Record<string, unknown> | undefined): string | undefined {
  if (!ext) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ext)) {
    if (!EXT_OMITTED_KEYS.has(key)) kept[key] = value;
  }
  if (Object.keys(kept).length === 0) return undefined;
  const text = JSON.stringify(kept);
  // 截断的 JSON 没法解析，宁可不带
  return text.length <= LIMITS.ext ? text : undefined;
}

/**
 * 自动检查结论：没通过的（失败 / 警告 / 需人工确认）全部带上，通过的只报个数。
 * 模型要知道的是哪里有问题，逐条列出几十个「通过」只会稀释注意力。
 */
export function summarizeChecks(
  checks: readonly ReviewAiCheckSource[] | undefined,
): ReviewAiRequest["checks"] {
  if (!checks?.length) return undefined;
  const flagged = checks.filter((check) => check.status !== "pass");
  const passed = checks.length - flagged.length;
  const items = flagged.slice(0, LIMITS.checks - 1).map((check) => ({
    title: clip(check.title, 200),
    status: check.status,
    detail: clip(check.detail, LIMITS.checkDetail),
  }));
  if (passed > 0) {
    items.push({
      title: "其余自动检查",
      status: "pass" as const,
      detail: `另有 ${passed} 项自动检查通过。`,
    });
  }
  return items;
}

/**
 * PR 里已有的往来。只保留最近的若干条；ABCC 标签原样留着——模型据此知道哪些问题提过、
 * 哪些创作者已经标了修复。
 */
export function summarizeThread(
  comments: readonly ReviewAiCommentSource[] | undefined,
  options: { prAuthor?: string; reviewers?: ReadonlySet<string> },
): ReviewAiRequest["thread"] {
  if (!comments?.length) return undefined;
  const prAuthor = options.prAuthor?.trim().toLowerCase();
  const ordered = [...comments]
    .filter((comment) => comment.body?.trim())
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const thread = ordered.slice(-LIMITS.thread).map((comment) => {
    const login = comment.user?.login ?? "";
    const role: "reviewer" | "creator" | "other" =
      prAuthor && login.toLowerCase() === prAuthor
        ? "creator"
        : options.reviewers?.has(login)
          ? "reviewer"
          : "other";
    return {
      author: clip(login, 64),
      role,
      ...(comment.created_at ? { at: clip(comment.created_at, 40) } : {}),
      body: clip(comment.body!.trim(), LIMITS.comment),
    };
  });
  return thread.length > 0 ? thread : undefined;
}

export function buildReviewAiRequest(options: {
  model: string;
  pull: { number: number; title: string; user?: { login: string } };
  resource: ReviewAiResourceSource;
  checks?: readonly ReviewAiCheckSource[];
  comments?: readonly ReviewAiCommentSource[];
  reviewers?: ReadonlySet<string>;
  images: ReviewAiImage[];
  instruction?: string;
}): ReviewAiRequest {
  const { resource, pull } = options;
  const { entry, baseEntry, manifest } = resource;
  const instruction = options.instruction?.trim();
  const ext = serializeExt(manifest?.ext);
  // 目录行里的 commit 可能是空白（提交还在分支上），这时用 PR 分支名顶上
  const revision = entry.repo_commit_hash.trim() || resource.ref?.trim() || "";

  return {
    model: options.model,
    pr: {
      number: pull.number,
      title: clip(pull.title, LIMITS.title),
      ...(pull.user?.login ? { author: clip(pull.user.login, 64) } : {}),
      ...(resource.request?.mode ? { mode: resource.request.mode } : {}),
    },
    resource: {
      id: clip(entry.id, 128),
      name: clip(entry.name, LIMITS.name),
      restype: clip(entry.restype, 32),
      description: clip(manifest?.item.description, LIMITS.description),
      tags: splitList(entry.tags, LIMITS.tags, LIMITS.tag),
      paidType: clip(entry.paid_type, 32),
      authors: (manifest?.item.author ?? []).slice(0, 20).map((author) => ({
        name: clip(author.name, 100),
        bindABAccount: author.bindABAccount === true,
      })),
      links: (manifest?.links ?? []).slice(0, LIMITS.link).map((link) => ({
        title: clip(link.title, 200),
        url: clip(link.url, 500),
        icon: clip(link.icon, 200),
      })),
      devices: splitList(entry.devices, LIMITS.devices, 64),
      downloads: resource.packages.slice(0, LIMITS.downloads).map((item) => {
        const updateLog = (item.updateLogs ?? [])
          .map((log) => `${log.version}: ${log.content}`.trim())
          .join("\n")
          .slice(0, LIMITS.updateLog);
        return {
          device: clip(item.deviceId, 64),
          kind: clip(item.kind, 16),
          version: clip(item.version, 64),
          ...(typeof item.versionCode === "number" && Number.isFinite(item.versionCode)
            ? { versionCode: item.versionCode }
            : {}),
          fileName: clip(item.fileName, 300),
          ...(updateLog ? { updateLog } : {}),
        };
      }),
      ...(ext ? { ext } : {}),
      repo: clip(`${entry.repo_owner}/${entry.repo_name}`, 200),
      ...(revision ? { revision: clip(revision, 64) } : {}),
    },
    ...(baseEntry
      ? {
          previous: {
            id: clip(baseEntry.id, 128),
            name: clip(baseEntry.name, LIMITS.name),
            restype: clip(baseEntry.restype, 32),
            tags: splitList(baseEntry.tags, LIMITS.tags, LIMITS.tag),
            paidType: clip(baseEntry.paid_type, 32),
            devices: splitList(baseEntry.devices, LIMITS.devices, 64),
          },
        }
      : {}),
    ...(() => {
      const checks = summarizeChecks(options.checks);
      return checks ? { checks } : {};
    })(),
    images: options.images,
    ...(() => {
      const thread = summarizeThread(options.comments, {
        prAuthor: pull.user?.login,
        reviewers: options.reviewers,
      });
      return thread ? { thread } : {};
    })(),
    ...(instruction ? { instruction: instruction.slice(0, LIMITS.instruction) } : {}),
  };
}

export const REVIEW_AI_TARGET_LABELS: Record<string, string> = {
  cover: "封面",
  icon: "图标",
  preview: "预览图",
  name: "名称",
  description: "简介",
  tags: "标签",
  package: "包体",
  links: "外链",
  author: "作者",
  paid: "付费",
  devices: "设备",
  nsfw: "敏感内容",
  other: "其他",
};

export const REVIEW_AI_VERDICT_LABELS: Record<ReviewAiVerdict, string> = {
  approve: "建议通过",
  needs_changes: "建议要求修改",
  reject: "建议拒绝",
};

/**
 * 把一个问题排成评论：引用的准则在前（必须修改的写「不符合」，建议项写「请参考」），
 * 模型写的说明在后。建议项末尾注明非强制，与审核员平时的写法一致。
 */
export function composeAiIssueReply(
  issue: ReviewAiIssue,
  index: GuidelineIndex,
): { text: string; missing: string[] } {
  const { entries, missing } = resolveGuidelineRefs(index, issue.rules);
  const comment = issue.comment.trim();
  const body =
    issue.severity === "suggestion" && !/非强制/.test(comment)
      ? `${comment}\n\n非强制。`
      : comment;
  return {
    text: composeReviewReply({
      entries,
      mode: issue.severity === "suggestion" ? "reference" : "violation",
      body,
    }),
    missing,
  };
}

const REVIEW_AI_ERROR_TEXT: Record<string, string> = {
  ai_not_configured: "服务端没有配置可用的 OpenRouter key，AI 草稿暂不可用。",
  ai_model_not_allowed: "这个模型不在可选范围内。",
  ai_images_too_large: "图片总体积超过上限，请减少预览图数量后重试。",
  ai_busy: "已有生成任务在进行，请等它完成后再试。",
  ai_rate_limited: "操作太频繁，请稍后再试。",
  ai_daily_limit: "今天的生成次数已用完。",
  ai_timeout: "模型响应超时，请重试或换一个模型。",
  ai_upstream_error: "模型服务出错，请重试或换一个模型。",
  ai_upstream_unreachable: "服务端连不上模型服务，请稍后重试。",
  ai_upstream_rate_limited: "模型服务限流，请稍后重试或换一个模型。",
  ai_insufficient_credits: "OpenRouter 余额不足。",
  ai_key_rejected: "OpenRouter 拒绝了服务端的 key，请联系管理员检查配置。",
  ai_invalid_output: "模型没有按要求的格式输出，请重试或换一个模型。",
  ai_empty_output: "模型没有返回内容，请重试。",
  ai_guidelines_unavailable: "服务端暂时读不到审核准则，请稍后重试。",
  ai_interrupted: "生成被中断（服务端重启），请重新生成。",
  ai_internal_error: "服务端生成失败，请重试。",
  run_not_found: "这次生成的记录已不存在。",
};

/** 服务端的错误码译成给审核员看的话；不认识的原样带上，方便反馈。 */
export function describeReviewAiError(code: string | null | undefined): string {
  if (!code) return "生成失败，请重试。";
  return REVIEW_AI_ERROR_TEXT[code] ?? `生成失败（${code}）。`;
}

/** 一次生成的花费，给审核员一个量级上的概念。 */
export function formatReviewAiUsage(usage: ReviewAiRun["usage"]): string {
  const parts = [`输入 ${usage.promptTokens.toLocaleString("en-US")} tok`];
  if (usage.cachedTokens > 0) {
    parts.push(`其中缓存 ${usage.cachedTokens.toLocaleString("en-US")}`);
  }
  parts.push(`输出 ${usage.completionTokens.toLocaleString("en-US")} tok`);
  if (typeof usage.cost === "number") {
    parts.push(`$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(3)}`);
  }
  return parts.join(" · ");
}

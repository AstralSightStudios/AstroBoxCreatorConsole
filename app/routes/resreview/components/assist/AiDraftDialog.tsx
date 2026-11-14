import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  Spinner,
  TextArea,
} from "~/components/ScaleAwareThemes";
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { GithubIssueComment, GithubPullFile, GithubPullRequest } from "~/api/github/pr-review";
import { reviewAiRunsQueryKey, ReviewAssistApi } from "~/api/astrobox/review";
import { useAccountState } from "~/logic/account/store";
import { getGithubReadToken } from "~/logic/account/github-tokens";
import {
  buildReviewAiRequest,
  composeAiIssueReply,
  describeReviewAiError,
  formatReviewAiUsage,
  REVIEW_AI_TARGET_LABELS,
  REVIEW_AI_VERDICT_LABELS,
  type ReviewAiIssue,
  type ReviewAiRun,
  type ReviewAiVerdict,
} from "~/logic/review-assist/ai";
import {
  prepareReviewAiImages,
  REVIEW_AI_MAX_PREVIEWS,
  type ReviewAiImageSource,
} from "~/logic/review-assist/ai-images";
import { guidelineLabel, resolveGuidelineRefs } from "~/logic/review-assist/guidelines";
import {
  buildRuleCheckCacheKey,
  findRuleCheckResult,
  writeRuleCheckCache,
} from "../../rule-check-cache";
import { runResourceRuleChecks, type ResourceRuleCheckResult } from "../../rule-checks";
import type { PrResourcePreview } from "../../types";
import { renderCommentMarkdownHtml } from "../../utils/comment";
import {
  describeReviewAssistError,
  useReviewAiModels,
  useReviewGuidelines,
} from "./useReviewAssist";

const MODEL_STORAGE_KEY = "ABCC_REVIEW_AI_MODEL";
const POLL_INTERVAL_MS = 2500;
// 服务端 6 分钟没结果会把任务判为中断，这里多等一点再放弃
const POLL_TIMEOUT_MS = 7 * 60_000;

const VERDICT_STYLE: Record<ReviewAiVerdict, string> = {
  approve: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
  needs_changes: "border-amber-400/30 bg-amber-500/15 text-amber-100",
  reject: "border-red-400/40 bg-red-500/20 text-red-100",
};

function readStoredModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    // 存不下来只是下次不记得选了哪个模型
  }
}

/** 审核往来里谁是审核员：发过 NEEDFIX / CLOSE / REFUSE 标签的人（只有组织成员发的才会留在时间线里）。 */
function reviewersOf(comments: readonly GithubIssueComment[], self?: string): Set<string> {
  const reviewers = new Set<string>();
  if (self) reviewers.add(self);
  for (const comment of comments) {
    if (comment.user?.login && /^\s*\[ABCC_(?:NEEDFIX|CLOSE|REFUSE)/i.test(comment.body ?? "")) {
      reviewers.add(comment.user.login);
    }
  }
  return reviewers;
}

function imageSourcesOf(
  resource: PrResourcePreview,
  checks: ResourceRuleCheckResult | undefined,
): ReviewAiImageSource[] {
  const metaOf = (label: string) => checks?.imageSizes.find((item) => item.label === label);
  const sources: ReviewAiImageSource[] = [];
  if (resource.coverUrl) {
    sources.push({ role: "cover", url: resource.coverUrl, meta: metaOf("cover") ?? { label: "cover" } });
  }
  if (resource.iconUrl) {
    sources.push({ role: "icon", url: resource.iconUrl, meta: metaOf("icon") ?? { label: "icon" } });
  }
  resource.previewUrls.forEach((url, index) => {
    const label = `preview ${index + 1}`;
    sources.push({ role: "preview", url, meta: metaOf(label) ?? { label } });
  });
  return sources;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working"; message: string; startedAt: number }
  | { kind: "failed"; message: string };

export interface AiDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pull: GithubPullRequest;
  resources: PrResourcePreview[];
  prFiles: GithubPullFile[];
  comments: GithubIssueComment[];
  focusResourceId?: string | null;
  /** 采用一条草稿：填进评论编辑器，由审核员修改后自己发送 */
  onUse: (text: string, options: { needFix: boolean }) => void;
}

/**
 * AI 审核草稿。把这次提交的资源信息、自动检查结论、素材图片和已有的审核往来交给模型，
 * 得到一组「一个问题一条」的评论草稿。草稿不会自动发出去：逐条采用后进入评论编辑器，
 * 审核员看过、改过再发。
 */
export function AiDraftDialog({
  open,
  onOpenChange,
  pull,
  resources,
  prFiles,
  comments,
  focusResourceId,
  onUse,
}: AiDraftDialogProps) {
  const accountState = useAccountState();
  const queryClient = useQueryClient();
  const models = useReviewAiModels(open);
  const guidelines = useReviewGuidelines(open);

  const [resourceId, setResourceId] = useState<string>("");
  const [model, setModel] = useState<string>(readStoredModel);
  const [instruction, setInstruction] = useState("");
  const [includeChecks, setIncludeChecks] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [run, setRun] = useState<ReviewAiRun | null>(null);
  const [skippedImages, setSkippedImages] = useState<Array<{ label: string; reason: string }>>([]);
  const [usedIssues, setUsedIssues] = useState<Record<string, number[]>>({});
  const [elapsed, setElapsed] = useState(0);
  // 每次发起生成换一个令牌，关闭弹窗或重新生成后旧的轮询自动作废
  const jobRef = useRef(0);

  const resource = useMemo(
    () =>
      resources.find((item) => item.entry.id === resourceId) ??
      resources.find((item) => item.entry.id === focusResourceId) ??
      resources[0],
    [resources, resourceId, focusResourceId],
  );
  const activeResourceId = resource?.entry.id ?? "";

  const availableModels = models.data?.models ?? [];
  const selectedModel =
    availableModels.find((item) => item.id === model)?.id ?? availableModels[0]?.id ?? "";

  // 同一个 PR、同一个资源别人刚生成过的草稿：直接看，不必再花一次钱
  const history = useQuery({
    queryKey: reviewAiRunsQueryKey(pull.number, activeResourceId),
    queryFn: async () => (await ReviewAssistApi.ai.runs(pull.number, activeResourceId)).items,
    enabled: open && Boolean(activeResourceId) && models.signedIn,
    staleTime: 30_000,
    retry: false,
  });
  const revision = (resource?.entry.repo_commit_hash || resource?.ref || "").trim();

  // 换了 PR 或资源：之前的草稿不再对应当前内容
  useEffect(() => {
    jobRef.current += 1;
    setRun(null);
    setPhase({ kind: "idle" });
    setSkippedImages([]);
  }, [pull.number, activeResourceId]);

  // 打开时如果自己还没生成过，先展示这次提交已有的最新草稿
  useEffect(() => {
    if (!open || run || phase.kind !== "idle") return;
    const latest = history.data?.find(
      (item) => item.status === "done" && item.result && item.revision === revision,
    );
    if (latest) setRun(latest);
  }, [open, run, phase.kind, history.data, revision]);

  useEffect(() => {
    if (phase.kind !== "working") return;
    setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000));
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      jobRef.current += 1;
    },
    [],
  );

  const cachedChecks = useMemo(
    () => (resource ? findRuleCheckResult(resource, prFiles) : undefined),
    // open 也是依赖：弹窗每次打开都重新看一眼，自动检查可能刚在另一个标签页里跑完
    [resource, prFiles, open],
  );

  const generate = useCallback(async () => {
    if (!resource || !selectedModel) return;
    const job = ++jobRef.current;
    const alive = () => jobRef.current === job;
    const startedAt = Date.now();
    const step = (message: string) => {
      if (alive()) setPhase({ kind: "working", message, startedAt });
    };
    storeModel(selectedModel);
    setRun(null);
    setSkippedImages([]);

    try {
      let checks = includeChecks ? findRuleCheckResult(resource, prFiles) : undefined;
      if (includeChecks && !checks) {
        const token = getGithubReadToken() || "";
        if (token) {
          step("正在运行自动检查（需要下载并核对包体）…");
          try {
            const astroboxToken = accountState.astrobox?.token;
            checks = await runResourceRuleChecks({
              preview: resource,
              prFiles,
              token,
              astroboxToken,
            });
            // 写回缓存，「自动检查」标签页打开时直接复用
            writeRuleCheckCache(
              buildRuleCheckCacheKey(resource, prFiles, token, astroboxToken),
              checks,
            );
          } catch {
            // 自动检查失败不妨碍生成，只是模型少一份参考
            checks = undefined;
          }
        }
      }
      if (!alive()) return;

      step("正在准备图片…");
      const prepared = await prepareReviewAiImages(imageSourcesOf(resource, checks));
      if (!alive()) return;
      setSkippedImages(prepared.skipped);

      step("正在提交给模型…");
      const { runId } = await ReviewAssistApi.ai.start(
        buildReviewAiRequest({
          model: selectedModel,
          pull,
          resource,
          checks: checks?.checks,
          comments,
          reviewers: reviewersOf(comments, accountState.github?.username),
          images: prepared.images,
          instruction,
        }),
      );

      step("模型正在审阅，通常需要半分钟到两分钟…");
      while (alive()) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!alive()) return;
        const current = await ReviewAssistApi.ai.run(runId);
        if (!alive()) return;
        if (current.status === "done" && current.result) {
          setRun(current);
          setPhase({ kind: "idle" });
          void queryClient.invalidateQueries({
            queryKey: reviewAiRunsQueryKey(pull.number, resource.entry.id),
          });
          return;
        }
        if (current.status === "failed") {
          setPhase({ kind: "failed", message: describeReviewAiError(current.error) });
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setPhase({ kind: "failed", message: "等待超时，请稍后在「最近的草稿」里查看或重新生成。" });
          return;
        }
      }
    } catch (error) {
      if (!alive()) return;
      const code =
        (error as { data?: { error?: unknown } })?.data?.error;
      setPhase({
        kind: "failed",
        message:
          typeof code === "string" && code.startsWith("ai_")
            ? describeReviewAiError(code)
            : describeReviewAssistError(error),
      });
    }
  }, [
    resource,
    selectedModel,
    includeChecks,
    prFiles,
    accountState.astrobox?.token,
    accountState.github?.username,
    pull,
    comments,
    instruction,
    queryClient,
  ]);

  const cancel = () => {
    jobRef.current += 1;
    setPhase({ kind: "idle" });
  };

  const working = phase.kind === "working";
  const used = run ? (usedIssues[run.id] ?? []) : [];
  const modelLabel = (id: string) => availableModels.find((item) => item.id === id)?.label ?? id;
  const otherRuns = (history.data ?? []).filter(
    (item) => item.status === "done" && item.result && item.id !== run?.id,
  );
  const previewCount = resource?.previewUrls.length ?? 0;

  const adoptIssue = (issue: ReviewAiIssue, issueIndex: number) => {
    if (!run) return;
    const { text } = composeAiIssueReply(issue, guidelines.index);
    onUse(text, { needFix: issue.severity === "must_fix" });
    setUsedIssues((previous) => ({
      ...previous,
      [run.id]: [...new Set([...(previous[run.id] ?? []), issueIndex])],
    }));
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="flex max-h-[min(90vh,820px)] w-[calc(100vw-2rem)] max-w-[820px] flex-col">
        <Dialog.Title>
          <span className="inline-flex items-center gap-2">
            <Sparkle size={18} weight="duotone" />
            AI 审核草稿
          </span>
        </Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          模型对照审核准则与官方封面示例，检查资源信息、自动检查结果和图片素材。草稿不会自动发送，逐条采用后可以修改再发。
        </Dialog.Description>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {!models.signedIn ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              请先登录 AstroBox 账号。
            </p>
          ) : models.error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            >
              <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{describeReviewAssistError(models.error)}</span>
            </p>
          ) : models.data && !models.data.available ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {describeReviewAiError("ai_not_configured")}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {resources.length > 1 && (
              <label className="flex flex-col gap-1 text-xs text-white/60 sm:col-span-2">
                审核哪个资源
                <Select.Root
                  value={activeResourceId}
                  onValueChange={setResourceId}
                  disabled={working}
                >
                  <Select.Trigger radius="large" />
                  <Select.Content position="popper">
                    {resources.map((item) => (
                      <Select.Item key={item.entry.id} value={item.entry.id}>
                        {item.entry.name || item.entry.id}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-white/60">
              模型
              <Select.Root
                value={selectedModel || undefined}
                onValueChange={setModel}
                disabled={working || availableModels.length === 0}
              >
                <Select.Trigger radius="large" placeholder="正在读取可用模型…" />
                <Select.Content position="popper">
                  {availableModels.map((item) => (
                    <Select.Item key={item.id} value={item.id}>
                      {item.label}
                      <span className="ml-2 text-white/40">{item.vendor}</span>
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
            <div className="flex flex-col gap-1 text-xs text-white/60">
              随提交一起发给模型
              <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-white/70">
                <span>资源信息</span>
                <span>
                  封面{resource?.coverUrl ? "" : "（无）"} · 图标{resource?.iconUrl ? "" : "（无）"} ·{" "}
                  {Math.min(previewCount, REVIEW_AI_MAX_PREVIEWS)} 张预览图
                </span>
                <span>{Math.min(comments.length, 40)} 条审核往来</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-sky-400"
                    checked={includeChecks}
                    disabled={working}
                    onChange={(event) => setIncludeChecks(event.target.checked)}
                  />
                  自动检查结果{includeChecks && !cachedChecks ? "（生成前先运行）" : ""}
                </label>
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs text-white/60">
            补充要求（选填）
            <TextArea
              rows={2}
              radius="large"
              value={instruction}
              maxLength={1000}
              disabled={working}
              placeholder="例如：重点看封面；这是修复后的第二次提交，只看上次提的问题有没有改好。"
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>

          {working && (
            <div className="flex items-center gap-3 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
              <Spinner size="2" />
              <span className="min-w-0 flex-1">{phase.message}</span>
              <span className="tabular-nums text-sky-100/60">{elapsed}s</span>
              <button type="button" className="text-sky-100/70 underline underline-offset-2" onClick={cancel}>
                取消
              </button>
            </div>
          )}

          {phase.kind === "failed" && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            >
              <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{phase.message}</span>
            </p>
          )}

          {skippedImages.length > 0 && (
            <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              以下图片没有发给模型，草稿里关于它们的判断不可信：
              {skippedImages.map((item) => `${item.label}（${item.reason}）`).join("；")}
            </p>
          )}

          {run?.result && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLE[run.result.verdict]}`}
                  >
                    {REVIEW_AI_VERDICT_LABELS[run.result.verdict]}
                  </span>
                  <span className="text-xs text-white/45">
                    {modelLabel(run.model)} · {new Date(run.createdAt).toLocaleString()}
                    {run.revision && run.revision !== revision ? " · 针对的是更早的提交" : ""}
                  </span>
                </div>
                {run.result.summary && (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/80">
                    {run.result.summary}
                  </p>
                )}
                <p className="mt-2 text-xs text-white/35">{formatReviewAiUsage(run.usage)}</p>
                {run.result.droppedRules.length > 0 && (
                  <p className="mt-1 text-xs text-amber-300">
                    模型引用了文档里不存在的条款，已忽略：{run.result.droppedRules.join("、")}
                  </p>
                )}
              </div>

              {run.result.issues.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                  <CheckCircle size={16} weight="fill" />
                  模型没有发现需要提出的问题。是否通过仍由你决定。
                </p>
              ) : (
                run.result.issues.map((issue, issueIndex) => {
                  const { entries } = resolveGuidelineRefs(guidelines.index, issue.rules);
                  const reply = composeAiIssueReply(issue, guidelines.index);
                  const isUsed = used.includes(issueIndex);
                  return (
                    <div
                      key={`${run.id}-${issueIndex}`}
                      className={`rounded-xl border px-3 py-3 ${
                        isUsed ? "border-white/5 bg-white/[0.02] opacity-70" : "border-white/10 bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                            issue.severity === "must_fix"
                              ? "border-amber-400/30 bg-amber-500/15 text-amber-100"
                              : "border-white/15 bg-white/10 text-white/70"
                          }`}
                        >
                          {issue.severity === "must_fix" ? "必须修改" : "建议"}
                        </span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                          {REVIEW_AI_TARGET_LABELS[issue.target] ?? issue.target}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                          {issue.title}
                        </span>
                        <Button
                          size="1"
                          variant={isUsed ? "soft" : "solid"}
                          color={isUsed ? "gray" : undefined}
                          onClick={() => adoptIssue(issue, issueIndex)}
                        >
                          {isUsed ? "再次填入" : "填入编辑器"}
                        </Button>
                      </div>
                      {entries.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entries.map((entry) => (
                            <span
                              key={entry.node.ref}
                              className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-100"
                            >
                              {guidelineLabel(entry)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div
                        className="mt-2 break-words text-sm leading-6 text-white/75"
                        dangerouslySetInnerHTML={{ __html: renderCommentMarkdownHtml(reply.text) }}
                      />
                    </div>
                  );
                })
              )}
            </div>
          )}

          {otherRuns.length > 0 && !working && (
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-white/50">
                <ClockCounterClockwise size={13} />
                这个提交最近的草稿
              </p>
              <div className="mt-1.5 flex flex-col">
                {otherRuns.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-white/65 hover:bg-white/[0.06]"
                    onClick={() => {
                      jobRef.current += 1;
                      setPhase({ kind: "idle" });
                      setRun(item);
                    }}
                  >
                    <span className="shrink-0 text-white/40">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <span className="shrink-0">{modelLabel(item.model)}</span>
                    <span className="min-w-0 flex-1 truncate text-white/45">
                      {item.result
                        ? `${REVIEW_AI_VERDICT_LABELS[item.result.verdict]} · ${item.result.issues.length} 个问题`
                        : ""}
                      {item.revision !== revision ? " · 更早的提交" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/35">
            每次生成都会消耗 OpenRouter 额度，并记入管理审计。
          </p>
          <div className="flex gap-2">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              disabled={
                working ||
                !resource ||
                !selectedModel ||
                !models.signedIn ||
                models.data?.available === false
              }
              onClick={() => void generate()}
            >
              {run ? <ArrowCounterClockwise size={14} weight="bold" /> : <Sparkle size={14} weight="fill" />}
              {working ? "生成中…" : run ? "重新生成" : "生成草稿"}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

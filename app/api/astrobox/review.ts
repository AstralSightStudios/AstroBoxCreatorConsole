import { sendApiRequest } from "./request";
import type { ReviewGuidelines } from "~/logic/review-assist/guidelines";
import type {
  ReviewPreset,
  ReviewPresetDraft,
} from "~/logic/review-assist/presets";
import type {
  ReviewAiModel,
  ReviewAiRequest,
  ReviewAiRun,
} from "~/logic/review-assist/ai";

/**
 * 审核辅助接口（`/admin/review/*`）：审核准则、共用的预制回复、AI 审核草稿。
 * 全部要求 AstroBox 账号带 admin / moderator / pr-reviewer 角色，没有角色时服务端回 403。
 */

export const REVIEW_GUIDELINES_QUERY_KEY = ["review-assist", "guidelines"] as const;
export const REVIEW_PRESETS_QUERY_KEY = ["review-assist", "presets"] as const;
export const REVIEW_AI_MODELS_QUERY_KEY = ["review-assist", "ai-models"] as const;
export const reviewAiRunsQueryKey = (prNumber: number, resourceId: string) =>
  ["review-assist", "ai-runs", prNumber, resourceId] as const;

export const ReviewAssistApi = {
  /** `refresh` 为真时让服务端立刻去文档内容仓核对最新版本。 */
  guidelines: (refresh = false) =>
    sendApiRequest<ReviewGuidelines>(
      `/admin/review/guidelines${refresh ? "?refresh=1" : ""}`,
      "GET",
    ),

  presets: {
    list: () => sendApiRequest<{ items: ReviewPreset[] }>("/admin/review/presets", "GET"),
    create: (draft: ReviewPresetDraft) =>
      sendApiRequest<ReviewPreset>("/admin/review/presets", "POST", undefined, draft),
    update: (id: string, patch: Partial<ReviewPresetDraft> & { sort?: number }) =>
      sendApiRequest<ReviewPreset>(
        `/admin/review/presets/${encodeURIComponent(id)}`,
        "PATCH",
        undefined,
        patch,
      ),
    remove: (id: string) =>
      sendApiRequest<{ deleted: true }>(
        `/admin/review/presets/${encodeURIComponent(id)}`,
        "DELETE",
      ),
    /** 把默认预制回复补进共用列表；已有同名的不会被覆盖。 */
    importDefaults: () =>
      sendApiRequest<{ added: number; items: ReviewPreset[] }>(
        "/admin/review/presets/import-defaults",
        "POST",
      ),
  },

  ai: {
    models: () =>
      sendApiRequest<{ available: boolean; models: ReviewAiModel[] }>(
        "/admin/review/ai/models",
        "GET",
      ),
    /** 发起生成，立刻返回 runId；结果用 `run` 轮询。 */
    start: (body: ReviewAiRequest) =>
      sendApiRequest<{ runId: string }>("/admin/review/ai/runs", "POST", undefined, body),
    run: (id: string) =>
      sendApiRequest<ReviewAiRun>(`/admin/review/ai/runs/${encodeURIComponent(id)}`, "GET"),
    /** 这个 PR、这个资源最近生成过的草稿（任何审核员生成的都算）。 */
    runs: (prNumber: number, resourceId: string) =>
      sendApiRequest<{ items: ReviewAiRun[] }>(
        `/admin/review/ai/runs?prNumber=${prNumber}&resourceId=${encodeURIComponent(resourceId)}`,
        "GET",
      ),
  },
};

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  REVIEW_AI_MODELS_QUERY_KEY,
  REVIEW_GUIDELINES_QUERY_KEY,
  REVIEW_PRESETS_QUERY_KEY,
  ReviewAssistApi,
} from "~/api/astrobox/review";
import { ApiError } from "~/api/astrobox/request";
import { useAccountState } from "~/logic/account/store";
import { indexGuidelines } from "~/logic/review-assist/guidelines";

/**
 * 审核辅助接口失败时给审核员看的话。403 最常见：GitHub 上有仓库权限、能进审核页，
 * 但 AstroBox 账号没有审核角色（两套权限是分开授予的）。
 */
export function describeReviewAssistError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "当前 AstroBox 账号没有审核角色（admin / moderator / pr-reviewer），请联系管理员授予后再使用。";
    }
    if (error.status === 404) {
      return "服务端还没有这个功能，请等待服务端更新。";
    }
    if (error.status === 503) {
      return "服务端暂时读不到审核准则（连不上文档仓库），请稍后重试。";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "请求失败";
}

/** 没登录 AstroBox 账号时这些接口必然 403，干脆不发请求。 */
function useAstroboxSignedIn(): boolean {
  return Boolean(useAccountState().astrobox?.token);
}

/**
 * 审核准则（实时来自文档内容仓）。服务端自己有 1 分钟的版本缓存，这里再缓存 5 分钟；
 * `refresh` 让服务端立刻核对最新版本。
 */
export function useReviewGuidelines(enabled = true) {
  const signedIn = useAstroboxSignedIn();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: REVIEW_GUIDELINES_QUERY_KEY,
    queryFn: () => ReviewAssistApi.guidelines(),
    enabled: enabled && signedIn,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
  const index = useMemo(() => indexGuidelines(query.data), [query.data]);
  const refresh = async () => {
    const fresh = await ReviewAssistApi.guidelines(true);
    queryClient.setQueryData(REVIEW_GUIDELINES_QUERY_KEY, fresh);
    return fresh;
  };
  return { ...query, guidelines: query.data, index, refresh, signedIn };
}

export function useReviewPresets(enabled = true) {
  const signedIn = useAstroboxSignedIn();
  const query = useQuery({
    queryKey: REVIEW_PRESETS_QUERY_KEY,
    queryFn: async () => (await ReviewAssistApi.presets.list()).items,
    enabled: enabled && signedIn,
    staleTime: 60_000,
    retry: false,
  });
  return { ...query, presets: query.data ?? [], signedIn };
}

export function useReviewAiModels(enabled = true) {
  const signedIn = useAstroboxSignedIn();
  const query = useQuery({
    queryKey: REVIEW_AI_MODELS_QUERY_KEY,
    queryFn: () => ReviewAssistApi.ai.models(),
    enabled: enabled && signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { ...query, signedIn };
}

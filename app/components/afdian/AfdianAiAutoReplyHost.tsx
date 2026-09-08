import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianSessionStatus,
} from "~/api/afdian-account";
import {
  AFDIAN_DIALOGS_QUERY_KEY,
  type AfdianMessage,
  getAfdianMessages,
  sendAfdianMessage,
} from "~/api/afdian-messages";
import {
  AI_API_KEY_STATUS_QUERY_KEY,
  getAiApiKeyStatus,
} from "~/api/ai";
import {
  type AfdianAiAutoReplyConfig,
  isAfdianAiAutoReplySupported,
  useAfdianAiAutoReplyConfig,
} from "~/config/afdianAiAutoReply";
import {
  finalizeAutoReply,
  findKeywordReply,
  generateAfdianAiReply,
  getLatestAfdianMessage,
  getTrailingInboundText,
  matchesLatestAfdianMessage,
} from "~/logic/afdian/ai-auto-reply";
import {
  beginAfdianAiReplyGeneration,
  getAfdianAiReplyActivitySnapshot,
  useAfdianAiReplyActivity,
} from "~/logic/afdian/ai-reply-activity";
import { log } from "~/logic/logging";

const AUTO_REPLY_CANDIDATES_EVENT = "afdian-message-auto-reply-candidates";
const REPLY_DELAY_MS = 8_000;
const RETRY_DELAYS_MS = [15_000, 30_000];
const MAX_CONCURRENT_REPLIES = 2;

interface AutoReplyCandidate {
  userId: string;
  messageId: string;
}

interface QueueRuntime {
  disposed: boolean;
  activeCount: number;
  activeUsers: Set<string>;
  generationStops: Set<() => void>;
  repliedInboundByUser: Map<string, string>;
  pendingByUser: Map<string, AutoReplyCandidate>;
}

class AutoReplyCandidateNotReadyError extends Error {
  constructor() {
    super("候选消息尚未同步到会话内容");
    this.name = "AutoReplyCandidateNotReadyError";
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function hasUsableKeywordRule(config: AfdianAiAutoReplyConfig) {
  return config.keywordRules.some(
    (rule) =>
      rule.enabled &&
      rule.reply.trim().length > 0 &&
      rule.keywords.some((keyword) => keyword.trim().length > 0),
  );
}

function isInboundTextMessage(
  message: ReturnType<typeof getLatestAfdianMessage>,
): message is AfdianMessage {
  return (
    message?.direction === "receive" &&
    message.messageType === 1 &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

export default function AfdianAiAutoReplyHost() {
  const supported = isAfdianAiAutoReplySupported();
  const config = useAfdianAiAutoReplyConfig();
  const queryClient = useQueryClient();
  const configRef = useRef(config);
  const hasAiFallbackRef = useRef(false);
  const generationToastIdsRef = useRef(new Map<string, string | number>());
  const { generatingUserIds, visibleConversationUserId } =
    useAfdianAiReplyActivity();
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: supported,
    staleTime: 30_000,
    retry: false,
  });
  const keyStatusQuery = useQuery({
    queryKey: AI_API_KEY_STATUS_QUERY_KEY,
    queryFn: getAiApiKeyStatus,
    enabled: supported,
    staleTime: 30_000,
    retry: false,
  });
  const hasAiFallback =
    keyStatusQuery.data?.configured === true &&
    keyStatusQuery.data.baseUrl === config.baseUrl.trim().replace(/\/+$/, "") &&
    config.baseUrl.trim().length > 0 &&
    config.model.trim().length > 0;
  const ready =
    supported &&
    config.enabled &&
    sessionQuery.data?.connected === true &&
    (hasUsableKeywordRule(config) || hasAiFallback);
  configRef.current = config;
  hasAiFallbackRef.current = hasAiFallback;

  useEffect(() => {
    const activeUserIds = new Set(generatingUserIds);
    const toastIds = generationToastIdsRef.current;

    generatingUserIds.forEach((userId) => {
      const existingToastId = toastIds.get(userId);
      if (userId === visibleConversationUserId) {
        if (existingToastId !== undefined) {
          toast.dismiss(existingToastId);
          toastIds.delete(userId);
        }
        return;
      }
      if (existingToastId !== undefined) return;

      const toastId = toast.loading("正在生成 AI 自动回复", {
        description: "完成后将自动发送至对应的爱发电私信对话",
        duration: Infinity,
      });
      toastIds.set(userId, toastId);
    });

    toastIds.forEach((toastId, userId) => {
      if (
        activeUserIds.has(userId) &&
        userId !== visibleConversationUserId
      ) {
        return;
      }
      toast.dismiss(toastId);
      toastIds.delete(userId);
    });
  }, [generatingUserIds, visibleConversationUserId]);

  useEffect(
    () => () => {
      generationToastIdsRef.current.forEach((toastId) => {
        toast.dismiss(toastId);
      });
      generationToastIdsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    void invoke("afdian_message_auto_reply_set_enabled", { enabled: ready })
      .then(() => {
        log.info("afdian/ai-auto-reply", "自动回复后台轮询状态同步成功", {
          data: { enabled: ready },
        });
      })
      .catch((error) => {
        log.error("afdian/ai-auto-reply", "自动回复后台轮询状态同步失败", {
          data: { enabled: ready, error },
        });
      });
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    const runtime: QueueRuntime = {
      disposed: false,
      activeCount: 0,
      activeUsers: new Set(),
      generationStops: new Set(),
      repliedInboundByUser: new Map(),
      pendingByUser: new Map(),
    };

    const enqueue = (candidate: AutoReplyCandidate) => {
      if (runtime.disposed || !candidate.userId || !candidate.messageId) return;
      runtime.pendingByUser.set(candidate.userId, candidate);
      pumpQueue();
    };

    const processCandidate = async (
      candidate: AutoReplyCandidate,
      ensureGenerationStarted: () => void,
    ) => {
      await wait(REPLY_DELAY_MS);
      if (runtime.disposed) return;

      const page = await getAfdianMessages({
        userId: candidate.userId,
        messageType: "new",
      });
      if (runtime.disposed) return;

      const latest = getLatestAfdianMessage(page.items);
      if (!latest) {
        throw new AutoReplyCandidateNotReadyError();
      }
      if (!isInboundTextMessage(latest)) {
        log.debug("afdian/ai-auto-reply", "候选消息不需要自动回复", {
          data: { userId: candidate.userId, messageId: candidate.messageId },
        });
        return;
      }
      if (runtime.repliedInboundByUser.get(candidate.userId) === latest.id) {
        log.debug("afdian/ai-auto-reply", "候选消息已经回复，已忽略重复事件", {
          data: { userId: candidate.userId, messageId: latest.id },
        });
        return;
      }

      const inboundText = getTrailingInboundText(page.items);
      const currentConfig = configRef.current;
      const fixedReply = findKeywordReply(
        inboundText,
        currentConfig.keywordRules,
      );
      let reply: string;
      let source: "keyword" | "ai";

      if (fixedReply) {
        reply = finalizeAutoReply(fixedReply);
        source = "keyword";
      } else if (hasAiFallbackRef.current) {
        ensureGenerationStarted();
        reply = await generateAfdianAiReply({
          config: currentConfig,
          messages: page.items,
        });
        source = "ai";
      } else {
        log.debug("afdian/ai-auto-reply", "没有匹配的关键词回复，且 AI 回复不可用", {
          data: { userId: candidate.userId, messageId: latest.id },
        });
        return;
      }

      if (!reply || runtime.disposed) return;
      const currentPage = await getAfdianMessages({
        userId: candidate.userId,
        messageType: "new",
      });
      if (runtime.disposed) return;

      if (configRef.current !== currentConfig) {
        enqueue({ userId: candidate.userId, messageId: latest.id });
        return;
      }

      const currentLatest = getLatestAfdianMessage(currentPage.items);
      if (!matchesLatestAfdianMessage(currentPage.items, latest.id)) {
        if (isInboundTextMessage(currentLatest)) {
          enqueue({ userId: candidate.userId, messageId: currentLatest.id });
        }
        log.info("afdian/ai-auto-reply", "生成期间会话已更新，已取消本次回复", {
          data: { userId: candidate.userId, messageId: latest.id },
        });
        return;
      }
      if (!isInboundTextMessage(currentLatest)) return;

      const sent = await sendAfdianMessage({
        userId: candidate.userId,
        content: reply,
      });
      runtime.repliedInboundByUser.set(candidate.userId, latest.id);
      log.info("afdian/ai-auto-reply", "自动回复发送成功", {
        data: {
          userId: candidate.userId,
          inboundMessageId: latest.id,
          sentMessageId: sent.id,
          source,
        },
      });
      void queryClient.invalidateQueries({ queryKey: AFDIAN_DIALOGS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: ["afdian", "messages", candidate.userId],
      });
      if (
        getAfdianAiReplyActivitySnapshot().visibleConversationUserId !==
        candidate.userId
      ) {
        toast.success("AI 自动回复已发送", {
          description: "回复已发送至对应的爱发电私信对话",
        });
      }
    };

    const runCandidate = async (candidate: AutoReplyCandidate) => {
      const generation = { stop: null as (() => void) | null };
      const ensureGenerationStarted = () => {
        if (generation.stop) return;
        generation.stop = beginAfdianAiReplyGeneration(candidate.userId);
        runtime.generationStops.add(generation.stop);
      };

      try {
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            await processCandidate(candidate, ensureGenerationStarted);
            return;
          } catch (error) {
            if (runtime.disposed) return;
            const retryDelay = RETRY_DELAYS_MS[attempt];
            if (retryDelay === undefined) {
              log.error("afdian/ai-auto-reply", "自动回复处理失败", {
                data: {
                  userId: candidate.userId,
                  messageId: candidate.messageId,
                  attempts: attempt + 1,
                  error,
                },
              });
              if (
                generation.stop &&
                getAfdianAiReplyActivitySnapshot().visibleConversationUserId !==
                  candidate.userId
              ) {
                toast.error("AI 自动回复失败", {
                  description: "回复未发送，请检查网络或 AI 服务后重试",
                });
              }
              return;
            }
            log.warn("afdian/ai-auto-reply", "自动回复将在等待后重试", {
              data: {
                userId: candidate.userId,
                messageId: candidate.messageId,
                attempt: attempt + 1,
                retryDelay,
                error,
              },
            });
            await wait(retryDelay);
          }
        }
      } finally {
        if (generation.stop) {
          runtime.generationStops.delete(generation.stop);
          generation.stop();
        }
      }
    };

    function pumpQueue() {
      if (runtime.disposed) return;
      while (
        runtime.activeCount < MAX_CONCURRENT_REPLIES &&
        runtime.pendingByUser.size > 0
      ) {
        const next = Array.from(runtime.pendingByUser.entries()).find(
          ([userId]) => !runtime.activeUsers.has(userId),
        );
        if (!next) return;
        const [userId, candidate] = next;
        runtime.pendingByUser.delete(userId);
        runtime.activeUsers.add(userId);
        runtime.activeCount += 1;
        void runCandidate(candidate).finally(() => {
          runtime.activeUsers.delete(userId);
          runtime.activeCount -= 1;
          pumpQueue();
        });
      }
    }

    const unlistenPromise = listen<AutoReplyCandidate[]>(
      AUTO_REPLY_CANDIDATES_EVENT,
      (event) => {
        event.payload.forEach(enqueue);
      },
    );

    return () => {
      runtime.disposed = true;
      runtime.pendingByUser.clear();
      runtime.generationStops.forEach((stopGeneration) => stopGeneration());
      runtime.generationStops.clear();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [queryClient, ready]);

  return null;
}

import {
  PlusIcon,
  RobotIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianSessionStatus,
} from "~/api/afdian-account";
import {
  AI_API_KEY_STATUS_QUERY_KEY,
  deleteAiApiKey,
  getAiApiKeyStatus,
  getAiErrorMessage,
  saveAiApiKey,
} from "~/api/ai";
import {
  Button,
  Callout,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  type AfdianAiAutoReplyConfig,
  type AfdianAiKeywordMatchMode,
  createKeywordRuleId,
  isAfdianAiAutoReplySupported,
  saveAfdianAiAutoReplyConfig,
  useAfdianAiAutoReplyConfig,
} from "~/config/afdianAiAutoReply";
import {
  AI_REPLY_DISCLAIMER,
  testAfdianAiConnection,
} from "~/logic/afdian/ai-auto-reply";
import { SectionCard } from "~/routes/resource/publish/components/shared";

interface KeywordRuleDraft {
  id: string;
  enabled: boolean;
  keywordsText: string;
  matchMode: AfdianAiKeywordMatchMode;
  reply: string;
}

interface AutoReplyDraft {
  baseUrl: string;
  model: string;
  instructions: string;
  keywordRules: KeywordRuleDraft[];
}

function createDraft(config: AfdianAiAutoReplyConfig): AutoReplyDraft {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    instructions: config.instructions,
    keywordRules: config.keywordRules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      keywordsText: rule.keywords.join("，"),
      matchMode: rule.matchMode,
      reply: rule.reply,
    })),
  };
}

function buildConfig(draft: AutoReplyDraft, enabled: boolean) {
  return {
    enabled,
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
    model: draft.model.trim(),
    instructions: draft.instructions.trim(),
    keywordRules: draft.keywordRules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      keywords: rule.keywordsText
        .split(/[,\uff0c\n]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      matchMode: rule.matchMode,
      reply: rule.reply.trim(),
    })),
  } satisfies AfdianAiAutoReplyConfig;
}

function hasUsableRule(config: AfdianAiAutoReplyConfig) {
  return config.keywordRules.some(
    (rule) =>
      rule.enabled && rule.keywords.length > 0 && rule.reply.trim().length > 0,
  );
}

function validateBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export default function AfdianAiAutoReplySection() {
  const supported = isAfdianAiAutoReplySupported();
  const config = useAfdianAiAutoReplyConfig();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createDraft(config));
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deletingKey, setDeletingKey] = useState(false);
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

  useEffect(() => {
    setDraft(createDraft(config));
  }, [config]);

  const updateRule = (id: string, patch: Partial<KeywordRuleDraft>) => {
    setDraft((current) => ({
      ...current,
      keywordRules: current.keywordRules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    }));
  };

  const addRule = () => {
    setDraft((current) => ({
      ...current,
      keywordRules: [
        ...current.keywordRules,
        {
          id: createKeywordRuleId(),
          enabled: true,
          keywordsText: "",
          matchMode: "any",
          reply: "",
        },
      ],
    }));
  };

  const persistApiKey = async (baseUrl: string) => {
    const normalized = apiKey.trim();
    if (!normalized) {
      return (
        keyStatusQuery.data?.configured === true &&
        keyStatusQuery.data.baseUrl === baseUrl
      );
    }
    const status = await saveAiApiKey(normalized, baseUrl);
    queryClient.setQueryData(AI_API_KEY_STATUS_QUERY_KEY, status);
    setApiKey("");
    return true;
  };

  const validateAiFields = (nextConfig: AfdianAiAutoReplyConfig) => {
    if (!nextConfig.model) return true;
    if (!validateBaseUrl(nextConfig.baseUrl)) {
      toast.error("请输入有效的 HTTPS API 地址");
      return false;
    }
    return true;
  };

  const handleSave = async (
    enabled = config.enabled,
    showSuccess = true,
  ) => {
    const nextConfig = buildConfig(draft, enabled);
    if (!validateAiFields(nextConfig)) return false;

    setSaving(true);
    try {
      const keyConfigured = await persistApiKey(nextConfig.baseUrl);
      const canUseAi =
        keyConfigured && Boolean(nextConfig.model) && validateBaseUrl(nextConfig.baseUrl);
      if (enabled && !hasUsableRule(nextConfig) && !canUseAi) {
        toast.error("请先配置一条有效的关键词回复，或填写 API Key 和模型");
        return false;
      }
      saveAfdianAiAutoReplyConfig(nextConfig);
      if (showSuccess) toast.success("自动回复配置已保存");
      return true;
    } catch (error) {
      toast.error(getAiErrorMessage(error, "无法保存 AI 自动回复配置"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledChange = async (enabled: boolean) => {
    if (!enabled) {
      saveAfdianAiAutoReplyConfig(buildConfig(draft, false));
      toast.success("已关闭私信自动回复");
      return;
    }
    if (sessionQuery.data?.connected !== true) {
      toast.error("请先登录爱发电账户");
      return;
    }
    const saved = await handleSave(true, false);
    if (saved) toast.success("已开启私信自动回复");
  };

  const handleTest = async () => {
    const nextConfig = buildConfig(draft, config.enabled);
    if (!nextConfig.model) {
      toast.error("请填写模型名称");
      return;
    }
    if (!validateAiFields(nextConfig)) return;

    setTesting(true);
    try {
      const keyConfigured = await persistApiKey(nextConfig.baseUrl);
      if (!keyConfigured) {
        toast.error("请填写 API Key");
        return;
      }
      await testAfdianAiConnection(nextConfig);
      toast.success("AI 服务连接成功");
    } catch (error) {
      toast.error(getAiErrorMessage(error, "AI 服务连接失败"));
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteKey = async () => {
    setDeletingKey(true);
    try {
      await deleteAiApiKey();
      queryClient.setQueryData(AI_API_KEY_STATUS_QUERY_KEY, {
        configured: false,
        masked: null,
        baseUrl: null,
      });
      setApiKey("");
      if (!hasUsableRule(buildConfig(draft, false)) && config.enabled) {
        saveAfdianAiAutoReplyConfig(buildConfig(draft, false));
      }
      toast.success("API Key 已删除");
    } catch (error) {
      toast.error(getAiErrorMessage(error, "无法删除 API Key"));
    } finally {
      setDeletingKey(false);
    }
  };

  return (
    <SectionCard
      title="AI 私信自动回复"
      description="根据关键词、指定文档和 OpenAI 兼容模型自动回复爱发电私信"
    >
      {!supported ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <WarningIcon size={16} />
          </Callout.Icon>
          <Callout.Text>自动回复仅支持桌面客户端。</Callout.Text>
        </Callout.Root>
      ) : (
        <>
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">自动回复</p>
              <p className="text-xs text-white/45">
                {sessionQuery.data?.connected
                  ? "应用运行时检测并回复新私信"
                  : "登录爱发电后可开启"}
              </p>
            </div>
            <Switch
              aria-label="私信自动回复"
              checked={config.enabled}
              disabled={
                sessionQuery.data?.connected !== true || saving || testing
              }
              onCheckedChange={(enabled) => void handleEnabledChange(enabled)}
            />
          </div>

          <Callout.Root color="amber">
            <Callout.Icon>
              <RobotIcon size={16} />
            </Callout.Icon>
            <Callout.Text>
              自动回复会直接发送给对方。每条回复都会强制附加“{AI_REPLY_DISCLAIMER}”。
            </Callout.Text>
          </Callout.Root>

          <div className="flex flex-col gap-4 px-2 py-2">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-white/60">
                API 地址
                <TextField.Root
                  value={draft.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-white/60">
                模型
                <TextField.Root
                  value={draft.model}
                  placeholder="输入服务商提供的模型名称"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-xs text-white/60">
              API Key
              <TextField.Root
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={
                  keyStatusQuery.data?.configured
                    ? keyStatusQuery.data.baseUrl ===
                      draft.baseUrl.trim().replace(/\/+$/, "")
                      ? `已保存 ${keyStatusQuery.data.masked || "API Key"}，留空表示不修改`
                      : "API 地址已更改，请重新输入 API Key"
                    : "输入 API Key"
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
              <span className="text-[11.5px] text-white/40">
                API Key 保存在系统凭据库中并与当前 API 地址绑定，更换地址后需重新输入。
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="soft"
                disabled={testing || saving}
                onClick={() => void handleTest()}
              >
                {testing ? <Spinner size="1" /> : null}
                测试连接
              </Button>
              {keyStatusQuery.data?.configured && (
                <Button
                  color="red"
                  variant="soft"
                  disabled={deletingKey}
                  onClick={() => void handleDeleteKey()}
                >
                  {deletingKey ? <Spinner size="1" /> : <TrashIcon size={15} />}
                  删除 API Key
                </Button>
              )}
            </div>

            <label className="flex flex-col gap-1.5 text-xs text-white/60">
              回复要求（System Prompt）
              <TextArea
                value={draft.instructions}
                placeholder="例如：语气友好，优先解答资源下载与授权问题。"
                resize="vertical"
                rows={4}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    instructions: event.target.value,
                  }))
                }
              />
              <span className="text-[11.5px] text-white/40">
                AI 回复会参考 AstroBox 文档与米坛知识库；这些要求会附加到内置安全提示词之后。
              </span>
            </label>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">关键词固定回复</p>
                <p className="text-xs text-white/45">按从上到下的顺序匹配，命中后不调用 AI</p>
              </div>
              <Button variant="soft" onClick={addRule}>
                <PlusIcon size={15} />
                添加规则
              </Button>
            </div>

            {draft.keywordRules.length === 0 ? (
              <p className="py-3 text-center text-sm text-white/40">暂无关键词回复规则</p>
            ) : (
              <div className="flex flex-col gap-3">
                {draft.keywordRules.map((rule, index) => (
                  <div
                    key={rule.id}
                    className="flex flex-col gap-3 border-t border-white/[0.06] pt-3"
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        aria-label={`启用规则 ${index + 1}`}
                        checked={rule.enabled}
                        onCheckedChange={(enabled) =>
                          updateRule(rule.id, { enabled })
                        }
                      />
                      <span className="flex-1 text-sm font-medium text-white">
                        规则 {index + 1}
                      </span>
                      <Select.Root
                        value={rule.matchMode}
                        onValueChange={(matchMode: AfdianAiKeywordMatchMode) =>
                          updateRule(rule.id, { matchMode })
                        }
                      >
                        <Select.Trigger aria-label="关键词匹配方式" />
                        <Select.Content>
                          <Select.Item value="any">包含任意关键词</Select.Item>
                          <Select.Item value="all">包含全部关键词</Select.Item>
                          <Select.Item value="exact">完全匹配</Select.Item>
                        </Select.Content>
                      </Select.Root>
                      <Button
                        color="red"
                        variant="ghost"
                        aria-label={`删除规则 ${index + 1}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            keywordRules: current.keywordRules.filter(
                              (item) => item.id !== rule.id,
                            ),
                          }))
                        }
                      >
                        <TrashIcon size={15} />
                      </Button>
                    </div>
                    <label className="flex flex-col gap-1.5 text-xs text-white/60">
                      关键词
                      <TextField.Root
                        value={rule.keywordsText}
                        placeholder="多个关键词用逗号分隔"
                        onChange={(event) =>
                          updateRule(rule.id, {
                            keywordsText: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-white/60">
                      固定回复
                      <TextArea
                        value={rule.reply}
                        placeholder="输入命中关键词后发送的内容"
                        resize="vertical"
                        rows={3}
                        onChange={(event) =>
                          updateRule(rule.id, { reply: event.target.value })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button disabled={saving || testing} onClick={() => void handleSave()}>
                {saving ? <Spinner size="1" /> : null}
                保存配置
              </Button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ABCC_AFDIAN_AI_AUTO_REPLY_V1";

export type AfdianAiKeywordMatchMode = "any" | "all" | "exact";

export interface AfdianAiKeywordRule {
  id: string;
  enabled: boolean;
  keywords: string[];
  matchMode: AfdianAiKeywordMatchMode;
  reply: string;
}

export interface AfdianAiAutoReplyConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  instructions: string;
  keywordRules: AfdianAiKeywordRule[];
}

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedConfig: AfdianAiAutoReplyConfig | undefined;
const serverConfig: AfdianAiAutoReplyConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "",
  instructions: "",
  keywordRules: [],
};

function createDefaultConfig(): AfdianAiAutoReplyConfig {
  return {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    model: "",
    instructions: "",
    keywordRules: [],
  };
}

function normalizeKeywordRule(value: unknown): AfdianAiKeywordRule | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const matchMode =
    record.matchMode === "all" || record.matchMode === "exact"
      ? record.matchMode
      : "any";
  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : createKeywordRuleId(),
    enabled: record.enabled !== false,
    keywords,
    matchMode,
    reply: typeof record.reply === "string" ? record.reply : "",
  };
}

function normalizeConfig(value: unknown): AfdianAiAutoReplyConfig {
  const defaults = createDefaultConfig();
  if (!value || typeof value !== "object") return defaults;
  const record = value as Record<string, unknown>;
  const keywordRules = Array.isArray(record.keywordRules)
    ? record.keywordRules
        .map(normalizeKeywordRule)
        .filter((item): item is AfdianAiKeywordRule => item !== null)
    : [];

  return {
    enabled: record.enabled === true,
    baseUrl:
      typeof record.baseUrl === "string" && record.baseUrl.trim()
        ? record.baseUrl.trim().replace(/\/+$/, "")
        : defaults.baseUrl,
    model: typeof record.model === "string" ? record.model.trim() : "",
    instructions:
      typeof record.instructions === "string" ? record.instructions.trim() : "",
    keywordRules,
  };
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function isAfdianAiAutoReplySupported() {
  if (!isBrowser()) return false;
  const hasTauriRuntime =
    "__TAURI_INTERNALS__" in window ||
    "__TAURI_METADATA__" in window ||
    "__TAURI_IPC__" in window;
  const identity = `${navigator.userAgent} ${navigator.platform}`;
  return hasTauriRuntime && !/Android|iPhone|iPad|iPod|Mobile/i.test(identity);
}

function readFromStorage() {
  if (!isBrowser()) return createDefaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : createDefaultConfig();
  } catch {
    return createDefaultConfig();
  }
}

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
  if (!isBrowser() || storageListenerAttached) return;
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEY) {
      cachedConfig = readFromStorage();
      notifySubscribers();
    }
  });
  storageListenerAttached = true;
}

export function createKeywordRuleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadAfdianAiAutoReplyConfig() {
  if (!cachedConfig) cachedConfig = readFromStorage();
  return cachedConfig;
}

export function saveAfdianAiAutoReplyConfig(
  config: AfdianAiAutoReplyConfig,
) {
  cachedConfig = normalizeConfig(config);
  if (isBrowser()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedConfig));
    } catch {
      // 本地存储不可用时仍保留当前运行期配置。
    }
  }
  notifySubscribers();
}

export function setAfdianAiAutoReplyEnabled(enabled: boolean) {
  saveAfdianAiAutoReplyConfig({
    ...loadAfdianAiAutoReplyConfig(),
    enabled,
  });
}

export function useAfdianAiAutoReplyConfig() {
  attachStorageListener();
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    loadAfdianAiAutoReplyConfig,
    () => serverConfig,
  );
}

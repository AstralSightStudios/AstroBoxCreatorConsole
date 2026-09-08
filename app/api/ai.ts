import { invoke } from "@tauri-apps/api/core";

export const AI_API_KEY_STATUS_QUERY_KEY = ["ai", "api-key-status"] as const;

export interface AiApiKeyStatus {
  configured: boolean;
  masked?: string | null;
  baseUrl?: string | null;
}

export interface AiHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface AiDocSearchResult {
  source: string;
  title: string;
  url: string;
  snippet: string;
}

export function getAiApiKeyStatus() {
  return invoke<AiApiKeyStatus>("ai_api_key_status");
}

export function saveAiApiKey(apiKey: string, baseUrl: string) {
  return invoke<AiApiKeyStatus>("ai_api_key_save", { apiKey, baseUrl });
}

export function deleteAiApiKey() {
  return invoke<void>("ai_api_key_delete");
}

export function sendAiHttpRequest(url: string, body: string) {
  return invoke<AiHttpResponse>("ai_http_request", { url, body });
}

export function searchAiDocs(query: string) {
  return invoke<AiDocSearchResult[]>("ai_docs_search", { query });
}

export function getAiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

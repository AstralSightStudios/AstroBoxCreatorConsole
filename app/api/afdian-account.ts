import { invoke } from "@tauri-apps/api/core";

export const AFDIAN_SESSION_QUERY_KEY = ["afdian", "session"] as const;
export const AFDIAN_INCOME_QUERY_KEY = ["afdian", "income-overview"] as const;

export interface AfdianSessionStatus {
  connected: boolean;
  displayName?: string | null;
}

export interface AfdianQuickCodeResult {
  status: "sent" | "captchaRequired" | "captchaInvalid";
  message: string;
  captchaImage?: string | null;
}

export interface AfdianIncomeOverview {
  currentMonth?: string | null;
  previousMonth: string;
  withdrawable?: string | null;
  today: string;
  yesterday: string;
  asOf: string;
}

export function isAfdianNativeAvailable() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window ||
      "__TAURI_METADATA__" in window ||
      "__TAURI_IPC__" in window)
  );
}

export function getAfdianSessionStatus() {
  return invoke<AfdianSessionStatus>("afdian_session_status");
}

export function loginAfdianWithPassword(account: string, password: string) {
  return invoke<AfdianSessionStatus>("afdian_password_login", {
    account,
    password,
  });
}

export function sendAfdianQuickLoginCode(
  phone: string,
  captchaCode = "",
) {
  return invoke<AfdianQuickCodeResult>("afdian_send_quick_login_code", {
    phone,
    captchaCode,
  });
}

export function refreshAfdianCaptcha(phone: string) {
  return invoke<string>("afdian_refresh_captcha", { phone });
}

export function loginAfdianWithQuickCode(phone: string, code: string) {
  return invoke<AfdianSessionStatus>("afdian_quick_login", { phone, code });
}

export function logoutAfdian() {
  return invoke<void>("afdian_logout");
}

export function getAfdianIncomeOverview() {
  return invoke<AfdianIncomeOverview>("afdian_income_overview");
}

export function getAfdianErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

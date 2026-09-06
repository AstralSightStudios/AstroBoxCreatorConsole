import { useSyncExternalStore } from "react";

// 爱发电私信通知配置，仅在 Windows 和 macOS 客户端生效。
const STORAGE_KEY = "ABCC_AFDIAN_MESSAGE_NOTIFICATIONS_V1";

export interface AfdianMessageNotificationState {
  enabled: boolean;
}

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedState: AfdianMessageNotificationState | undefined;

function createDefaultState(): AfdianMessageNotificationState {
  return {
    enabled: false,
  };
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeState(value: unknown): AfdianMessageNotificationState {
  if (!value || typeof value !== "object") return createDefaultState();

  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
  };
}

function readFromStorage(): AfdianMessageNotificationState {
  if (!isBrowser()) return createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function saveState(
  state: AfdianMessageNotificationState,
  shouldNotify = true,
) {
  cachedState = normalizeState(state);
  if (isBrowser()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedState));
    } catch {
      // 本地存储不可用时仍保留当前运行期状态。
    }
  }
  if (shouldNotify) notifySubscribers();
}

function attachStorageListener() {
  if (!isBrowser() || storageListenerAttached) return;
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEY) {
      cachedState = readFromStorage();
      notifySubscribers();
    }
  });
  storageListenerAttached = true;
}

export function isAfdianMessageNotificationSupported() {
  if (!isBrowser()) return false;
  const hasTauriRuntime =
    "__TAURI_INTERNALS__" in window ||
    "__TAURI_METADATA__" in window ||
    "__TAURI_IPC__" in window;
  if (!hasTauriRuntime) return false;

  const identity = `${navigator.userAgent} ${navigator.platform}`;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(identity);
  const isSupportedDesktop = /Windows|Win32|Win64|Macintosh|Mac OS X|MacIntel/i.test(
    identity,
  );
  return isSupportedDesktop && !isMobile;
}

export function loadAfdianMessageNotificationState() {
  if (!cachedState) cachedState = readFromStorage();
  return cachedState;
}

export function setAfdianMessageNotificationsEnabled(enabled: boolean) {
  saveState({ enabled });
}

export function useAfdianMessageNotificationsEnabled(): [
  boolean,
  (enabled: boolean) => void,
] {
  attachStorageListener();
  const enabled = useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    () => loadAfdianMessageNotificationState().enabled,
    () => false,
  );
  return [enabled, setAfdianMessageNotificationsEnabled];
}

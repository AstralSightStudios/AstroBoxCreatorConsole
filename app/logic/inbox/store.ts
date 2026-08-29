import { useSyncExternalStore } from "react";

const STORAGE_KEY = "INBOX_UNREAD_COUNT_V1";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedCount: number | undefined;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
  if (!isBrowser() || storageListenerAttached) return;

  const handler = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) {
      cachedCount = readCountFromStorage();
      notifySubscribers();
    }
  };

  window.addEventListener("storage", handler);
  storageListenerAttached = true;
}

function readCountFromStorage(): number {
  if (!isBrowser()) return 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getInboxUnreadCount(): number {
  if (cachedCount === undefined) {
    cachedCount = readCountFromStorage();
  }
  return cachedCount;
}

export function setInboxUnreadCount(count: number) {
  cachedCount = Math.max(0, Math.floor(count));
  if (isBrowser()) {
    localStorage.setItem(STORAGE_KEY, String(cachedCount));
  }
  notifySubscribers();
}

export function useInboxUnreadCount(): number {
  attachStorageListener();
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getInboxUnreadCount,
    () => 0,
  );
}

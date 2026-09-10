import { useSyncExternalStore } from "react";

// 导航显示偏好与账号区域收缩配置
const ACCOUNT_COLLAPSE_STORAGE_KEY = "ABCC_NAV_ACCOUNT_COLLAPSE_V1";
const ITEMS_STORAGE_KEY = "ABCC_NAV_ITEMS_V1";
const DEFAULT_NAV_ACCOUNT_COLLAPSE = false;

export interface NavItemPreferences {
  hiddenItemIds: readonly string[];
  itemOrder: readonly string[];
}

export const DEFAULT_NAV_ITEM_PREFERENCES: NavItemPreferences = Object.freeze({
  hiddenItemIds: Object.freeze([]),
  itemOrder: Object.freeze([]),
});

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedAccountCollapse: boolean | undefined;
let cachedItemPreferences: NavItemPreferences | undefined;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return [...new Set(ids)];
}

export function normalizeNavItemPreferences(
  value: unknown,
): NavItemPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_NAV_ITEM_PREFERENCES;
  }

  const candidate = value as Partial<NavItemPreferences>;
  return {
    hiddenItemIds: normalizeIdList(candidate.hiddenItemIds),
    itemOrder: normalizeIdList(candidate.itemOrder),
  };
}

function readAccountCollapseFromStorage(): boolean {
  if (!isBrowser()) return DEFAULT_NAV_ACCOUNT_COLLAPSE;
  return localStorage.getItem(ACCOUNT_COLLAPSE_STORAGE_KEY) === "1";
}

function readItemPreferencesFromStorage(): NavItemPreferences {
  if (!isBrowser()) return DEFAULT_NAV_ITEM_PREFERENCES;

  const raw = localStorage.getItem(ITEMS_STORAGE_KEY);
  if (!raw) return DEFAULT_NAV_ITEM_PREFERENCES;

  try {
    return normalizeNavItemPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_NAV_ITEM_PREFERENCES;
  }
}

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function subscribe(listener: Subscriber) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function attachStorageListener() {
  if (!isBrowser() || storageListenerAttached) return;

  window.addEventListener("storage", (event) => {
    let changed = false;

    if (!event.key || event.key === ACCOUNT_COLLAPSE_STORAGE_KEY) {
      cachedAccountCollapse = readAccountCollapseFromStorage();
      changed = true;
    }
    if (!event.key || event.key === ITEMS_STORAGE_KEY) {
      cachedItemPreferences = readItemPreferencesFromStorage();
      changed = true;
    }

    if (changed) notifySubscribers();
  });
  storageListenerAttached = true;
}

export function loadNavAccountCollapse(): boolean {
  if (typeof cachedAccountCollapse !== "boolean") {
    cachedAccountCollapse = readAccountCollapseFromStorage();
  }
  return cachedAccountCollapse;
}

export function saveNavAccountCollapse(enabled: boolean) {
  cachedAccountCollapse = enabled;
  if (isBrowser()) {
    localStorage.setItem(ACCOUNT_COLLAPSE_STORAGE_KEY, enabled ? "1" : "0");
  }
  notifySubscribers();
}

export function loadNavItemPreferences(): NavItemPreferences {
  if (!cachedItemPreferences) {
    cachedItemPreferences = readItemPreferencesFromStorage();
  }
  return cachedItemPreferences;
}

function saveNavItemPreferences(preferences: NavItemPreferences) {
  cachedItemPreferences = normalizeNavItemPreferences(preferences);
  if (isBrowser()) {
    localStorage.setItem(
      ITEMS_STORAGE_KEY,
      JSON.stringify(cachedItemPreferences),
    );
  }
  notifySubscribers();
}

export function saveNavItemVisibility(itemId: string, visible: boolean) {
  const preferences = loadNavItemPreferences();
  const hiddenItemIds = new Set(preferences.hiddenItemIds);

  if (visible) {
    hiddenItemIds.delete(itemId);
  } else {
    hiddenItemIds.add(itemId);
  }

  saveNavItemPreferences({
    ...preferences,
    hiddenItemIds: [...hiddenItemIds],
  });
}

export function saveNavItemOrder(itemOrder: readonly string[]) {
  saveNavItemPreferences({
    ...loadNavItemPreferences(),
    itemOrder,
  });
}

export function resetNavItemPreferences() {
  cachedItemPreferences = DEFAULT_NAV_ITEM_PREFERENCES;
  if (isBrowser()) {
    localStorage.removeItem(ITEMS_STORAGE_KEY);
  }
  notifySubscribers();
}

export function isNavItemVisible(
  itemId: string,
  preferences: NavItemPreferences,
) {
  return !preferences.hiddenItemIds.includes(itemId);
}

export function useNavAccountCollapse(): boolean {
  attachStorageListener();
  return useSyncExternalStore(
    subscribe,
    loadNavAccountCollapse,
    () => DEFAULT_NAV_ACCOUNT_COLLAPSE,
  );
}

export function useNavItemPreferences(): NavItemPreferences {
  attachStorageListener();
  return useSyncExternalStore(
    subscribe,
    loadNavItemPreferences,
    () => DEFAULT_NAV_ITEM_PREFERENCES,
  );
}

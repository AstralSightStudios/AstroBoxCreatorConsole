import { useSyncExternalStore } from "react";
import {
  NAV_PRIMARY_ACTION,
  NAV_SECTIONS,
  normalizePath,
  type NavLinkConfig,
} from "~/layout/nav-config";

// 启动页面：打开应用后默认进入的页面。取值收敛在导航配置内，
// 因此不会出现「指向一个导航里根本去不了的地址」的脏数据。
export const DEFAULT_STARTUP_PAGE = "/";
const STORAGE_KEY = "ABCC_STARTUP_PAGE_V1";

export interface StartupPageOption extends NavLinkConfig {
  /** 所属导航分组，用于设置页里分组展示。 */
  group: string;
}

/** 全部可作为启动页面的候选（未按权限过滤，过滤交给调用方）。 */
export const STARTUP_PAGE_OPTIONS: StartupPageOption[] = [
  ...NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      group: section.title ?? "常用",
    })),
  ),
  {
    ...NAV_PRIMARY_ACTION,
    group: "快捷操作",
  },
];

const ALLOWED_STARTUP_PATHS = new Set(
  STARTUP_PAGE_OPTIONS.map((option) => normalizePath(option.path)),
);

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedStartupPage: string | undefined;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** 只接受导航里存在的路径，非法值（含越权路径被手工写入）一律回落概览。 */
export function normalizeStartupPage(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_STARTUP_PAGE;
  const normalized = normalizePath(value);
  return ALLOWED_STARTUP_PATHS.has(normalized) ? normalized : DEFAULT_STARTUP_PAGE;
}

function readStartupPageFromStorage(): string {
  if (!isBrowser()) return DEFAULT_STARTUP_PAGE;
  return normalizeStartupPage(localStorage.getItem(STORAGE_KEY));
}

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
  if (!isBrowser() || storageListenerAttached) return;
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEY) {
      cachedStartupPage = readStartupPageFromStorage();
      notifySubscribers();
    }
  });
  storageListenerAttached = true;
}

export function loadStartupPage(): string {
  if (!cachedStartupPage) {
    cachedStartupPage = readStartupPageFromStorage();
  }
  return cachedStartupPage;
}

export function saveStartupPage(path: string) {
  cachedStartupPage = normalizeStartupPage(path);
  if (isBrowser()) {
    localStorage.setItem(STORAGE_KEY, cachedStartupPage);
  }
  notifySubscribers();
}

export function useStartupPage(): string {
  attachStorageListener();
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    loadStartupPage,
    () => DEFAULT_STARTUP_PAGE,
  );
}
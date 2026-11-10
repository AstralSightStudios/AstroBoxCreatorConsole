import { useSyncExternalStore } from "react";
import {
  DEFAULT_MEDIA_CACHE_LIMIT_MB,
  MEDIA_CACHE_DB_NAME,
  MEDIA_CACHE_DB_VERSION,
  MEDIA_CACHE_LIMIT_OPTIONS,
  MEDIA_CACHE_LIMIT_STORAGE_KEY,
  MEDIA_CACHE_MAX_ENTRY_BYTES,
  MEDIA_CACHE_TRIM_DEBOUNCE_MS,
  MEDIA_CACHE_TRIM_HEADROOM_RATIO,
  MEDIA_CACHE_TRIM_TRIGGER_RATIO,
} from "~/config/mediaCache";
import { parseRawGithubUrl } from "./github-raw";

const ENTRY_STORE = "entries";
const META_STORE = "meta";
const META_INDEX = "lastAccessAt";
const BYTES_PER_MB = 1024 * 1024;
const TOUCH_WRITE_INTERVAL_MS = 60_000;

interface MediaEntryRecord {
  url: string;
  blob: Blob;
}

interface MediaMetaRecord {
  url: string;
  size: number;
  createdAt: number;
  lastAccessAt: number;
}

interface MediaIndexEntry {
  size: number;
  createdAt: number;
  lastAccessAt: number;
}

export interface MediaCacheStats {
  /** 已占用的持久缓存字节数。 */
  usedBytes: number;
  /** 当前设置的容量上限字节数；0 表示关闭。 */
  limitBytes: number;
  /** 缓存中的图片数量。 */
  entries: number;
  /** 当前环境是否可用（IndexedDB 存在且容量上限不为 0）。 */
  available: boolean;
}

const listeners = new Set<() => void>();
const index = new Map<string, MediaIndexEntry>();
const lastTouchWriteAt = new Map<string, number>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
let initPromise: Promise<void> | null = null;
let ready = false;
let totalBytes = 0;
let trimming = false;
let trimTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: MediaCacheStats = {
  usedBytes: 0,
  limitBytes: 0,
  entries: 0,
  available: false,
};

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function normalizeLimitMb(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return MEDIA_CACHE_LIMIT_OPTIONS.some((option) => option.mb === numeric)
    ? numeric
    : DEFAULT_MEDIA_CACHE_LIMIT_MB;
}

/** 读取用户设置的缓存上限（MB）。localStorage 不可用时回退默认值。 */
export function getMediaCacheLimitMb(): number {
  if (typeof localStorage === "undefined") return DEFAULT_MEDIA_CACHE_LIMIT_MB;
  const raw = localStorage.getItem(MEDIA_CACHE_LIMIT_STORAGE_KEY);
  if (raw == null) return DEFAULT_MEDIA_CACHE_LIMIT_MB;
  return normalizeLimitMb(raw);
}

/** 修改缓存上限；关闭缓存会立即清空已落盘内容。 */
export function setMediaCacheLimitMb(value: unknown): void {
  const limitMb = normalizeLimitMb(value);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(MEDIA_CACHE_LIMIT_STORAGE_KEY, String(limitMb));
  }
  publish();
  if (limitMb <= 0) {
    void clearMediaCache();
  } else {
    void trimMediaCache(true);
  }
}

export function getMediaCacheStats(): MediaCacheStats {
  return snapshot;
}

/** 只有以提交 SHA 定位的 raw 图片才允许持久缓存，分支引用永远不落盘。 */
export function isImmutableMediaUrl(url: string): boolean {
  const parsed = parseRawGithubUrl(url);
  if (!parsed) return false;
  return /^[0-9a-f]{7,40}$/i.test(parsed.ref);
}

export function formatMediaCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / BYTES_PER_MB;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function publish(): void {
  const limitMb = getMediaCacheLimitMb();
  snapshot = {
    usedBytes: totalBytes,
    limitBytes: limitMb * BYTES_PER_MB,
    entries: index.size,
    available: hasIndexedDb() && limitMb > 0,
  };
  listeners.forEach((listener) => listener());
}

export function subscribeMediaCache(listener: () => void): () => void {
  listeners.add(listener);
  void ensureMediaCacheReady();
  return () => {
    listeners.delete(listener);
  };
}

export function useMediaCacheStats(): MediaCacheStats {
  return useSyncExternalStore(
    subscribeMediaCache,
    getMediaCacheStats,
    getMediaCacheStats,
  );
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!hasIndexedDb()) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(MEDIA_CACHE_DB_NAME, MEDIA_CACHE_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTRY_STORE)) {
        database.createObjectStore(ENTRY_STORE, { keyPath: "url" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        const meta = database.createObjectStore(META_STORE, { keyPath: "url" });
        meta.createIndex(META_INDEX, "lastAccessAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务中止"));
  });
}

async function readAllMeta(database: IDBDatabase): Promise<MediaMetaRecord[]> {
  const transaction = database.transaction(META_STORE, "readonly");
  return (await requestToPromise(
    transaction.objectStore(META_STORE).getAll(),
  )) as MediaMetaRecord[];
}

async function writeRecord(
  database: IDBDatabase,
  url: string,
  blob: Blob,
  createdAt: number,
  lastAccessAt: number,
): Promise<void> {
  const transaction = database.transaction([ENTRY_STORE, META_STORE], "readwrite");
  transaction.objectStore(ENTRY_STORE).put({
    url,
    blob,
  } satisfies MediaEntryRecord);
  transaction.objectStore(META_STORE).put({
    url,
    size: blob.size,
    createdAt,
    lastAccessAt,
  } satisfies MediaMetaRecord);
  await transactionDone(transaction);
}

async function deleteRecords(database: IDBDatabase, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const transaction = database.transaction([ENTRY_STORE, META_STORE], "readwrite");
  const entryStore = transaction.objectStore(ENTRY_STORE);
  const metaStore = transaction.objectStore(META_STORE);
  for (const url of urls) {
    entryStore.delete(url);
    metaStore.delete(url);
  }
  await transactionDone(transaction);
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator === "undefined") return;
    await navigator.storage?.persist?.();
  } catch {
    // 持久化授权失败不影响缓存可用性。
  }
}

async function initialize(): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    ready = true;
    publish();
    return;
  }
  try {
    const metas = await readAllMeta(database);
    index.clear();
    totalBytes = 0;
    for (const meta of metas) {
      if (!meta?.url) continue;
      const size = Number(meta.size) || 0;
      index.set(meta.url, {
        size,
        createdAt: Number(meta.createdAt) || 0,
        lastAccessAt: Number(meta.lastAccessAt) || 0,
      });
      totalBytes += size;
    }
  } catch {
    index.clear();
    totalBytes = 0;
  }
  ready = true;
  publish();
  await trimInternal(true);
  void requestPersistentStorage();
}

/** 首次访问缓存时加载索引并做一次启动清理。 */
export function ensureMediaCacheReady(): Promise<void> {
  if (!initPromise) initPromise = initialize();
  return initPromise;
}

function touch(url: string): void {
  const entry = index.get(url);
  if (!entry) return;
  const now = Date.now();
  entry.lastAccessAt = now;
  const lastWrite = lastTouchWriteAt.get(url) ?? 0;
  if (now - lastWrite < TOUCH_WRITE_INTERVAL_MS) return;
  lastTouchWriteAt.set(url, now);
  void (async () => {
    const database = await openDatabase();
    if (!database) return;
    try {
      const transaction = database.transaction(META_STORE, "readwrite");
      transaction.objectStore(META_STORE).put({
        url,
        size: entry.size,
        createdAt: entry.createdAt,
        lastAccessAt: now,
      } satisfies MediaMetaRecord);
      await transactionDone(transaction);
    } catch {
      // 访问时间写失败只影响 LRU 精度，不影响读取。
    }
  })();
}

/** 读取持久缓存的图片；不存在或不可缓存时返回 null。 */
export async function readPersistedMedia(url: string): Promise<Blob | null> {
  if (!isImmutableMediaUrl(url)) return null;
  if (getMediaCacheLimitMb() <= 0) return null;
  await ensureMediaCacheReady();
  if (!ready) return null;
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const record = (await requestToPromise(
      transaction.objectStore(ENTRY_STORE).get(url),
    )) as MediaEntryRecord | undefined;
    if (!record?.blob) {
      // 元数据存在但内容缺失（异常退出/手工清理过 entries）：顺手清掉，
      // 避免容量统计一直包含一个已经不存在的条目。
      const orphan = index.get(url);
      if (orphan) {
        index.delete(url);
        totalBytes = Math.max(0, totalBytes - orphan.size);
        publish();
      }
      void deleteRecords(database, [url]);
      return null;
    }
    if (record.blob.size > 0) touch(url);
    return record.blob;
  } catch {
    return null;
  }
}

/** 写入持久缓存；超过单文件上限或关闭缓存时直接跳过。 */
export async function writePersistedMedia(url: string, blob: Blob): Promise<void> {
  if (!isImmutableMediaUrl(url)) return;
  if (getMediaCacheLimitMb() <= 0) return;
  if (!blob || blob.size <= 0 || blob.size > MEDIA_CACHE_MAX_ENTRY_BYTES) return;
  await ensureMediaCacheReady();
  if (!ready) return;
  const database = await openDatabase();
  if (!database) return;

  const now = Date.now();
  const previous = index.get(url);
  const createdAt = previous?.createdAt ?? now;
  try {
    try {
      await writeRecord(database, url, blob, createdAt, now);
    } catch {
      // 配额不足时先淘汰旧内容再重试一次。
      await trimInternal(true);
      await writeRecord(database, url, blob, createdAt, now);
    }
  } catch {
    // 缓存是尽力而为：写入失败不影响本次图片展示。
    return;
  }

  totalBytes += blob.size - (previous?.size ?? 0);
  index.set(url, { size: blob.size, createdAt, lastAccessAt: now });
  publish();
  scheduleTrim();
}

function scheduleTrim(): void {
  if (trimTimer !== null) return;
  trimTimer = setTimeout(() => {
    trimTimer = null;
    void trimMediaCache();
  }, MEDIA_CACHE_TRIM_DEBOUNCE_MS);
}

async function trimInternal(force: boolean): Promise<void> {
  if (trimming) return;
  const limitBytes = getMediaCacheLimitMb() * BYTES_PER_MB;
  if (limitBytes <= 0) {
    await clearInternal();
    return;
  }
  const targetBytes = limitBytes * MEDIA_CACHE_TRIM_HEADROOM_RATIO;
  const triggerBytes = limitBytes * MEDIA_CACHE_TRIM_TRIGGER_RATIO;
  if (!force && totalBytes <= triggerBytes) return;
  if (totalBytes <= targetBytes) return;

  const database = await openDatabase();
  if (!database) return;

  trimming = true;
  try {
    const candidates = Array.from(index.entries()).sort(
      (left, right) => left[1].lastAccessAt - right[1].lastAccessAt,
    );
    const victims: Array<{ url: string; size: number }> = [];
    let remaining = totalBytes;
    for (const [url, entry] of candidates) {
      if (remaining <= targetBytes) break;
      victims.push({ url, size: entry.size });
      remaining -= entry.size;
    }
    if (victims.length === 0) return;
    await deleteRecords(
      database,
      victims.map((victim) => victim.url),
    );
    for (const victim of victims) {
      index.delete(victim.url);
      lastTouchWriteAt.delete(victim.url);
      totalBytes -= victim.size;
    }
  } catch {
    // 淘汰失败时保留索引，下一次写入或启动会再尝试。
  } finally {
    trimming = false;
    publish();
  }
}

/** 按 LRU 淘汰到容量上限以内；force=true 时即使未超限也会整理到 90%。 */
export async function trimMediaCache(force = false): Promise<void> {
  await ensureMediaCacheReady();
  await trimInternal(force);
}

async function clearInternal(): Promise<void> {
  const database = await openDatabase();
  if (database) {
    try {
      const transaction = database.transaction(
        [ENTRY_STORE, META_STORE],
        "readwrite",
      );
      transaction.objectStore(ENTRY_STORE).clear();
      transaction.objectStore(META_STORE).clear();
      await transactionDone(transaction);
    } catch {
      // 清空失败不影响内存索引重置。
    }
  }
  index.clear();
  lastTouchWriteAt.clear();
  totalBytes = 0;
  publish();
}

/** 清空全部持久缓存（设置页的「清空图片缓存」）。 */
export async function clearMediaCache(): Promise<void> {
  await ensureMediaCacheReady();
  await clearInternal();
}

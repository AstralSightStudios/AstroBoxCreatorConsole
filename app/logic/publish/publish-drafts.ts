import type { AuthorInput, BundledResourceInput, DownloadInput, LinkInput } from "~/routes/resource/publish/components/types";
import type { ResourceType } from "./resource-type";

const DB_NAME = "abcc-publish-drafts";
const DB_VERSION = 1;
const DRAFTS_STORE = "drafts";
const AUTOSAVE_STORE = "autosave";
const AUTOSAVE_KEY = "current";

export interface PublishDraft {
  id: string;
  name: string;
  savedAt: number;
  formData: PublishDraftFormData;
}

export interface DraftMediaItem {
  id: string;
  name: string;
  dataUrl?: string;
  url?: string;
  pathOverride?: string;
  skipUpload?: boolean;
  source?: "upload" | "existing";
  width?: number;
  height?: number;
}

export interface DraftWallpaperAsset {
  path: string;
  url?: string;
  dataUrl?: string;
  skipUpload?: boolean;
}

/**
 * 草稿中的包体文件：保存原始字节（ArrayBuffer）而非 File 对象。
 * WebKitGTK 不支持把 File/Blob 结构化克隆进 IndexedDB，存 File 会导致
 * 恢复后的文件无法读取（"The object can not be found here."）。
 */
export interface DraftDownloadFile {
  id: string;
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
  pathOverride?: string;
  skipUpload?: boolean;
  source?: "upload" | "existing";
}

export type DraftDownloadInput = Omit<DownloadInput, "file"> & {
  file: DraftDownloadFile | null;
};

export interface PublishDraftFormData {
  /** 当前草稿对应的资源会话日志文件名；恢复草稿时续写同一文件。 */
  sessionFile?: string;
  itemId: string;
  itemName: string;
  description: string;
  resourceType: ResourceType;
  tagsInput: string;
  paidType: string;
  authors: AuthorInput[];
  links: LinkInput[];
  previews: DraftMediaItem[];
  icon: DraftMediaItem | null;
  cover: DraftMediaItem | null;
  downloads: DraftDownloadInput[];
  trialDownloads: DraftDownloadInput[];
  bundledResources?: BundledResourceInput[];
  enableAstroBoxCreatorFeatures: boolean;
  extRaw: string;
  wallpaperConfigJson: string;
  wallpaperAssets: DraftWallpaperAsset[];
  wallpaperBaseUrl?: string;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("当前环境不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

export async function listDrafts(): Promise<PublishDraft[]> {
  try {
    const all = await withStore<PublishDraft[]>(
      DRAFTS_STORE,
      "readonly",
      (store) => store.getAll() as IDBRequest<PublishDraft[]>,
    );
    return (all || []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

async function writeAllDrafts(drafts: PublishDraft[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFTS_STORE, "readwrite");
    const store = transaction.objectStore(DRAFTS_STORE);
    store.clear();
    for (const draft of drafts) {
      store.put(draft);
    }
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function saveDraft(
  name: string,
  formData: PublishDraftFormData,
): Promise<PublishDraft> {
  const draft: PublishDraft = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    name: name || formData.itemName || "未命名草稿",
    savedAt: Date.now(),
    formData,
  };
  const drafts = await listDrafts();
  drafts.unshift(draft);
  await writeAllDrafts(drafts);
  return draft;
}

export async function updateDraft(
  id: string,
  name: string,
  formData: PublishDraftFormData,
): Promise<void> {
  const drafts = await listDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx >= 0) {
    drafts[idx] = { ...drafts[idx], name, formData, savedAt: Date.now() };
    await writeAllDrafts(drafts);
  }
}

export async function deleteDraft(id: string): Promise<void> {
  const drafts = (await listDrafts()).filter((d) => d.id !== id);
  await writeAllDrafts(drafts);
}

export async function autoSaveDraft(formData: PublishDraftFormData): Promise<void> {
  try {
    await withStore(AUTOSAVE_STORE, "readwrite", (store) =>
      store.put({ key: AUTOSAVE_KEY, formData, savedAt: Date.now() }),
    );
  } catch (error) {
    console.warn("[draft] auto-save failed", error);
  }
}

export async function loadAutoSavedDraft(): Promise<{
  formData: PublishDraftFormData;
  savedAt: number;
} | null> {
  try {
    const record = await withStore<{
      key: string;
      formData: PublishDraftFormData;
      savedAt: number;
    } | null>(AUTOSAVE_STORE, "readonly", (store) =>
      store.get(AUTOSAVE_KEY) as IDBRequest<{
        key: string;
        formData: PublishDraftFormData;
        savedAt: number;
      } | null>,
    );
    return record ? { formData: record.formData, savedAt: record.savedAt } : null;
  } catch {
    return null;
  }
}

export async function clearAutoSavedDraft(): Promise<void> {
  try {
    await withStore(AUTOSAVE_STORE, "readwrite", (store) =>
      store.delete(AUTOSAVE_KEY),
    );
  } catch {
    // ignore
  }
}

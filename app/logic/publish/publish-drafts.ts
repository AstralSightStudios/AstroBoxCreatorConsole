import type { AuthorInput, DownloadInput, LinkInput } from "~/routes/resource/publish/components/types";

const DRAFTS_KEY = "PUBLISH_DRAFTS_V1";
const AUTO_SAVE_KEY = "PUBLISH_DRAFT_AUTOSAVE_V1";

export interface PublishDraft {
  id: string;
  name: string;
  savedAt: number;
  formData: PublishDraftFormData;
}

export interface PublishDraftFormData {
  itemId: string;
  itemName: string;
  description: string;
  resourceType: "quick_app" | "watchface";
  tagsInput: string;
  paidType: string;
  authors: AuthorInput[];
  links: LinkInput[];
  downloads: DownloadInput[];
  trialDownloads: DownloadInput[];
  enableAstroBoxCreatorFeatures: boolean;
  extRaw: string;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function listDrafts(): PublishDraft[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveAllDrafts(drafts: PublishDraft[]) {
  if (!isBrowser()) return;
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function saveDraft(name: string, formData: PublishDraftFormData): PublishDraft {
  const drafts = listDrafts();
  const draft: PublishDraft = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    name: name || formData.itemName || "未命名草稿",
    savedAt: Date.now(),
    formData,
  };
  drafts.unshift(draft);
  saveAllDrafts(drafts);
  return draft;
}

export function updateDraft(id: string, name: string, formData: PublishDraftFormData): void {
  const drafts = listDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx >= 0) {
    drafts[idx] = { ...drafts[idx], name, formData, savedAt: Date.now() };
    saveAllDrafts(drafts);
  }
}

export function deleteDraft(id: string): void {
  const drafts = listDrafts().filter((d) => d.id !== id);
  saveAllDrafts(drafts);
}

// Auto-save (single slot for crash recovery)
export function autoSaveDraft(formData: PublishDraftFormData): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(
      AUTO_SAVE_KEY,
      JSON.stringify({ formData, savedAt: Date.now() }),
    );
  } catch {
    // quota exceeded, ignore
  }
}

export function loadAutoSavedDraft(): { formData: PublishDraftFormData; savedAt: number } | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearAutoSavedDraft(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(AUTO_SAVE_KEY);
}

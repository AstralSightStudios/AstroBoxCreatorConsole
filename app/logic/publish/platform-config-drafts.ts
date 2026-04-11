import {
  upsertResourceProduct,
  upsertResourceSku,
  type CommercePlatform,
} from "~/api/astrobox/order";

const STORAGE_KEY = "PENDING_PLATFORM_CONFIG_DRAFTS_V1";

export interface PlatformConfigDraft {
  resourceId: string;
  deviceId: string;
  platform: CommercePlatform;
  externalProductId: string;
  externalSkuId: string;
  title?: string;
  buyUrl?: string;
  isPaid?: boolean;
  enabled?: boolean;
  updatedAt: number;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getPlatformConfigDrafts(): PlatformConfigDraft[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveAll(drafts: PlatformConfigDraft[]) {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function upsertPlatformConfigDraft(draft: Omit<PlatformConfigDraft, "updatedAt">) {
  const drafts = getPlatformConfigDrafts();
  const idx = drafts.findIndex(
    (item) =>
      item.resourceId === draft.resourceId &&
      item.deviceId === draft.deviceId &&
      item.platform === draft.platform,
  );
  const next: PlatformConfigDraft = { ...draft, updatedAt: Date.now() };
  if (idx >= 0) {
    drafts[idx] = next;
  } else {
    drafts.push(next);
  }
  saveAll(drafts);
}

function removeDraft(target: PlatformConfigDraft) {
  const drafts = getPlatformConfigDrafts().filter(
    (item) =>
      !(
        item.resourceId === target.resourceId &&
        item.deviceId === target.deviceId &&
        item.platform === target.platform
      ),
  );
  saveAll(drafts);
}

function getErrorMessage(err: unknown) {
  return (
    (err as any)?.response?.data?.message ||
    (err as Error)?.message ||
    "Unknown error"
  );
}

export async function flushPlatformConfigDrafts(resourceId?: string) {
  const drafts = getPlatformConfigDrafts();
  const pending = resourceId
    ? drafts.filter((d) => d.resourceId === resourceId)
    : drafts;

  let synced = 0;
  for (const draft of pending) {
    try {
      await upsertResourceProduct({
        resourceId: draft.resourceId,
        platform: draft.platform,
        externalProductId: draft.externalProductId,
        title: draft.title,
        buyUrl: draft.buyUrl,
        enabled: draft.enabled,
      });
      await upsertResourceSku({
        resourceId: draft.resourceId,
        platform: draft.platform,
        externalProductId: draft.externalProductId,
        externalSkuId: draft.externalSkuId,
        deviceId: draft.deviceId,
        title: draft.title,
        buyUrl: draft.buyUrl,
        isPaid: draft.isPaid,
        enabled: draft.enabled,
      });
      removeDraft(draft);
      synced += 1;
    } catch (err) {
      const msg = getErrorMessage(err);
      if (/Resource not found/i.test(msg)) {
        continue;
      }
    }
  }

  return { synced, total: pending.length };
}

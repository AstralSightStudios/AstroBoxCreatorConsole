import { toast } from "sonner";
import { AdminApi } from "~/api/astrobox/admin";
import type { CcNoticeSubtype } from "./types";

export interface CcNoticePayload {
  subtype: CcNoticeSubtype;
  tagId?: string;
  content?: string;
  senderNote?: string;
  prNumber: number;
  prUrl: string;
  resourceId?: string;
  resourceName?: string;
  deepLink?: string;
  userIds: string[];
  title: string;
  body: string;
}

const SENT_KEYS_STORAGE = "CC_NOTICE_SENT_KEYS_V1";
const PENDING_QUEUE_STORAGE = "CC_NOTICE_PENDING_QUEUE_V1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function idempotencyKey(payload: CcNoticePayload): string {
  return `${payload.prNumber}:${payload.subtype}:${payload.tagId ?? ""}`;
}

function loadSentKeys(): Set<string> {
  return new Set(readJson<string[]>(SENT_KEYS_STORAGE, []));
}

function persistSentKeys(keys: Set<string>) {
  writeJson(SENT_KEYS_STORAGE, Array.from(keys));
}

async function post(payload: CcNoticePayload) {
  await AdminApi.inbox.send({
    target: { type: "userIds", userIds: payload.userIds },
    title: payload.title,
    body: payload.body,
    kind: "cc-notice",
    metadata: {
      subtype: payload.subtype,
      tagId: payload.tagId ?? null,
      content: payload.content ?? null,
      prNumber: payload.prNumber,
      prUrl: payload.prUrl,
      resourceId: payload.resourceId ?? null,
      resourceName: payload.resourceName ?? null,
      deepLink: payload.deepLink ?? null,
      senderNote: payload.senderNote ?? null,
    },
  });
}

function enqueuePending(payload: CcNoticePayload) {
  const queue = readJson<CcNoticePayload[]>(PENDING_QUEUE_STORAGE, []);
  queue.push(payload);
  writeJson(PENDING_QUEUE_STORAGE, queue);
}

/**
 * 发送一条 cc-notice。以 prNumber + subtype + tagId 作为幂等键，
 * 同一 PR 同一标签不重复发送；失败时进本地队列，下次操作时自动重试。
 */
export async function sendCcNotice(payload: CcNoticePayload): Promise<boolean> {
  if (payload.userIds.length === 0) return false;

  await flushCcNoticeQueue();

  const key = idempotencyKey(payload);
  const sentKeys = loadSentKeys();
  if (sentKeys.has(key)) return false;

  try {
    await post(payload);
    sentKeys.add(key);
    persistSentKeys(sentKeys);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`审核通知发送失败：${message}`);
    enqueuePending(payload);
    return false;
  }
}

/** 重试本地积压的发送失败通知。 */
export async function flushCcNoticeQueue(): Promise<void> {
  const queue = readJson<CcNoticePayload[]>(PENDING_QUEUE_STORAGE, []);
  if (queue.length === 0) return;
  writeJson(PENDING_QUEUE_STORAGE, []);

  for (const payload of queue) {
    try {
      await post(payload);
      const sentKeys = loadSentKeys();
      sentKeys.add(idempotencyKey(payload));
      persistSentKeys(sentKeys);
    } catch {
      enqueuePending(payload);
    }
  }
}

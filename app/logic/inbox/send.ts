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
const BULK_RECORDS_STORAGE = "CC_NOTICE_BULK_RECORDS_V1";

/** 已成功发送的通知记录：按幂等键保存 bulkId 与原始 payload，供撤回/重发使用。 */
export interface SentCcNoticeRecord {
  bulkId: string;
  payload: CcNoticePayload;
}

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

function buildNoticeKey(
  subtype: CcNoticeSubtype,
  prNumber: number,
  tagId?: string,
): string {
  return `${prNumber}:${subtype}:${tagId ?? ""}`;
}

function idempotencyKey(payload: CcNoticePayload): string {
  return buildNoticeKey(payload.subtype, payload.prNumber, payload.tagId);
}

function loadSentKeys(): Set<string> {
  return new Set(readJson<string[]>(SENT_KEYS_STORAGE, []));
}

function persistSentKeys(keys: Set<string>) {
  writeJson(SENT_KEYS_STORAGE, Array.from(keys));
}

function loadBulkRecords(): Record<string, SentCcNoticeRecord> {
  return readJson<Record<string, SentCcNoticeRecord>>(BULK_RECORDS_STORAGE, {});
}

function persistBulkRecords(records: Record<string, SentCcNoticeRecord>) {
  writeJson(BULK_RECORDS_STORAGE, records);
}

function recordSentBulk(key: string, bulkId: string, payload: CcNoticePayload) {
  if (!bulkId) return;
  const records = loadBulkRecords();
  records[key] = { bulkId, payload };
  persistBulkRecords(records);
}

function dropSentRecord(key: string) {
  const records = loadBulkRecords();
  if (records[key]) {
    delete records[key];
    persistBulkRecords(records);
  }
}

/** 查询某条审核通知是否已成功发送（编辑 NEEDFIX 评论时用于同步更新通知）。 */
export function findSentCcNotice(params: {
  subtype: CcNoticeSubtype;
  prNumber: number;
  tagId?: string;
}): SentCcNoticeRecord | null {
  const key = buildNoticeKey(params.subtype, params.prNumber, params.tagId);
  return loadBulkRecords()[key] ?? null;
}

/** 撤回此前发送的通知批次，并清除幂等记录，使后续可重新发送。 */
export async function revokeCcNotice(params: {
  subtype: CcNoticeSubtype;
  prNumber: number;
  tagId?: string;
}): Promise<void> {
  const key = buildNoticeKey(params.subtype, params.prNumber, params.tagId);
  const record = loadBulkRecords()[key];
  dropSentRecord(key);
  const sentKeys = loadSentKeys();
  sentKeys.delete(key);
  persistSentKeys(sentKeys);
  if (record?.bulkId) {
    await AdminApi.inbox.bulkDelete(record.bulkId);
  }
}

// 服务端 /admin/inbox 要求 title/body 均非空（minLength: 1）。
// 这里在传输层兜底，保证新发送与本地队列里的旧失败项都能成功。
function defaultNoticeBody(payload: CcNoticePayload): string {
  if (payload.subtype === "review-approved") {
    const name = payload.resourceName?.trim();
    return name
      ? `您的《${name}》资源提交已通过审核并加入官方源索引，随后可于 AstroBox 刷新查看。`
      : "您的资源提交已通过审核并加入官方源索引，随后可于 AstroBox 刷新查看。";
  }
  if (payload.subtype === "review-changes-requested") {
    return "审核人要求对本次提交进行修改，请查看 PR 中的修改意见。";
  }
  if (payload.subtype === "review-refused") {
    return "你的资源提交未通过审核。";
  }
  return "你的资源提交已被关闭。";
}

async function post(payload: CcNoticePayload) {
  return AdminApi.inbox.send({
    target: { type: "userIds", userIds: payload.userIds },
    title: payload.title?.trim() || "资源审核通知",
    body: payload.body?.trim() || defaultNoticeBody(payload),
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
    const res = await post(payload);
    sentKeys.add(key);
    persistSentKeys(sentKeys);
    recordSentBulk(key, res?.bulkId ?? "", payload);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    enqueuePending(payload);
    toast.error(`审核通知发送失败：${message}`, {
      action: {
        label: "重试",
        onClick: () => {
          void sendCcNotice(payload);
        },
      },
    });
    return false;
  }
}

/**
 * 重试本地积压的发送失败通知。逐条重发，仍失败的重新入队，
 * 并弹出带「重试」按钮的提示，避免静默丢失。
 */
export async function flushCcNoticeQueue(): Promise<void> {
  const queue = readJson<CcNoticePayload[]>(PENDING_QUEUE_STORAGE, []);
  if (queue.length === 0) return;
  writeJson(PENDING_QUEUE_STORAGE, []);

  for (const payload of queue) {
    try {
      const res = await post(payload);
      const sentKeys = loadSentKeys();
      sentKeys.add(idempotencyKey(payload));
      persistSentKeys(sentKeys);
      recordSentBulk(idempotencyKey(payload), res?.bulkId ?? "", payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      enqueuePending(payload);
      toast.error(`审核通知补发失败：${message}`, {
        action: {
          label: "重试",
          onClick: () => {
            void sendCcNotice(payload);
          },
        },
      });
    }
  }
}

import { toast } from "sonner";
import { AdminApi } from "~/api/astrobox/admin";
import type { CcNoticeMetadata, CcNoticeSubtype } from "./types";

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

function removePendingByKey(key: string) {
  const queue = readJson<CcNoticePayload[]>(PENDING_QUEUE_STORAGE, []);
  const next = queue.filter((payload) => idempotencyKey(payload) !== key);
  if (next.length !== queue.length) writeJson(PENDING_QUEUE_STORAGE, next);
}

function isPendingInQueue(key: string): boolean {
  return readJson<CcNoticePayload[]>(PENDING_QUEUE_STORAGE, []).some(
    (payload) => idempotencyKey(payload) === key,
  );
}

function normalizeNoticeContent(content: string | null | undefined): string {
  return (content ?? "").trim();
}

/**
 * 判断一封服务端信件是否对应某条待检测通知。
 * 历史数据里同一 PR 可能因旧 bug 复用相同 tagId，因此再用正文区分；
 * 正文缺失（旧数据）时退回只比对 subtype/prNumber/tagId。
 */
function serverMessageMatches(
  metadata: unknown,
  target: CcNoticeCheckTarget,
  prNumber: number,
): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  const meta = metadata as CcNoticeMetadata;
  if (meta.subtype !== target.subtype || meta.prNumber !== prNumber) return false;
  if ((meta.tagId ?? "") !== (target.tagId ?? "")) return false;
  if (target.content !== undefined) {
    return (
      normalizeNoticeContent(meta.content) ===
      normalizeNoticeContent(target.content)
    );
  }
  return true;
}

export type CcNoticeDeliveryState = "sent" | "pending" | "unsent";

export interface CcNoticeDeliveryStatus {
  state: CcNoticeDeliveryState;
  bulkId?: string;
}

export interface CcNoticeCheckTarget {
  /** GitHub 评论 id，用于把检测结果回填到对应评论。 */
  id: number;
  subtype: CcNoticeSubtype;
  tagId?: string;
  content?: string;
}

/**
 * 联网检测一批审核通知是否真的送达了 AstroBox 信箱。
 * 以服务端 /admin/inbox 的 cc-notice 记录为准；网络不可用时回退本地记录，
 * 本地队列中待补发的条目标记为 pending。
 */
export async function inspectCcNotices(params: {
  prNumber: number;
  userIds: string[];
  targets: CcNoticeCheckTarget[];
}): Promise<Map<number, CcNoticeDeliveryStatus>> {
  const result = new Map<number, CcNoticeDeliveryStatus>();
  if (params.targets.length === 0) return result;

  const keyOf = (target: CcNoticeCheckTarget) =>
    buildNoticeKey(target.subtype, params.prNumber, target.tagId);

  for (const target of params.targets) {
    result.set(target.id, { state: "unsent" });
  }
  for (const target of params.targets) {
    if (isPendingInQueue(keyOf(target))) {
      result.set(target.id, { state: "pending" });
    }
  }

  let serverChecked = false;
  if (params.userIds.length > 0) {
    try {
      const responses = await Promise.all(
        params.userIds.map((userId) =>
          AdminApi.inbox.list({ userId, kind: "cc-notice", limit: 100 }),
        ),
      );
      const messages = responses.flatMap((response) => response.items);
      for (const target of params.targets) {
        const hit = messages.find((item) =>
          serverMessageMatches(item.metadata, target, params.prNumber),
        );
        if (hit) {
          result.set(target.id, { state: "sent", bulkId: hit.bulkId ?? undefined });
        }
      }
      serverChecked = true;
    } catch {
      serverChecked = false;
    }
  }

  if (!serverChecked) {
    const records = loadBulkRecords();
    for (const target of params.targets) {
      if (result.get(target.id)?.state === "sent") continue;
      const record = records[keyOf(target)];
      if (!record) continue;
      if (
        target.content !== undefined &&
        normalizeNoticeContent(record.payload.content) !==
          normalizeNoticeContent(target.content)
      ) {
        continue;
      }
      result.set(target.id, { state: "sent", bulkId: record.bulkId });
    }
  }

  return result;
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
 * `force` 用于「重试发送」：跳过幂等键校验，显式补发某条评论的通知。
 */
export async function sendCcNotice(
  payload: CcNoticePayload,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (payload.userIds.length === 0) return false;

  if (!options.force) {
    await flushCcNoticeQueue();
  }

  const key = idempotencyKey(payload);
  const sentKeys = loadSentKeys();
  if (!options.force && sentKeys.has(key)) return false;

  try {
    const res = await post(payload);
    sentKeys.add(key);
    persistSentKeys(sentKeys);
    recordSentBulk(key, res?.bulkId ?? "", payload);
    removePendingByKey(key);
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

  const seen = new Set<string>();
  for (const payload of queue) {
    const key = idempotencyKey(payload);
    // 同一幂等键只补发一次；已成功发送过的直接丢弃，避免重复投递。
    if (seen.has(key) || loadSentKeys().has(key)) continue;
    seen.add(key);
    try {
      const res = await post(payload);
      const sentKeys = loadSentKeys();
      sentKeys.add(key);
      persistSentKeys(sentKeys);
      recordSentBulk(key, res?.bulkId ?? "", payload);
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

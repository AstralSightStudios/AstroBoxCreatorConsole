import { toast } from "sonner";
import { AdminApi, type InboxMessage } from "~/api/astrobox/admin";
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
 * 正文比对：历史数据里同一 PR 可能因旧 bug 复用相同 tagId，所以正常情况下还要
 * 再比正文；但服务端/旧记录里正文为空时降级为只比 subtype/prNumber/tagId，
 * 避免把「确实送达过的通知」误判成未送达。
 */
function noticeContentMatches(
  stored: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined) return true;
  const actual = normalizeNoticeContent(stored);
  if (!actual) return true;
  return actual === normalizeNoticeContent(expected);
}

export type CcNoticeDeliveryState =
  | "sent"
  | "pending"
  | "unsent"
  | "unmatched"
  | "unverified";

export interface CcNoticeDeliveryStatus {
  state: CcNoticeDeliveryState;
  bulkId?: string;
}

export interface CcNoticeCheckTarget {
  /** 业务键，与发送幂等键一致（prNumber:subtype:tagId），作为检测结果的主键。 */
  key: string;
  subtype: CcNoticeSubtype;
  tagId?: string;
  content?: string;
}

/** 组装检测目标，key 必须与 sendCcNotice 的幂等键保持一致。 */
export function buildCcNoticeCheckTarget(params: {
  prNumber: number;
  subtype: CcNoticeSubtype;
  tagId?: string;
  content?: string;
}): CcNoticeCheckTarget {
  return {
    key: buildNoticeKey(params.subtype, params.prNumber, params.tagId),
    subtype: params.subtype,
    tagId: params.tagId,
    content: params.content,
  };
}

/**
 * 把服务端命中的信件回填成本机发送记录。
 * 这样「检测到已发送」和「能撤回」用的是同一份数据，审核人换设备打开
 * PR 时也能取到 bulkId 做撤回/重发，而不会重复投递一份。
 */
function adoptServerRecord(
  key: string,
  message: { bulkId?: string | null; title: string; body: string; metadata: unknown },
  params: { prNumber: number; userIds: string[] },
): void {
  const bulkId = message.bulkId ?? "";
  if (!bulkId) return;
  const records = loadBulkRecords();
  if (records[key]?.bulkId === bulkId) return;
  const meta = (message.metadata ?? {}) as CcNoticeMetadata;
  records[key] = {
    bulkId,
    payload: {
      subtype: meta.subtype,
      tagId: meta.tagId ?? undefined,
      content: meta.content ?? undefined,
      senderNote: meta.senderNote ?? undefined,
      prNumber: meta.prNumber ?? params.prNumber,
      prUrl: meta.prUrl ?? "",
      resourceId: meta.resourceId ?? undefined,
      resourceName: meta.resourceName ?? undefined,
      deepLink: meta.deepLink ?? undefined,
      userIds: params.userIds,
      title: message.title,
      body: message.body,
    },
  };
  persistBulkRecords(records);
  const sentKeys = loadSentKeys();
  if (!sentKeys.has(key)) {
    sentKeys.add(key);
    persistSentKeys(sentKeys);
  }
}

/**
 * 服务端 /admin/inbox 没有按 metadata 过滤的能力，只能按收件人 + kind 拉取后
 * 在客户端匹配。list 已支持 cursor（服务端转成 createdAt < cursor），所以这里
 * 翻页取全；封顶页数避免极端情况下请求过多。
 */
const CC_NOTICE_PAGE_SIZE = 100;
const CC_NOTICE_MAX_PAGES = 10;

async function fetchCcNotices(userIds: string[]): Promise<InboxMessage[]> {
  const perUser = await Promise.all(
    userIds.map(async (userId) => {
      const collected: InboxMessage[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < CC_NOTICE_MAX_PAGES; page += 1) {
        const response = await AdminApi.inbox.list({
          userId,
          kind: "cc-notice",
          limit: CC_NOTICE_PAGE_SIZE,
          cursor,
        });
        collected.push(...response.items);
        if (!response.hasMore || !response.nextCursor) break;
        cursor = response.nextCursor;
      }
      return collected;
    }),
  );
  return perUser.flat();
}

/**
 * 检测一批审核通知是否真的送达了 AstroBox 信箱。
 * 以本机发送记录为准（发送动作发生在审核人设备上，本地记录是直接证据），
 * 再用服务端 /admin/inbox 做补充确认并回填 bulkId；完全找不到收件人时标记
 * unmatched，区别于「有收件人但没送达」；连信箱都读不到时标记 unverified，
 * 不再断言「没有发送」，避免权限不足/断网被误报成漏发。
 */
export async function inspectCcNotices(params: {
  prNumber: number;
  userIds: string[];
  targets: CcNoticeCheckTarget[];
}): Promise<Map<string, CcNoticeDeliveryStatus>> {
  const result = new Map<string, CcNoticeDeliveryStatus>();
  if (params.targets.length === 0) return result;

  for (const target of params.targets) {
    result.set(target.key, { state: "unsent" });
  }

  // 本地发送记录：任何情况下都参与判定，避免服务端查询成功后反而把
  // 「本机确实发过」的通知判成未送达。
  const records = loadBulkRecords();
  for (const target of params.targets) {
    const record = records[target.key];
    if (!record?.bulkId) continue;
    if (!noticeContentMatches(record.payload.content, target.content)) continue;
    result.set(target.key, { state: "sent", bulkId: record.bulkId });
  }

  // 待补发队列里还挂着、且本地没有成功记录的，标记为待发送。
  for (const target of params.targets) {
    if (result.get(target.key)?.state === "sent") continue;
    if (isPendingInQueue(target.key)) {
      result.set(target.key, { state: "pending" });
    }
  }

  if (params.userIds.length === 0) {
    // 收件人都没解析出来，通知根本不可能发出去，单独标记以便提示作者未绑定。
    for (const target of params.targets) {
      if (result.get(target.key)?.state === "sent") continue;
      result.set(target.key, { state: "unmatched" });
    }
    return result;
  }

  let messages: InboxMessage[];
  try {
    messages = await fetchCcNotices(params.userIds);
  } catch {
    // 读不到信箱（权限不足 / 断网）：只能说「未能校验」，不能说「没有发送」。
    for (const target of params.targets) {
      if (result.get(target.key)?.state === "sent") continue;
      result.set(target.key, { state: "unverified" });
    }
    return result;
  }

  // 服务端 adminList 不过滤 deletedByUserAt（用户侧 listForUser 会过滤），
  // 创作者自己删掉的通知不能算送达，这里在客户端补上过滤。
  const alive = messages.filter(
    (item) =>
      !item.deletedByAdminAt &&
      !item.deletedByUserAt &&
      !item.deletedBySystemAt,
  );

  for (const target of params.targets) {
    if (result.get(target.key)?.state === "sent") continue;
    const hit = alive.find(
      (item) =>
        typeof item.bulkId === "string" &&
        (item.metadata as CcNoticeMetadata | null)?.subtype === target.subtype &&
        ((item.metadata as CcNoticeMetadata | null)?.tagId ?? "") ===
          (target.tagId ?? "") &&
        (item.metadata as CcNoticeMetadata | null)?.prNumber === params.prNumber &&
        noticeContentMatches(
          (item.metadata as CcNoticeMetadata | null)?.content,
          target.content,
        ),
    );
    if (!hit) continue;
    adoptServerRecord(target.key, hit, params);
    result.set(target.key, { state: "sent", bulkId: hit.bulkId ?? undefined });
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

/**
 * 本机没有发送记录时，按业务键（kind + metadata.subtype/prNumber/tagId）从服务端
 * 把那条消息捞回来。服务端 /admin/inbox 只能按收件人 + kind 过滤，metadata 只能
 * 在客户端匹配，所以这里沿用 inspectCcNotices 相同的比对规则；已软删的不算。
 */
async function recoverCcNoticeMessage(
  params: {
    subtype: CcNoticeSubtype;
    prNumber: number;
    tagId?: string;
  },
  userIds: string[],
): Promise<InboxMessage | null> {
  if (userIds.length === 0) return null;
  let messages: InboxMessage[];
  try {
    messages = await fetchCcNotices(userIds);
  } catch {
    // 读不到信箱（权限不足 / 断网）时不能当成"没有发过"，交给调用方报错
    return null;
  }
  return (
    messages.find(
      (item) =>
        typeof item.bulkId === "string" &&
        (item.metadata as CcNoticeMetadata | null)?.subtype ===
          params.subtype &&
        ((item.metadata as CcNoticeMetadata | null)?.tagId ?? "") ===
          (params.tagId ?? "") &&
        (item.metadata as CcNoticeMetadata | null)?.prNumber ===
          params.prNumber &&
        !item.deletedByAdminAt &&
        !item.deletedByUserAt &&
        !item.deletedBySystemAt,
    ) ?? null
  );
}

/**
 * 撤回此前发送的通知批次，并清除幂等记录，使后续可重新发送。
 *
 * 顺序要求：必须先确认撤回成功，再清本地记录与幂等键。反过来会出现
 * "记录已清、消息还在"，之后再发送会被当成没发过，给用户重复投递。
 *
 * 本机没有记录时（换设备 / 清过缓存 / 旧版本发的）也不静默跳过，而是按业务键
 * 从服务端恢复撤回句柄；仍找不到则抛错，由调用方中止重发并提示人工处理。
 */
export async function revokeCcNotice(params: {
  subtype: CcNoticeSubtype;
  prNumber: number;
  tagId?: string;
  /** 传入后，本机无记录时可据此从服务端恢复撤回句柄 */
  userIds?: string[];
}): Promise<void> {
  // 用 buildNoticeKey 而不是 idempotencyKey：后者要求完整 CcNoticePayload，
  // 而这里只掌握了业务键三元组。
  const key = buildNoticeKey(params.subtype, params.prNumber, params.tagId);
  let bulkId = loadBulkRecords()[key]?.bulkId;

  if (!bulkId) {
    const recovered = await recoverCcNoticeMessage(
      params,
      params.userIds ?? [],
    );
    if (!recovered?.bulkId) {
      throw new Error(
        "本机没有这条审核通知的发送记录，无法自动撤回。请到信箱管理页按标题或收件人手动撤回。",
      );
    }
    bulkId = recovered.bulkId;
    // 回填本机记录，后续撤回就不用再走服务端查询
    adoptServerRecord(key, recovered, {
      prNumber: params.prNumber,
      userIds: params.userIds ?? [],
    });
  }

  // 失败直接抛出：本地记录与幂等键保持原样，重发不会和撤回脱节
  await AdminApi.inbox.bulkDelete(bulkId);

  dropSentRecord(key);
  const sentKeys = loadSentKeys();
  sentKeys.delete(key);
  persistSentKeys(sentKeys);
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

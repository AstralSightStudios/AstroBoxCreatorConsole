import type { CcNoticePayload } from "./send";
import type { CcNoticeSubtype } from "./types";

/**
 * 一条「批量关闭 PR 时 AstroBox 信箱通知没发出去」的记录。
 *
 * 只承载发送失败（POST 失败已入待补发队列）的通知；作者未绑定账号（skipped）不算失败，
 * 不进入这里。台账严格设备本地（localStorage），与已有的发送记录/待补发队列一致；
 * 换设备看不到，也不承诺跨设备同步。
 */
export interface CcNoticeFailure {
  subtype: CcNoticeSubtype;
  prNumber: number;
  /** PR 标题，用于在失败抽屉里展示。 */
  title: string;
  /** 失败原因（网络/服务端报错）。 */
  error?: string;
  /** 完整 payload，重试时直接复用，避免重新解析收件人。 */
  payload: CcNoticePayload;
  failedAt: string;
}

const STORAGE_KEY = "CC_NOTICE_BATCH_FAILURES_V1";

function read(): CcNoticeFailure[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CcNoticeFailure[]) : [];
  } catch {
    return [];
  }
}

function write(items: CcNoticeFailure[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/** 同一 subtype + PR 视为同一条，重复失败时覆盖而非堆叠。 */
function failureKey(item: Pick<CcNoticeFailure, "subtype" | "prNumber">): string {
  return `${item.subtype}:${item.prNumber}`;
}

export function loadCcNoticeFailures(): CcNoticeFailure[] {
  return read();
}

export function addCcNoticeFailures(items: CcNoticeFailure[]): void {
  if (items.length === 0) return;
  const byKey = new Map(read().map((item) => [failureKey(item), item]));
  for (const item of items) byKey.set(failureKey(item), item);
  write(Array.from(byKey.values()));
}

export function removeCcNoticeFailure(
  item: Pick<CcNoticeFailure, "subtype" | "prNumber">,
): void {
  const key = failureKey(item);
  write(read().filter((entry) => failureKey(entry) !== key));
}

export function clearCcNoticeFailures(): void {
  write([]);
}

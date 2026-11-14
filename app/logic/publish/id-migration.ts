/**
 * 资源换 ID 的状态说明，以及登记失败时给创作者看的原因。
 * 流程见 AstroBoxServer docs/resource-id-migration.md：提交 PR 前登记 → PR 合入后服务端
 * 把旧 ID 上的数据搬到新 ID → 客户端提示装着旧 ID 的用户卸载旧资源、安装新资源。
 */
import type { IdMigrationRecord } from "~/api/astrobox/resource";

const REJECT_REASON_TEXT: Record<string, string> = {
  source_still_listed:
    "合入后新旧两个 ID 同时在架。换 ID 必须是把目录里原来那一行改成新 ID，而不是另外新增一个资源",
  author_mismatch: "新 ID 的第一作者与登记时不一致",
  target_exists: "新 ID 上已经有自己的统计或订单数据",
};

const INTENT_ERROR_TEXT: Record<string, string> = {
  invalid_from_id: "原资源 ID 格式不正确",
  invalid_to_id: "新资源 ID 格式不正确",
  forbidden: "你不是这个资源的主作者，不能修改它的 ID",
  source_not_listed: "原资源 ID 不在官方目录里",
  target_listed: "新 ID 已被目录里的其他资源占用（不区分大小写）",
  target_used: "新 ID 曾经被使用过，上面还留有统计或订单数据，请换一个",
  target_reserved: "已经有别的资源登记要换成这个 ID，请换一个",
};

/** 登记换 ID 时服务端返回的错误码译成中文；不认识的原样返回。 */
export function describeIdMigrationIntentError(message: string): string {
  const code = message.trim();
  const text = INTENT_ERROR_TEXT[code];
  return text ? `${text}（${code}）` : message;
}

export type IdMigrationTone = "pending" | "applied" | "rejected";

export interface IdMigrationNote {
  tone: IdMigrationTone;
  text: string;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 一条换 ID 记录在表单里怎么描述。 */
export function describeIdMigrationRecord(record: IdMigrationRecord): IdMigrationNote {
  const route = `「${record.fromId}」→「${record.toId}」`;
  if (record.status === "applied") {
    const date = formatDate(record.appliedAt);
    return {
      tone: "applied",
      text: `${route} 已${date ? `于 ${date} ` : ""}迁移完成，旧 ID 上的数据已并入新 ID。`,
    };
  }
  if (record.status === "rejected") {
    const reason = record.reason ? (REJECT_REASON_TEXT[record.reason] ?? record.reason) : "原因未知";
    return {
      tone: "rejected",
      text: `${route} 的迁移被拒绝：${reason}。数据仍留在旧 ID 上，如需继续请重新提交。`,
    };
  }
  const expires = formatDate(record.expiresAt);
  return {
    tone: "pending",
    text: `${route} 已登记，PR 合入后自动迁移${expires ? `（登记有效至 ${expires}）` : ""}。`,
  };
}

/**
 * 表单里要展示哪些记录：还没生效的登记、被拒的，以及最近一次已完成的迁移。
 * 更早的已完成记录只是历史，不占地方。
 */
export function summarizeIdMigrations(records: readonly IdMigrationRecord[]): IdMigrationNote[] {
  const notes: IdMigrationNote[] = [];
  let appliedShown = false;
  for (const record of records) {
    if (record.status === "applied") {
      if (appliedShown) continue;
      appliedShown = true;
    }
    notes.push(describeIdMigrationRecord(record));
  }
  return notes;
}

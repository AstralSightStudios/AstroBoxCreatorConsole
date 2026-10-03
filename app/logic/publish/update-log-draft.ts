export type UpdateLogDraft = {
  id: string;
  version: string;
  content: string;
};

export function createUpdateLogDraft(
  version: string,
  content = "",
): UpdateLogDraft {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, version, content };
}

/** 按去掉首尾空白后的版本号找出重复项。空字符串也算一种版本。 */
export function duplicateUpdateLogVersions(
  entries: readonly { version: string }[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const version = entry.version.trim();
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [version, count] of counts) {
    if (count > 1) duplicates.add(version);
  }
  return duplicates;
}

/**
 * 新日志默认使用当前导入包的版本号。该版本已经存在时留空，
 * 方便继续添加其他版本，而不是拦住添加。
 */
export function nextUpdateLogVersion(
  entries: readonly { version: string }[],
  packageVersion: string,
): string {
  const version = packageVersion.trim();
  if (!version) return "";
  const taken = entries.some((entry) => entry.version.trim() === version);
  return taken ? "" : version;
}

/**
 * 与预览图排序相同：把 fromId 移到 toId 当前所在的位置。
 * 相邻两项因此会交换位置。
 */
export function reorderById<T extends { id: string }>(
  entries: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  const fromIndex = entries.findIndex((entry) => entry.id === fromId);
  const toIndex = entries.findIndex((entry) => entry.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return entries as T[];
  }
  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * 把 fromIndex 抽出来，插进「去掉该项之后」的第 slot 个缝。
 * slot 0 在最前，slot 等于剩余条数时在最后。
 */
export function moveToSlot<T>(
  items: readonly T[],
  fromIndex: number,
  slot: number,
): T[] {
  if (fromIndex < 0 || fromIndex >= items.length) return items as T[];
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  const index = Math.max(0, Math.min(Math.trunc(slot), next.length));
  if (index === fromIndex) return items as T[];
  next.splice(index, 0, moved);
  return next;
}

/** 拖动插入位置落到条目上。越过最后一条时，落点是最后一条。 */
export function reorderDropTargetId(
  ids: readonly string[],
  insertIndex: number,
): string | null {
  if (ids.length === 0) return null;
  const index = Math.min(Math.max(insertIndex, 0), ids.length - 1);
  return ids[index] ?? null;
}

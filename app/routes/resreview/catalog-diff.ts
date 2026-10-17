import {
  CATALOG_CSV_COLUMNS,
  normalizeCatalogEntryForCsv,
  type CatalogEntry,
} from "~/logic/publish/catalog";

export type CatalogField = keyof CatalogEntry;

/**
 * 以分号分隔、适合用胶囊（tag 样式）展示的列表型字段。
 * tags / device_vendors / devices 在目录里都是 `;` 连接。
 */
export const CATALOG_LIST_FIELDS: ReadonlySet<CatalogField> = new Set<CatalogField>([
  "tags",
  "device_vendors",
  "devices",
]);

/** 目录 CSV 的全部字段，按写入顺序排列，即横向表格的列顺序。 */
export const CATALOG_FIELDS: readonly CatalogField[] = CATALOG_CSV_COLUMNS;

export interface CatalogFieldChange {
  /** 目录 CSV 的原始字段名，直接作为表格行头展示。 */
  field: CatalogField;
  oldValue: string;
  newValue: string;
}

export type CatalogRowMode = "create" | "edit";

/** 按目录列顺序把 `;` 分隔的字段值拆成去空 token。 */
export function splitSemicolonTokens(value: string): string[] {
  return value
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * 逐字段比较目录行。`base` 缺省表示新增资源，此时所有非空字段都算「新增」。
 * 比较前统一走 `normalizeCatalogEntryForCsv`，避免 `paid_type: "free"` 与空串
 * 这类等价写法被误判成字段变化。
 */
export function diffCatalogEntries(
  base: CatalogEntry | undefined,
  next: CatalogEntry,
): CatalogFieldChange[] {
  const normalizedNext = normalizeCatalogEntryForCsv(next);
  const normalizedBase = base ? normalizeCatalogEntryForCsv(base) : undefined;

  const changes: CatalogFieldChange[] = [];
  for (const field of CATALOG_CSV_COLUMNS) {
    const oldValue = normalizedBase?.[field] ?? "";
    const newValue = normalizedNext[field] ?? "";
    if (oldValue === newValue) continue;
    changes.push({ field, oldValue, newValue });
  }
  return changes;
}

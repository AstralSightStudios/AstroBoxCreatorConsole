import { useMemo } from "react";
import { PUBLISH_CONFIG } from "~/config/publish";
import { normalizeCatalogEntryForCsv, type CatalogEntry } from "~/logic/publish/catalog";
import { formatResourceType } from "~/logic/publish/resource-type";
import { ScrollArea } from "~/components/scroll-area";
import type { PrResourcePreview } from "../types";
import {
  CATALOG_FIELDS,
  CATALOG_LIST_FIELDS,
  diffCatalogEntries,
  splitSemicolonTokens,
  type CatalogField,
  type CatalogRowMode,
} from "../catalog-diff";

interface CatalogRowDiff {
  mode: CatalogRowMode;
  /** 目标仓库当前目录行；create 模式下为空。 */
  base?: CatalogEntry;
  /** 本次提交的资源行。 */
  next: CatalogEntry;
  /** 发生变化的字段集合，用于高亮对应单元格。 */
  changed: Set<CatalogField>;
  /** edit 但未能在当前目录中定位将被替换的原行（original_id 匹配失败）。 */
  missingBase: boolean;
}

function buildCatalogRowDiff(resource: PrResourcePreview): CatalogRowDiff | null {
  const request = resource.request;
  if (!request) return null;

  const next = normalizeCatalogEntryForCsv(resource.entry);

  if (request.mode === "edit") {
    // 定位不到原行时无法逐字段对比，继续沿用人工核对提示。
    if (!resource.baseEntry) {
      return { mode: "edit", next, changed: new Set(), missingBase: true };
    }
    const base = normalizeCatalogEntryForCsv(resource.baseEntry);
    const changed = new Set(
      diffCatalogEntries(base, next).map((change) => change.field),
    );
    return {
      mode: "edit",
      base,
      next,
      changed,
      missingBase: false,
    };
  }

  const changed = new Set(
    diffCatalogEntries(undefined, next).map((change) => change.field),
  );
  return {
    mode: "create",
    next,
    changed,
    missingBase: false,
  };
}

/** 付费类型：空串与 free 等价（目录里视为免费）。 */
function formatPaidType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "free") return "免费";
  if (normalized === "paid") return "付费";
  if (normalized === "force_paid") return "强制付费";
  return value;
}

function formatPlainValue(field: CatalogField, value: string): string {
  if (field === "paid_type") return formatPaidType(value);
  if (!value) return "—";
  if (field === "restype") return formatResourceType(value);
  return value;
}

/**
 * 单元格内容：列表型字段（tags / device_vendors / devices）用胶囊展示，
 * 与发布页标签的显示方式保持一致；其余字段按类型格式化后纯文本展示。
 */
function CatalogFieldValue({
  field,
  value,
  counterpartTokens,
  tone,
}: {
  field: CatalogField;
  value: string;
  /** 对侧单元格的 token 集合，用于标出本侧新增 / 删除项。 */
  counterpartTokens: string[];
  tone: "old" | "new";
}) {
  if (CATALOG_LIST_FIELDS.has(field)) {
    const tokens = splitSemicolonTokens(value);
    if (tokens.length === 0) return <span className="text-white/35">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {tokens.map((token, index) => {
          const changed = !counterpartTokens.includes(token);
          const toneClass =
            tone === "old"
              ? "border-red-400/30 bg-red-500/10 text-red-200 line-through"
              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
          const neutralClass = "border-white/10 bg-white/5 text-white/75";
          return (
            <span
              key={`${token}-${index}`}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                changed ? toneClass : neutralClass
              }`}
            >
              {token}
            </span>
          );
        })}
      </div>
    );
  }

  const display = formatPlainValue(field, value);
  return <span className={value ? "text-white/85" : "text-white/35"}>{display}</span>;
}

/**
 * 横向表格：表头是目录 CSV 的全部字段，数据行为各来源行，首列用 `-` 表示当前目录、
 * `+` 表示本次提交。变更字段所在的单元格高亮（`-` 行红、`+` 行绿），
 * 列宽按内容展开、超出容器时横向滚动。
 */
function CatalogChangeTable({ diff }: { diff: CatalogRowDiff }) {
  const isEdit = diff.mode === "edit";

  const valueOf = (entry: CatalogEntry | undefined, field: CatalogField): string =>
    entry?.[field] ?? "";

  const renderRow = (
    symbol: "-" | "+",
    entry: CatalogEntry | undefined,
    counterpart: CatalogEntry | undefined,
    tone: "old" | "new",
  ) => (
    <tr>
      <th
        scope="row"
        title={tone === "old" ? "当前目录" : "本次提交"}
        aria-label={tone === "old" ? "当前目录" : "本次提交"}
        className={`w-6 select-none border-b border-r border-white/5 py-1.5 text-center font-mono-sarasa text-sm font-semibold ${
          tone === "old" ? "text-red-300" : "text-emerald-300"
        }`}
      >
        {symbol}
      </th>
      {CATALOG_FIELDS.map((field) => {
        const changed = diff.changed.has(field);
        const value = valueOf(entry, field);
        const counterpartTokens = CATALOG_LIST_FIELDS.has(field)
          ? splitSemicolonTokens(valueOf(counterpart, field))
          : [];
        return (
          <td
            key={field}
            className={`border-b border-white/5 px-3 py-1.5 align-top font-mono-sarasa ${
              changed ? (tone === "old" ? "bg-red-500/10" : "bg-emerald-500/10") : ""
            }`}
          >
            <CatalogFieldValue
              field={field}
              value={value}
              counterpartTokens={counterpartTokens}
              tone={tone}
            />
          </td>
        );
      })}
    </tr>
  );

  return (
    <ScrollArea
      horizontal
      className="max-w-full overflow-hidden rounded border border-white/10 bg-black/30"
    >
      <table className="min-w-max border-collapse text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="w-6 border-b border-r border-white/10 py-1.5 text-center font-medium text-white/45"
            ></th>
            {CATALOG_FIELDS.map((field) => (
              <th
                key={field}
                className="border-b border-white/10 px-3 py-1.5 text-left font-medium font-mono-sarasa text-white/55"
              >
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEdit && renderRow("-", diff.base, diff.next, "old")}
          {renderRow("+", diff.next, diff.base, "new")}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/**
 * staging 提交的 PR 只新增 tmp/ 下文件，GitHub 文件 diff 看不出目录将如何变化。
 * 这里用目标仓库当前最新的 index_v2.csv 行对比创作者提交的 resource.csv 行，
 * 以横向表格展示整行全部字段，并高亮发生变化的单元格（tag 等列表字段用胶囊展示）。
 * 每条 staging 资源都会展示，行内容无变化时表格照常渲染、只是没有任何高亮。
 */
export function CatalogRowChanges({
  resources,
  onFileComment,
}: {
  resources: PrResourcePreview[];
  onFileComment?: (path: string) => void;
}) {
  const items = useMemo(
    () =>
      resources
        .map((resource) => ({ resource, diff: buildCatalogRowDiff(resource) }))
        .filter(
          (item): item is { resource: PrResourcePreview; diff: CatalogRowDiff } =>
            Boolean(item.diff),
        ),
    [resources],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">index_v2.csv 目录行改动预览</h3>
        <p className="mt-0.5 text-xs text-white/45">
          对比目标仓库当前最新目录行与本次 tmp 提交的资源行，高亮发生变化的字段。
        </p>
      </div>
      {items.map(({ resource, diff }) => (
        <div
          key={`${resource.entry.id}-${diff.mode}`}
          className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 p-3 text-sm">
            <span className="min-w-0 break-all font-mono-sarasa text-white">
              {PUBLISH_CONFIG.catalogFilePath}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                diff.mode === "create"
                  ? "bg-emerald-500/15 text-emerald-200/80"
                  : "bg-amber-500/15 text-amber-200/80"
              }`}
            >
              {diff.mode === "create" ? "新增行" : "更新行"}
            </span>
            {(resource.entry.name || resource.entry.id) && (
              <span className="ml-auto min-w-0 truncate text-xs text-white/45">
                {resource.entry.name || resource.entry.id}
                {resource.entry.id && resource.entry.name ? `（${resource.entry.id}）` : ""}
              </span>
            )}
            {onFileComment && (
              <button
                className="shrink-0 rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-blue-300 transition"
                onClick={(e) => {
                  e.stopPropagation();
                  onFileComment(PUBLISH_CONFIG.catalogFilePath);
                }}
                title="Comment on this file"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'text-bottom' }}>
                  <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                </svg>
              </button>
            )}
          </div>
          <div className="border-t border-white/10 p-3">
            {diff.missingBase ? (
              <p className="text-xs text-amber-300">
                未能在当前 index_v2.csv 中定位将被替换的原行（original_id 匹配失败），请人工核对后再合入。
              </p>
            ) : (
              <CatalogChangeTable diff={diff} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

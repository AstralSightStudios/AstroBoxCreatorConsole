import { useMemo } from "react";
import { PUBLISH_CONFIG } from "~/config/publish";
import {
  CATALOG_CSV_COLUMNS,
  serializeCatalogEntry,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import type { PrResourcePreview } from "../types";
import { DiffBlock } from "./FileEntry";

interface CatalogRowDiff {
  mode: "create" | "edit";
  newRow: string;
  /** 当前 index_v2.csv 中将被替换的最新行；edit 但未匹配到时为 null。 */
  currentRow?: string | null;
}

function serializeEntryRow(entry: CatalogEntry): string {
  try {
    return serializeCatalogEntry(entry);
  } catch {
    return CATALOG_CSV_COLUMNS.map((column) => String(entry[column] ?? "")).join(",");
  }
}

function buildCatalogRowDiff(resource: PrResourcePreview): CatalogRowDiff | null {
  const request = resource.request;
  if (!request) return null;
  const newRow = serializeEntryRow(resource.entry);
  if (!newRow.trim()) return null;
  return {
    mode: request.mode,
    newRow,
    currentRow: resource.baseEntry ? serializeEntryRow(resource.baseEntry) : null,
  };
}

function buildPatch(diff: CatalogRowDiff): string {
  const lines: string[] = [];
  if (diff.mode === "edit" && diff.currentRow) lines.push(`-${diff.currentRow}`);
  lines.push(`+${diff.newRow}`);
  return lines.join("\n");
}

/**
 * staging 提交的 PR 只新增 tmp/ 下文件，GitHub 文件 diff 看不出目录将如何变化。
 * 这里用目标仓库当前最新的 index_v2.csv 行对比创作者提交的 resource.csv 行，
 * 让审核者直接看到标签等仅存在于目录中的字段改动。
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
        .filter((item): item is { resource: PrResourcePreview; diff: CatalogRowDiff } =>
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
          对比目标仓库当前最新目录行与本次 tmp 提交的资源行。
        </p>
      </div>
      {items.map(({ resource, diff }) => {
        const unchanged =
          diff.mode === "edit" && diff.currentRow != null && diff.currentRow === diff.newRow;
        const missingBase = diff.mode === "edit" && diff.currentRow == null;
        return (
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
              {unchanged ? (
                <p className="text-xs text-white/45">
                  提交的资源行与当前最新目录行一致，本次不会产生目录字段变化。
                </p>
              ) : missingBase ? (
                <p className="text-xs text-amber-300">
                  未能在当前 index_v2.csv 中定位将被替换的原行（original_id 匹配失败），请人工核对后再合入。
                </p>
              ) : (
                <DiffBlock patch={buildPatch(diff)} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

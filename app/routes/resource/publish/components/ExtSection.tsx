import { Badge, Button, Dialog, Spinner, Switch, TextField } from "@radix-ui/themes";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "./shared";
import type { BundledResourceInput } from "./types";
import {
  fetchCatalogEntries,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import { loadAccountState } from "~/logic/account/store";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import { formatResourceType } from "~/logic/publish/resource-type";

interface ExtSectionProps {
  extRaw: string;
  extError: string;
  enableAstroBoxCreatorFeatures: boolean;
  bundledResources: BundledResourceInput[];
  selfResourceId?: string;
  onAddBundledResources: (resources: BundledResourceInput[]) => void;
  onRemoveBundledResource: (id: string) => void;
  onChange: (value: string) => void;
  onToggleCreatorFeatures: (value: boolean) => void;
}

interface CatalogContext {
  entries: CatalogEntry[];
  owner: string;
  repo: string;
  ref: string;
}

function entrySearchText(entry: CatalogEntry): string[] {
  return [
    entry.name || "",
    entry.id || "",
    entry.tags || "",
    formatResourceType(entry.restype),
  ].map((text) => text.toLowerCase());
}

function entryMatchScore(entry: CatalogEntry, tokens: string[]): number | null {
  if (tokens.length === 0) return 0;
  const [name = "", id = "", tags = "", typeLabel = ""] = entrySearchText(entry);
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 100;
    else if (id.includes(token)) score += 60;
    else if (tags.includes(token)) score += 30;
    else if (typeLabel.includes(token)) score += 20;
    else return null;
  }
  return score;
}

function sortEntriesForDisplay(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort(
    (a, b) => (a.name || a.id).localeCompare(b.name || b.id, "zh-Hans"),
  );
}

export function ExtSection({
  extRaw,
  extError,
  enableAstroBoxCreatorFeatures,
  bundledResources,
  selfResourceId,
  onAddBundledResources,
  onRemoveBundledResource,
  onChange,
  onToggleCreatorFeatures,
}: ExtSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogContext | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const loadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const token = loadAccountState().github?.token || undefined;
      const result = await fetchCatalogEntries({ token });
      setCatalog({
        entries: result.entries,
        owner: result.owner,
        repo: result.repo,
        ref: result.ref,
      });
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (!pickerOpen || catalog || catalogLoading) return;
    void loadCatalog();
  }, [pickerOpen]);

  const selectableEntries = useMemo(() => {
    if (!catalog) return [];
    const excluded = new Set(
      bundledResources.map((item) => item.id).filter(Boolean),
    );
    if (selfResourceId?.trim()) excluded.add(selfResourceId.trim());
    return catalog.entries.filter((entry) => entry.id && !excluded.has(entry.id));
  }, [catalog, bundledResources, selfResourceId]);

  const searchTokens = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [query],
  );

  const filteredEntries = useMemo(() => {
    if (searchTokens.length === 0) return sortEntriesForDisplay(selectableEntries);
    return selectableEntries
      .map((entry) => ({ entry, score: entryMatchScore(entry, searchTokens) }))
      .filter((item): item is { entry: CatalogEntry; score: number } => item.score !== null)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.entry.name || a.entry.id).localeCompare(
            b.entry.name || b.entry.id,
            "zh-Hans",
          ),
      )
      .map((item) => item.entry);
  }, [selectableEntries, searchTokens]);

  const pendingCount = pendingIds.size;

  const commitSelection = () => {
    if (!catalog || pendingIds.size === 0) {
      setPickerOpen(false);
      return;
    }
    const byId = new Map(catalog.entries.map((e) => [e.id, e]));
    const additions: BundledResourceInput[] = [];
    for (const id of pendingIds) {
      const entry = byId.get(id);
      if (entry) {
        additions.push({
          type: "resource",
          id: entry.id,
          name: entry.name || undefined,
        });
      }
    }
    if (additions.length > 0) onAddBundledResources(additions);
    setPendingIds(new Set());
    setQuery("");
    setPickerOpen(false);
  };

  const togglePending = (id: string) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const iconUrlFor = (entry: CatalogEntry) => {
    if (!catalog || !entry.icon) return "";
    return buildRawFileUrl(catalog.owner, catalog.repo, catalog.ref, entry.icon);
  };

  return (
    <SectionCard
      title="扩展字段 (ext)"
      description="结构化扩展字段会自动写入 ext；这里的 JSON 仅用于补充其他自定义字段。"
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-white">
                启用购买与资源加密相关功能
              </p>
              <p className="text-xs text-white/60">
                开启后客户端将尝试获取该资源的purchase_info。
              </p>
            </div>
            <Switch
              checked={enableAstroBoxCreatorFeatures}
              onCheckedChange={onToggleCreatorFeatures}
            />
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3 pb-1">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-white">前置资源绑定</p>
              <p className="text-xs text-white/60">
                声明本资源依赖的前置资源，客户端安装时会自动捆绑下载对应资源。
              </p>
            </div>
            <Button
              type="button"
              variant="soft"
              size="1"
              onClick={() => setPickerOpen(true)}
            >
              <PlusIcon size={14} weight="bold" />
              添加前置资源
            </Button>
          </div>
          {bundledResources.length === 0 ? (
            <p className="px-1 py-2 text-sm text-white/40">暂未绑定前置资源</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {bundledResources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm text-white">
                        {resource.name || resource.id}
                      </span>
                      <Badge color="gray" variant="soft" className="shrink-0">
                        {formatResourceType(resource.type)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-white/40">{resource.id}</p>
                  </div>
                  <button
                    type="button"
                    className="grid size-6 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/15 hover:text-white"
                    onClick={() => onRemoveBundledResource(resource.id)}
                    aria-label={`移除前置资源 ${resource.id}`}
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {extError && <p className="px-1 text-xs text-red-400">{extError}</p>}
      </div>

      <Dialog.Root
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPickerOpen(false);
            setPendingIds(new Set());
            setQuery("");
          }
        }}
      >
        <Dialog.Content className="flex max-w-[min(94vw,680px)] flex-col gap-4 p-5">
          <Dialog.Title className="m-0 min-w-0 text-base">
            选择前置资源
          </Dialog.Title>
          <TextField.Root
            placeholder="搜索资源名称 / ID / 标签，例如 蓝牙 播放器 canopus"
            value={query}
            radius="large"
            onChange={(e) => setQuery(e.target.value)}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon size={16} />
            </TextField.Slot>
          </TextField.Root>
          <div className="max-h-[420px] min-h-[240px] overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
            {catalogLoading && (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-white/50">
                <Spinner size="3" />
                正在加载资源目录…
              </div>
            )}
            {!catalogLoading && catalogError && (
              <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-sm text-white/50">
                资源目录加载失败：{catalogError}
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  onClick={() => void loadCatalog()}
                >
                  重试
                </Button>
              </div>
            )}
            {!catalogLoading && !catalogError && filteredEntries.length === 0 && (
              <p className="py-16 text-center text-sm text-white/40">
                {catalog ? "没有匹配的资源" : ""}
              </p>
            )}
            {!catalogLoading && !catalogError && filteredEntries.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {filteredEntries.slice(0, 200).map((entry) => {
                  const selected = pendingIds.has(entry.id);
                  const iconUrl = iconUrlFor(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        selected
                          ? "border-white/40 bg-white/15"
                          : "border-transparent bg-white/[0.03] hover:border-white/20 hover:bg-white/10"
                      }`}
                      onClick={() => togglePending(entry.id)}
                    >
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-black/30">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs text-white/30">无图标</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">
                          {entry.name || entry.id}
                        </span>
                        <span className="block truncate text-xs text-white/40">
                          {entry.id}
                        </span>
                      </span>
                      <Badge color="gray" variant="soft" className="shrink-0">
                        {formatResourceType(entry.restype)}
                      </Badge>
                    </button>
                  );
                })}
                {filteredEntries.length > 200 && (
                  <p className="py-2 text-center text-xs text-white/40">
                    仅显示前 200 个，输入关键词可缩小范围。
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => {
                setPickerOpen(false);
                setPendingIds(new Set());
                setQuery("");
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="solid"
              disabled={pendingCount === 0}
              onClick={commitSelection}
            >
              添加{pendingCount > 0 ? `（已选 ${pendingCount} 个）` : ""}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </SectionCard>
  );
}

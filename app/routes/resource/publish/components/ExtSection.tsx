import {
  Badge,
  Button,
  Dialog,
  SegmentedControl,
  Spinner,
  Switch,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  type FieldHelpItem,
  FieldHelpButton,
  FieldHelpDialog,
  SectionCard,
} from "./shared";
import type {
  BundledResourceInput,
  BundledResourceMode,
  BundledResourceType,
} from "./types";
import {
  fetchCatalogEntries,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import { loadAccountState } from "~/logic/account/store";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import { formatResourceType } from "~/logic/publish/resource-type";
import {
  fetchNgPluginIndex,
  ngPluginDisplayName,
  ngPluginIconUrl,
  type NgPluginIndexEntry,
} from "~/logic/publish/plugin-repo";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";

interface ExtSectionProps {
  extRaw: string;
  extError: string;
  enableAstroBoxCreatorFeatures: boolean;
  bundledResources: BundledResourceInput[];
  selfResourceId?: string;
  onAddBundledResources: (resources: BundledResourceInput[]) => void;
  onRemoveBundledResource: (id: string) => void;
  onToggleBundledResourceMode: (id: string, mode: BundledResourceMode) => void;
  onChange: (value: string) => void;
  onToggleCreatorFeatures: (value: boolean) => void;
}

function ProxiedIcon({ url }: { url: string }) {
  const resolved = useProxiedMediaUrl(url || undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (!url || failed) {
    return <span className="text-[10px] text-white/30">无图标</span>;
  }
  return (
    <img
      src={resolved}
      alt=""
      className="size-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const EXT_FIELD_HELP: FieldHelpItem[] = [
  {
    label: "启用购买与资源加密相关功能",
    description:
      "使用加密上传，或通过 AstroBox 配置付费相关功能时必须开启，否则客户端不解密包体。",
  },
  {
    label: "捆绑项的两种安装方式",
    description:
      "必需：用户安装本资源时必须一并安装；推荐：安装时展示可勾选项，由用户自行决定。点击已添加捆绑项上的「必需 / 推荐」徽章即可切换。",
  },
  {
    label: "捆绑资源与插件",
    description:
      "捆绑对象可以选择「资源」（来自资源目录 index_v2.csv）或「插件」（来自 AstroBox-NG-Plugin-Repo 索引）。资源无法捆绑自身。",
  },
  {
    label: "绑定项图标与存在性",
    description:
      "已添加的捆绑项会显示对应资源的图标与名称。若出现「目录中已不存在」的红色提示，说明该资源已被从资源目录删除，提交后 PR 审核会判定失败，请移除该捆绑项。",
  },
  {
    label: "ext 自定义 JSON",
    description:
      "这里的 JSON 仅用于补充其他自定义字段，会与结构化字段合并后写入 manifest。ext.bundledResources 由上方的捆绑配置自动生成，不要手写。",
  },
];

interface CatalogContext {
  entries: CatalogEntry[];
}

const LEGACY_ITEM_ID_PREFIX = "LegacyItem";

interface EntrySearchText {
  name: string;
  id: string;
  extra: string[];
}

function entrySearchText(entry: CatalogEntry): EntrySearchText {
  return {
    name: (entry.name || "").toLowerCase(),
    id: (entry.id || "").toLowerCase(),
    extra: [
      entry.tags,
      entry.repo_name,
      entry.repo_owner,
      entry.icon,
      entry.cover,
      entry.repo_commit_hash,
    ].map((text) => (text || "").toLowerCase()),
  };
}

function entryMatchScore(entry: CatalogEntry, tokens: string[]): number | null {
  if (tokens.length === 0) return 0;
  const { name, id, extra } = entrySearchText(entry);
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 100;
    else if (id.includes(token)) score += 60;
    else if (extra.some((text) => text.includes(token))) score += 30;
    else return null;
  }
  return score;
}

export function ExtSection({
  extRaw,
  extError,
  enableAstroBoxCreatorFeatures,
  bundledResources,
  selfResourceId,
  onAddBundledResources,
  onRemoveBundledResource,
  onToggleBundledResourceMode,
  onChange,
  onToggleCreatorFeatures,
}: ExtSectionProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogContext | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [pickerType, setPickerType] = useState<BundledResourceType>("resource");
  // 默认「推荐」：推荐是基础选项，强制安装是例外，避免误选把不必要的资源设为必需。
  const [pickerMode, setPickerMode] = useState<BundledResourceMode>("recommend");
  const [plugins, setPlugins] = useState<NgPluginIndexEntry[] | null>(null);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState("");
  const [pluginQuery, setPluginQuery] = useState("");
  const [pendingPluginNames, setPendingPluginNames] = useState<Set<string>>(
    new Set(),
  );

  const loadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const token = loadAccountState().github?.token || undefined;
      const result = await fetchCatalogEntries({ token });
      setCatalog({
        entries: result.entries,
      });
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogLoading(false);
    }
  };

  // 已选捆绑项需要展示图标与存在性校验，因此只要存在捆绑资源就提前拉目录，
  // 不必等用户打开选择器。
  const needsCatalog =
    pickerOpen ||
    bundledResources.some((item) => item.type === "resource");
  useEffect(() => {
    if (!needsCatalog || catalog || catalogLoading) return;
    void loadCatalog();
  }, [needsCatalog]);

  const loadPlugins = async () => {
    setPluginsLoading(true);
    setPluginsError("");
    try {
      const entries = await fetchNgPluginIndex();
      setPlugins(entries);
    } catch (error) {
      setPluginsError(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginsLoading(false);
    }
  };

  // 同理：已选插件捆绑项也要显示图标，存在即拉插件索引。
  const needsPlugins =
    (pickerOpen && pickerType === "plugin") ||
    bundledResources.some((item) => item.type === "plugin");
  useEffect(() => {
    if (!needsPlugins || plugins || pluginsLoading) return;
    void loadPlugins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPlugins]);

  const selectableEntries = useMemo(() => {
    if (!catalog) return [];
    const excluded = new Set(
      bundledResources.map((item) => item.id).filter(Boolean),
    );
    if (selfResourceId?.trim()) excluded.add(selfResourceId.trim());
    return catalog.entries
      .filter((entry) => entry.id && !excluded.has(entry.id))
      .filter((entry) => !entry.id.startsWith(LEGACY_ITEM_ID_PREFIX))
      .reverse();
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
    if (searchTokens.length === 0) return selectableEntries;
    return selectableEntries
      .map((entry) => ({ entry, score: entryMatchScore(entry, searchTokens) }))
      .filter((item): item is { entry: CatalogEntry; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  }, [selectableEntries, searchTokens]);

  const pendingCount =
    pickerType === "plugin" ? pendingPluginNames.size : pendingIds.size;

  const resetPickerTransient = () => {
    setPendingIds(new Set());
    setQuery("");
    setPendingPluginNames(new Set());
    setPluginQuery("");
  };

  const commitSelection = () => {
    const additions: BundledResourceInput[] = [];
    if (pickerType === "resource") {
      if (!catalog || pendingIds.size === 0) {
        setPickerOpen(false);
        return;
      }
      const byId = new Map(catalog.entries.map((e) => [e.id, e]));
      for (const id of pendingIds) {
        const entry = byId.get(id);
        if (entry) {
          additions.push({
            mode: pickerMode,
            type: "resource",
            id: entry.id,
            name: entry.name || undefined,
          });
        }
      }
    } else {
      for (const name of pendingPluginNames) {
        additions.push({
          mode: pickerMode,
          type: "plugin",
          id: name,
          name,
        });
      }
    }
    if (additions.length > 0) onAddBundledResources(additions);
    resetPickerTransient();
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
    if (!entry.icon) return "";
    const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
    return buildRawFileUrl(
      entry.repo_owner,
      entry.repo_name,
      ref,
      entry.icon,
    );
  };

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of catalog?.entries ?? []) {
      if (entry.id) map.set(entry.id, entry);
    }
    return map;
  }, [catalog]);

  const pluginByName = useMemo(() => {
    const map = new Map<string, NgPluginIndexEntry>();
    for (const plugin of plugins ?? []) {
      const name = ngPluginDisplayName(plugin);
      if (name) map.set(name, plugin);
    }
    return map;
  }, [plugins]);

  /** 已选捆绑项的展示信息：名称 / 图标 / 类型 / 是否仍存在于目录或插件索引。 */
  const bundledDetails = useMemo(
    () =>
      bundledResources.map((item) => {
        if (item.type === "plugin") {
          const key = item.name || item.id;
          const plugin = pluginByName.get(key);
          return {
            resource: item,
            displayName: plugin ? ngPluginDisplayName(plugin) : key,
            typeLabel: plugin?.manifest?.version
              ? `插件 v${plugin.manifest.version}`
              : "插件",
            iconUrl: plugin ? ngPluginIconUrl(plugin) : "",
            missing: plugins != null && !plugin,
          };
        }
        const entry = catalogById.get(item.id);
        return {
          resource: item,
          displayName: entry?.name || item.name || item.id,
          typeLabel: entry ? formatResourceType(entry.restype) : "资源",
          iconUrl: entry ? iconUrlFor(entry) : "",
          missing: catalog != null && !entry,
        };
      }),
    [bundledResources, catalog, catalogById, plugins, pluginByName],
  );

  const missingBundledCount = bundledDetails.filter((d) => d.missing).length;

  const pluginSearchTokens = useMemo(
    () =>
      pluginQuery
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [pluginQuery],
  );

  const selectablePlugins = useMemo(() => {
    if (!plugins) return [];
    const excluded = new Set(
      bundledResources
        .filter((item) => item.type === "plugin")
        .map((item) => item.name || item.id || ""),
    );
    return plugins.filter((plugin) => {
      const name = ngPluginDisplayName(plugin);
      return Boolean(name) && !excluded.has(name);
    });
  }, [plugins, bundledResources]);

  const filteredPlugins = useMemo(() => {
    if (pluginSearchTokens.length === 0) return selectablePlugins;
    return selectablePlugins.filter((plugin) => {
      const haystack = [
        plugin.manifest?.name,
        plugin.manifest?.description,
        plugin.manifest?.author,
      ]
        .map((text) => (text || "").toLowerCase())
        .join("\n");
      return pluginSearchTokens.every((token) => haystack.includes(token));
    });
  }, [selectablePlugins, pluginSearchTokens]);

  return (
    <SectionCard
      title="扩展字段 (ext)"
      description="结构化扩展字段会自动写入 ext；这里的 JSON 仅用于补充其他自定义字段。"
      headerExtra={
        <FieldHelpButton
          onClick={() => setHelpOpen(true)}
          title="扩展字段说明"
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-white">
                启用购买与资源加密相关功能
              </p>
              <p className="text-xs text-white/60">
                使用加密上传，或通过 AstroBox 配置付费相关功能时必须开启本开关，否则客户端不解密包体。
              </p>
            </div>
            <Switch
              checked={enableAstroBoxCreatorFeatures}
              onCheckedChange={onToggleCreatorFeatures}
            />
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3 pb-1">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-white">捆绑资源配置</p>
              <p className="text-xs text-white/60">
                必需：安装本资源时必须同时安装；推荐：用户安装时可自行勾选。支持捆绑资源与插件。
              </p>
            </div>
            <Button
              type="button"
              variant="soft"
              size="1"
              className="shrink-0 text-xs!"
              onClick={() => setPickerOpen(true)}
            >
              <PlusIcon size={14} weight="bold" />
              添加捆绑项
            </Button>
          </div>
          {missingBundledCount > 0 && (
            <p className="mt-1 text-xs text-red-400">
              有 {missingBundledCount} 个捆绑项已不在
              {bundledResources.some((item) => item.type === "plugin")
                ? "资源目录 / 插件索引"
                : "资源目录"}
              中，提交后 PR 审核会判定失败，请移除。
            </p>
          )}
          {bundledResources.length === 0 ? (
            <p className="px-1 py-2 text-sm text-white/40">暂未配置捆绑项</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {bundledDetails.map((detail) => {
                const resource = detail.resource;
                return (
                  <div
                    key={`${resource.type}:${resource.id}`}
                    className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                      detail.missing
                        ? "border-red-400/40 bg-red-500/10"
                        : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-black/30">
                      <ProxiedIcon url={detail.iconUrl} />
                    </span>
                    {/* min-w-0 + flex-wrap：徽章在窄屏换行而非撑破容器 */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 max-w-full truncate text-sm text-white">
                          {detail.displayName}
                        </span>
                        <Badge color="gray" variant="soft" className="shrink-0">
                          {detail.typeLabel}
                        </Badge>
                        <Badge
                          color={resource.mode === "required" ? "red" : "grass"}
                          variant="soft"
                          className="shrink-0 cursor-pointer select-none"
                          onClick={() =>
                            onToggleBundledResourceMode(
                              resource.id,
                              resource.mode === "required"
                                ? "recommend"
                                : "required",
                            )
                          }
                        >
                          {resource.mode === "required" ? "必需" : "推荐"}
                        </Badge>
                        {detail.missing && (
                          <Badge color="red" variant="soft" className="shrink-0">
                            目录中已不存在
                          </Badge>
                        )}
                      </div>
                      <p className="min-w-0 max-w-full truncate text-xs text-white/40">
                        {resource.id}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="grid size-6 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/15 hover:text-white"
                      onClick={() => onRemoveBundledResource(resource.id)}
                      aria-label={`移除捆绑项 ${resource.id}`}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                );
              })}
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
            resetPickerTransient();
          }
        }}
      >
        <Dialog.Content
          maxWidth="var(--ui-viewport-width)"
          className="flex w-[min(calc(var(--ui-viewport-width)-2rem),680px)]! max-w-none! flex-col gap-4 overflow-hidden p-4 sm:p-5"
        >
          <Dialog.Title className="m-0 min-w-0 text-base">
            添加捆绑项
          </Dialog.Title>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-white/70">
              捆绑对象
              <SegmentedControl.Root
                value={pickerType}
                onValueChange={(val) => setPickerType(val as BundledResourceType)}
                size="1"
              >
                <SegmentedControl.Item value="resource">资源</SegmentedControl.Item>
                <SegmentedControl.Item value="plugin">插件</SegmentedControl.Item>
              </SegmentedControl.Root>
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              安装方式
              <SegmentedControl.Root
                value={pickerMode}
                onValueChange={(val) => setPickerMode(val as BundledResourceMode)}
                size="1"
              >
                <SegmentedControl.Item value="recommend">推荐</SegmentedControl.Item>
                <SegmentedControl.Item value="required">必需</SegmentedControl.Item>
              </SegmentedControl.Root>
            </label>
          </div>
          {pickerType === "plugin" ? (
            <>
              <TextField.Root
                placeholder="搜索插件名称 / 描述 / 作者"
                value={pluginQuery}
                radius="large"
                onChange={(e) => setPluginQuery(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlassIcon size={16} />
                </TextField.Slot>
              </TextField.Root>
              <div className="max-h-[420px] min-h-[240px] overflow-x-hidden overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
                {pluginsLoading && (
                  <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-white/50">
                    <Spinner size="3" />
                    正在加载插件索引…
                  </div>
                )}
                {!pluginsLoading && pluginsError && (
                  <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-sm text-white/50">
                    插件索引加载失败：{pluginsError}
                    <Button
                      type="button"
                      size="1"
                      variant="soft"
                      onClick={() => void loadPlugins()}
                    >
                      重试
                    </Button>
                  </div>
                )}
                {!pluginsLoading && !pluginsError && filteredPlugins.length === 0 && (
                  <p className="py-16 text-center text-sm text-white/40">
                    {plugins ? "没有匹配的插件" : ""}
                  </p>
                )}
                {!pluginsLoading && !pluginsError && filteredPlugins.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {filteredPlugins.map((plugin) => {
                      const name = ngPluginDisplayName(plugin);
                      const selected = pendingPluginNames.has(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                            selected
                              ? "border-white/40 bg-white/15"
                              : "border-transparent bg-white/[0.03] hover:border-white/20 hover:bg-white/10"
                          }`}
                          onClick={() =>
                            setPendingPluginNames((prev) => {
                              const next = new Set(prev);
                              if (next.has(name)) next.delete(name);
                              else next.add(name);
                              return next;
                            })
                          }
                        >
                          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-black/30">
                            <ProxiedIcon url={ngPluginIconUrl(plugin)} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-white">
                              {name}
                            </span>
                            <span className="block truncate text-xs text-white/40">
                              {plugin.manifest?.description || ""}
                            </span>
                          </span>
                          <Badge color="gray" variant="soft" className="shrink-0">
                            v{plugin.manifest?.version || "?"}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <TextField.Root
                placeholder="搜索名称 / ID / 标签 / 仓库名等"
                value={query}
                radius="large"
                onChange={(e) => setQuery(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlassIcon size={16} />
                </TextField.Slot>
              </TextField.Root>
              <div className="max-h-[420px] min-h-[240px] overflow-x-hidden overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
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
                          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-black/30">
                            <ProxiedIcon url={iconUrl} />
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
            </>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => {
                setPickerOpen(false);
                resetPickerTransient();
              }}
            >
              关闭
            </Button>
            <Button
              type="button"
              variant="solid"
              disabled={pendingCount === 0}
              onClick={commitSelection}
            >
              添加{pendingCount > 0 ? `（已选 ${pendingCount} 个，${pickerMode === "required" ? "必需" : "推荐"}）` : ""}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <FieldHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="扩展字段说明"
        items={EXT_FIELD_HELP}
      />
    </SectionCard>
  );
}

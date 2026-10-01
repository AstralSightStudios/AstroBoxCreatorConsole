import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useAccountState } from "~/logic/account/store";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import { fetchCatalogEntries, type CatalogEntry } from "~/logic/publish/catalog";
import { formatResourceType } from "~/logic/publish/resource-type";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import { buildRawFileUrl } from "~/logic/publish/manifest-loader";
import {
  fetchNgPluginIndex,
  ngPluginDisplayName,
  ngPluginIconUrl,
  type NgPluginIndexEntry,
} from "~/logic/publish/plugin-repo";
import { normalizeBundledResources } from "~/logic/publish/manifest";
import { RAW_GITHUB_ORIGIN } from "~/logic/github-raw";
import type { PrResourcePreview } from "../types";

let catalogPromise: Promise<CatalogEntry[]> | null = null;
let pluginPromise: Promise<NgPluginIndexEntry[]> | null = null;

function loadCatalogOnce(token?: string): Promise<CatalogEntry[]> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetchCatalogEntries({ token })
    .then((r) => r.entries)
    .catch((err) => {
      catalogPromise = null;
      throw err;
    });
  return catalogPromise;
}

function loadPluginsOnce(): Promise<NgPluginIndexEntry[]> {
  if (pluginPromise) return pluginPromise;
  pluginPromise = fetchNgPluginIndex().catch((err) => {
    pluginPromise = null;
    throw err;
  });
  return pluginPromise;
}

function entryIconUrl(entry: CatalogEntry): string {
  if (!entry.icon) return "";
  const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
  return buildRawFileUrl(
    entry.repo_owner,
    entry.repo_name,
    ref,
    entry.icon,
  );
}

function entryRepoWebUrl(entry: CatalogEntry): string {
  if (!entry.repo_owner || !entry.repo_name) return "";
  return `https://github.com/${entry.repo_owner}/${entry.repo_name}`;
}

/**
 * 插件索引里的 `repo` 是 raw 地址（可能带 `refs/heads/{branch}/` 前缀），
 * 这里反推回 GitHub 网页地址，供审核点击跳转。无法识别时返回空串。
 */
function pluginRepoWebUrl(plugin: NgPluginIndexEntry): string {
  const raw = plugin.repo || "";
  if (!raw.startsWith(`${RAW_GITHUB_ORIGIN}/`)) return "";
  const segments = raw.slice(RAW_GITHUB_ORIGIN.length + 1).split("/");
  const [owner, repo, ref, kind, branch] = segments;
  if (!owner || !repo) return "";
  if (ref === "refs" && (kind === "heads" || kind === "tags") && branch) {
    return `https://github.com/${owner}/${repo}/tree/${branch}`;
  }
  return `https://github.com/${owner}/${repo}`;
}

/** 展示用短名 `owner/repo`，不暴露完整 raw URL。 */
function pluginRepoLabel(plugin: NgPluginIndexEntry): string {
  const raw = plugin.repo || "";
  if (!raw.startsWith(`${RAW_GITHUB_ORIGIN}/`)) return "";
  const [owner, repo] = raw.slice(RAW_GITHUB_ORIGIN.length + 1).split("/");
  return owner && repo ? `${owner}/${repo}` : "";
}

function BundledIcon({ url }: { url: string }) {
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

/** manifest ext.bundledResources 的可视化：图标 + 名称 + 安装方式 + 存在性。 */
export function BundledResourcesSection({ resource }: { resource: PrResourcePreview }) {
  const accountState = useAccountState();
  const githubToken = accountState.github?.token;

  const bundled = useMemo(
    () => normalizeBundledResources(resource.manifest?.ext?.bundledResources),
    [resource.manifest?.ext?.bundledResources],
  );

  const [catalog, setCatalog] = useState<Map<string, CatalogEntry> | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [plugins, setPlugins] = useState<Map<string, NgPluginIndexEntry> | null>(null);
  const [pluginError, setPluginError] = useState("");

  const hasResourceBundles = bundled.some((item) => item.type === "resource");
  const hasPluginBundles = bundled.some((item) => item.type === "plugin");

  useEffect(() => {
    if (!hasResourceBundles) return;
    let cancelled = false;
    void loadCatalogOnce(githubToken)
      .then((entries) => {
        if (cancelled) return;
        const map = new Map<string, CatalogEntry>();
        for (const entry of entries) {
          if (entry.id) map.set(entry.id, entry);
        }
        setCatalog(map);
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasResourceBundles, githubToken]);

  useEffect(() => {
    if (!hasPluginBundles) return;
    let cancelled = false;
    void loadPluginsOnce()
      .then((entries) => {
        if (cancelled) return;
        const map = new Map<string, NgPluginIndexEntry>();
        for (const plugin of entries) {
          const name = ngPluginDisplayName(plugin);
          if (name) map.set(name, plugin);
        }
        setPlugins(map);
      })
      .catch((err) => {
        if (!cancelled) {
          setPluginError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasPluginBundles]);

  if (bundled.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-white/10 bg-black/20 p-3">
      <span className="text-xs font-semibold text-white/55">捆绑资源</span>
      <div className="flex flex-col gap-1.5">
        {bundled.map((item) => {
          const key =
            item.type === "plugin" ? (item.name || item.id || "") : (item.id || "");
          const entry = item.type === "resource" ? catalog?.get(key) : undefined;
          const plugin = item.type === "plugin" ? plugins?.get(key) : undefined;
          const iconUrl =
            item.type === "resource"
              ? entry
                ? entryIconUrl(entry)
                : ""
              : plugin
                ? ngPluginIconUrl(plugin)
                : "";
          const displayName =
            item.type === "resource"
              ? entry?.name || item.name || item.id
              : plugin
                ? ngPluginDisplayName(plugin)
                : item.name || item.id;
          const typeLabel =
            item.type === "resource"
              ? entry
                ? formatResourceType(entry.restype)
                : "资源"
              : plugin?.manifest?.version
                ? `插件 v${plugin.manifest.version}`
                : "插件";
          const lookupDone =
            item.type === "resource" ? catalog != null : plugins != null;
          const missing = lookupDone && !entry && !plugin;
          const repoUrl = entry
            ? entryRepoWebUrl(entry)
            : plugin
              ? pluginRepoWebUrl(plugin)
              : "";
          const repoLabel = entry
            ? `${entry.repo_owner}/${entry.repo_name}`
            : plugin
              ? pluginRepoLabel(plugin)
              : "";

          const badgeClass =
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap";

          const body = (
            <>
              <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-black/30">
                <BundledIcon url={iconUrl} />
              </span>
              {/* min-w-0 + flex-wrap：徽章在窄屏换行而非撑破容器 */}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 max-w-full truncate text-sm text-white">
                    {displayName}
                  </span>
                  <span
                    className={`${badgeClass} border-white/10 bg-white/5 text-white/60`}
                  >
                    {typeLabel}
                  </span>
                  <span
                    className={`${badgeClass} ${
                      item.mode === "required"
                        ? "border-red-400/30 bg-red-500/10 text-red-300"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    }`}
                  >
                    {item.mode === "required" ? "必需" : "推荐"}
                  </span>
                  {missing && (
                    <span
                      className={`${badgeClass} border-red-400/30 bg-red-500/10 text-red-300`}
                    >
                      目录中不存在
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-white/40">
                  <span className="min-w-0 max-w-full truncate">{item.id}</span>
                  {repoLabel && (
                    <span className="min-w-0 max-w-full truncate">
                      {repoLabel}
                    </span>
                  )}
                </span>
              </span>
              {repoUrl && (
                <ArrowSquareOutIcon
                  size={14}
                  className="shrink-0 text-white/40"
                />
              )}
            </>
          );

          const shellClass = `flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2 ${
            missing
              ? "border-red-400/40 bg-red-500/10"
              : "border-white/10 bg-white/[0.03]"
          }`;

          return repoUrl ? (
            <a
              key={`${item.type}:${item.id}`}
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`打开 GitHub 仓库：${repoLabel}`}
              className={`${shellClass} transition hover:border-white/30 hover:bg-white/10`}
            >
              {body}
            </a>
          ) : (
            <div key={`${item.type}:${item.id}`} className={shellClass}>
              {body}
            </div>
          );
        })}
      </div>
      {(catalogError || pluginError) && (
        <p className="text-xs text-amber-100/80">
          捆绑项校验数据加载失败：
          {[catalogError, pluginError].filter(Boolean).join(" / ")}
        </p>
      )}
    </div>
  );
}

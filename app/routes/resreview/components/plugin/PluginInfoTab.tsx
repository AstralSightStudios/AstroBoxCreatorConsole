import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowSquareOut,
  CheckCircle,
  FileCode,
  FileX,
  PuzzlePiece,
  Warning,
} from "@phosphor-icons/react";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import type {
  PluginIndexEntryGroup,
  PluginManifestPreview,
} from "~/logic/publish/plugin-review";
import { LoadingIndicator } from "../LoadingIndicator";
import { PluginEntryTabBar, pluginGroupLabel } from "./PluginEntryTabBar";

interface PluginInfoTabProps {
  groups: PluginIndexEntryGroup[];
  loading: boolean;
  error?: string;
}

function openExternal(url: string) {
  if (!url) return;
  openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

function IssueBanner({
  level,
  message,
}: {
  level: "error" | "warn";
  message: string;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        level === "error"
          ? "border-red-400/25 bg-red-500/10 text-red-100"
          : "border-amber-400/25 bg-amber-500/10 text-amber-100"
      }`}
    >
      <Warning size={14} className="mt-0.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

function PluginIcon({ url }: { url: string }) {
  const resolved = useProxiedMediaUrl(url || undefined);
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
        <PuzzlePiece size={24} weight="duotone" className="text-white/40" />
      </div>
    );
  }
  return (
    <img
      src={resolved}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
    />
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <span className="w-24 shrink-0 text-white/45">{label}</span>
      <span className="min-w-0 flex-1 break-words text-white/85">{value || "--"}</span>
    </div>
  );
}

function PluginCard({ plugin }: { plugin: PluginManifestPreview }) {
  const manifest = plugin.manifest;
  const errorIssues = plugin.issueList.filter((issue) => issue.level === "error");
  const warnIssues = plugin.issueList.filter((issue) => issue.level === "warn");
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <PluginIcon url={plugin.iconUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-base font-semibold text-white">
              {manifest?.name || plugin.rawName || plugin.folder || "manifest 读取失败"}
            </h3>
            {manifest?.version && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/65">
                v{manifest.version}
              </span>
            )}
            {manifest?.api_level != null && (
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-100">
                API {manifest.api_level}
              </span>
            )}
            {manifest?.wasi_version != null && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-100">
                WASI {manifest.wasi_version}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white/60">
            {manifest?.description || plugin.manifestError || "没有可展示的 manifest 信息。"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => openExternal(plugin.manifestUrl)}
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <FileCode size={13} />
              manifest.json
            </button>
            {manifest?.website && (
              <button
                type="button"
                onClick={() => openExternal(manifest.website)}
                className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <ArrowSquareOut size={13} />
                插件主页
              </button>
            )}
          </div>
        </div>
      </div>

      {manifest && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <InfoRow label="作者" value={manifest.author} />
          <InfoRow label="文件夹" value={plugin.folder || "仓库根目录"} />
          <InfoRow label="入口文件" value={<code className="break-all">{manifest.entry}</code>} />
          <InfoRow label="图标" value={<code className="break-all">{manifest.icon}</code>} />
        </div>
      )}

      {manifest && manifest.permissions.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-white/45">权限</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {manifest.permissions.map((permission) => (
              <span
                key={permission}
                className="rounded-md bg-white/[0.06] px-2 py-1 font-mono-sarasa text-xs text-white/70"
              >
                {permission}
              </span>
            ))}
          </div>
        </div>
      )}

      {plugin.files.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="text-xs text-white/45">引用文件</div>
          {plugin.files.map((file) => (
            <div
              key={`${file.label}:${file.path}`}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1.5 text-xs"
            >
              {file.exists ? (
                <CheckCircle size={14} weight="fill" className="shrink-0 text-emerald-400" />
              ) : (
                <FileX size={14} weight="fill" className="shrink-0 text-red-400" />
              )}
              <span className="text-white/45">{file.label}</span>
              <code className="min-w-0 flex-1 break-all text-white/75">{file.path}</code>
              {typeof file.size === "number" && (
                <span className="text-white/35">{formatBytes(file.size)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {(errorIssues.length > 0 || warnIssues.length > 0) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {[...errorIssues, ...warnIssues].map((issue, index) => (
            <IssueBanner key={`${issue.level}-${index}`} level={issue.level} message={issue.message} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function PluginInfoTab({ groups, loading, error }: PluginInfoTabProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (loading && groups.length === 0) {
    return (
      <LoadingIndicator
        text="正在解析插件信息"
        hint="读取作者仓库 index.txt 与 manifest.json，并检查引用文件"
      />
    );
  }
  if (error) {
    return <IssueBanner level="error" message={error} />;
  }
  if (groups.length === 0) {
    return <p className="text-sm text-white/45">没有从 index.txt diff 中识别到新增条目。</p>;
  }
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, groups.length - 1));
  const group = groups[safeActiveIdx];

  return (
    <div className="flex flex-col gap-3">
      <PluginEntryTabBar groups={groups} activeIndex={safeActiveIdx} onChange={setActiveIdx} />

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-100">
            {pluginGroupLabel(group, safeActiveIdx)}
          </span>
          {group.parsed && (
            <>
              <button
                type="button"
                onClick={() => openExternal(group.repoWebUrl)}
                className="inline-flex items-center gap-1 text-blue-300 hover:underline"
              >
                {group.parsed.owner}/{group.parsed.repo}
                <ArrowSquareOut size={13} />
              </button>
              <span className="text-white/35">·</span>
              <button
                type="button"
                onClick={() => openExternal(group.repoBranchUrl)}
                className="text-white/55 hover:text-white"
              >
                {group.parsed.refKind}/{group.parsed.branch}
              </button>
            </>
          )}
        </div>
        <div className="mt-1 break-all font-mono-sarasa text-xs text-white/45">
          {group.line}
        </div>
      </div>

      {group.lineIssues.map((issue, index) => (
        <IssueBanner key={`${issue.level}-${index}`} level={issue.level} message={issue.message} />
      ))}
      {group.loadError && <IssueBanner level="error" message={group.loadError} />}

      {group.plugins.length === 0 && !group.loadError && (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-4 text-sm text-white/45">
          作者仓库 index.txt 没有解析出可用的 manifest。
        </p>
      )}

      {group.plugins.map((plugin) => (
        <PluginCard key={plugin.key} plugin={plugin} />
      ))}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLineDown, Download } from "@phosphor-icons/react";
import { toast } from "sonner";
import { loadDeviceNameMap } from "~/logic/devices/catalog";
import {
  downloadGithubRawFile,
  pickDownloadDirectory,
} from "~/logic/github-download";
import { isTauriRuntime } from "~/logic/github-raw";
import type { ManifestUpdateLogEntry } from "~/logic/publish/manifest";
import type { PrResourcePreview } from "../types";

interface DownloadGroup {
  raw: string;
  file: string;
  version: string;
  kind: PrResourcePreview["packages"][number]["kind"];
  devices: string[];
  versionCode?: number;
  updateLogs?: ManifestUpdateLogEntry[];
}

function groupDownloads(packages: PrResourcePreview["packages"]): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>();
  for (const pkg of packages) {
    const key = `${pkg.kind || ""}||${pkg.url || ""}||${pkg.fileName || ""}||${pkg.version || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        raw: pkg.url || "",
        file: pkg.fileName || "",
        version: pkg.version || "",
        kind: pkg.kind,
        devices: [],
        versionCode: pkg.versionCode,
        updateLogs: pkg.updateLogs,
      });
    }
    const group = groups.get(key)!;
    if (pkg.deviceId && !group.devices.includes(pkg.deviceId)) {
      group.devices.push(pkg.deviceId);
    }
    if (group.versionCode === undefined && pkg.versionCode !== undefined) {
      group.versionCode = pkg.versionCode;
    }
    if ((!group.updateLogs || group.updateLogs.length === 0) && pkg.updateLogs?.length) {
      group.updateLogs = pkg.updateLogs;
    }
  }
  return Array.from(groups.values());
}

function KindBadge({ kind }: { kind: DownloadGroup["kind"] }) {
  const trial = kind === "试用包";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
        trial
          ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {trial ? "试用版" : "正式版"}
    </span>
  );
}

export function ResourceDownloadsSection({ resource }: { resource: PrResourcePreview }) {
  const [deviceNameMap, setDeviceNameMap] = useState<Map<string, string>>(new Map());
  const [downloadingAll, setDownloadingAll] = useState(false);
  const groupedDownloads = useMemo(() => groupDownloads(resource.packages), [resource.packages]);
  const downloadableGroups = useMemo(
    () => groupedDownloads.filter((group) => Boolean(group.raw)),
    [groupedDownloads],
  );

  useEffect(() => {
    loadDeviceNameMap().then(setDeviceNameMap).catch(() => {});
  }, []);

  const handleDownload = useCallback(async (group: DownloadGroup) => {
    if (!group.raw) return;
    try {
      await downloadGithubRawFile(group.raw, group.file || "download");
    } catch (err) {
      toast.error(
        `下载失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (downloadableGroups.length === 0) return;
    let targetDir: string | undefined;
    if (isTauriRuntime()) {
      const dir = await pickDownloadDirectory();
      if (!dir) return;
      targetDir = dir;
    }
    setDownloadingAll(true);
    let failed = 0;
    try {
      for (const group of downloadableGroups) {
        try {
          await downloadGithubRawFile(group.raw, group.file, targetDir);
        } catch (err) {
          failed += 1;
          toast.error(
            `${group.file || "文件"} 下载失败：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      if (failed === 0) {
        toast.success(`已下载 ${downloadableGroups.length} 个包`);
      }
    } finally {
      setDownloadingAll(false);
    }
  }, [downloadableGroups]);

  const renderGroup = (group: DownloadGroup) => (
    <div
      key={`${group.kind}-${group.raw}-${group.file}-${group.version}`}
      className="relative rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <KindBadge kind={group.kind} />
        <div className="min-w-0 flex-1 text-xs text-white/55">
          支持设备：
          {group.devices.map((device) => {
            const name = deviceNameMap.get(device);
            return name ? `${device}（${name}）` : device;
          }).join(" / ") || "-"}
        </div>
      </div>
      <div className="mt-1 text-xs text-white/55">版本：{group.version || "-"}</div>
      <div className="mt-1 text-xs text-white/55">
        versionCode：
        {group.versionCode !== undefined ? group.versionCode : "未填写（无法检测更新）"}
      </div>
      {group.updateLogs && group.updateLogs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="text-xs font-medium text-white/55">更新日志</div>
          {group.updateLogs.map((log, index) => (
            <div
              key={`${log.version}-${index}`}
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5"
            >
              <div className="text-xs font-semibold text-white/70">
                {log.version || "未填写版本"}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-white/60">
                {log.content || "-"}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 break-all text-xs text-white/55">
        文件：
        <a
          href={`https://github.com/${resource.entry.repo_owner}/${resource.entry.repo_name}/blob/${resource.ref}/${group.file}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-300 hover:underline"
        >
          {group.file || "-"}
        </a>
      </div>
      <div className="mt-1 text-right">
        {group.raw ? (
          <button
            onClick={() => void handleDownload(group)}
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 transition"
          >
            <Download size={12} />
            下载包
          </button>
        ) : (
          <span className="text-xs text-white/45">下载包</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-white/55">支持设备</span>
        {downloadableGroups.length > 0 && (
          <button
            onClick={() => void handleDownloadAll()}
            disabled={downloadingAll}
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 transition disabled:opacity-50"
          >
            <ArrowLineDown size={12} />
            {downloadingAll ? "下载中…" : "下载所有包"}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {groupedDownloads.map(renderGroup)}
        {groupedDownloads.length === 0 && (
          <div className="text-sm text-white/45">无包体配置</div>
        )}
      </div>
    </div>
  );
}

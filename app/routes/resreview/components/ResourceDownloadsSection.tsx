import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLineDown,
  CaretDownIcon,
  CaretUpIcon,
  Download,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { loadDeviceNameMap } from "~/logic/devices/catalog";
import {
  downloadGithubRawFile,
  pickDownloadDirectory,
} from "~/logic/github-download";
import { isTauriRuntime } from "~/logic/github-raw";
import type { ManifestUpdateLogEntry } from "~/logic/publish/manifest";
import {
  dedupeLogsWithinGroup,
  foldUpdateLogsAcrossGroups,
  type FoldedUpdateLog,
} from "../utils/update-log-fold";
import type { PrResourcePreview } from "../types";

interface DownloadGroup {
  raw: string;
  file: string;
  version: string;
  kind: PrResourcePreview["packages"][number]["kind"];
  devices: string[];
  versionCode?: number;
  /** 分组内去重后的更新日志。 */
  updateLogs: ManifestUpdateLogEntry[];
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
        updateLogs: [],
      });
    }
    const group = groups.get(key)!;
    if (pkg.deviceId && !group.devices.includes(pkg.deviceId)) {
      group.devices.push(pkg.deviceId);
    }
    if (group.versionCode === undefined && pkg.versionCode !== undefined) {
      group.versionCode = pkg.versionCode;
    }
    // 共用同一包体的设备经「一键填充」会带上完全相同的日志，
    // 先在分组内去重，避免同一组里重复渲染。
    group.updateLogs.push(...dedupeLogsWithinGroup(pkg.updateLogs));
  }
  for (const group of groups.values()) {
    group.updateLogs = dedupeLogsWithinGroup(group.updateLogs);
  }
  return Array.from(groups.values());
}

/**
 * 单条更新日志。内容与前面已展示过的日志完全一致时（多个设备经一键填充共用
 * 同一份配置），默认折叠成一行摘要，点击才展开正文。
 */
function UpdateLogCard({
  folded,
  expanded,
  onToggle,
}: {
  folded: FoldedUpdateLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { log, duplicate } = folded;
  const version = log.version || "未填写版本";

  // 箭头固定占据行首位置：折叠与展开两种状态下坐标一致，切换时不会位移。
  // 非重复日志没有折叠概念，用同尺寸占位块保持纵向对齐。
  const toggleSize = "size-4 shrink-0";

  if (!duplicate) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={toggleSize} />
          <span className="min-w-0 truncate text-xs font-semibold text-white/70">
            {version}
          </span>
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words pl-5.5 text-xs leading-relaxed text-white/60">
          {log.content || "-"}
        </div>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            title="收起"
            aria-label={`收起 ${version} 的更新日志`}
            className={`${toggleSize} grid place-items-center rounded text-white/40 transition hover:bg-white/15 hover:text-white`}
          >
            <CaretUpIcon size={12} />
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-white/70">
            {version}
          </span>
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words pl-5.5 text-xs leading-relaxed text-white/60">
          {log.content || "-"}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      title="展开完整更新日志"
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-dashed border-white/10 bg-white/[0.02] px-2 py-1.5 text-left transition hover:border-white/25 hover:bg-white/[0.05]"
    >
      <span className={`${toggleSize} grid place-items-center text-white/40`}>
        <CaretDownIcon size={12} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-white/55">
        {version} · 内容与上方日志相同
      </span>
    </button>
  );
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
  /** 用户手动展开的重复日志，key = `${分组下标}:${日志下标}`。 */
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const groupedDownloads = useMemo(() => groupDownloads(resource.packages), [resource.packages]);
  const downloadableGroups = useMemo(
    () => groupedDownloads.filter((group) => Boolean(group.raw)),
    [groupedDownloads],
  );
  /**
   * 跨分组折叠共用同一份 seen 集合：某个包体上出现过的日志签名会被后续分组
   * 记为重复，默认只展开第一次出现的那条。
   */
  const foldedLogsByGroup = useMemo(() => {
    const seen = new Set<string>();
    return groupedDownloads.map((group) =>
      foldUpdateLogsAcrossGroups(group.updateLogs, seen),
    );
  }, [groupedDownloads]);

  const toggleLog = useCallback((key: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  const renderGroup = (group: DownloadGroup, groupIndex: number) => {
    const foldedLogs = foldedLogsByGroup[groupIndex] ?? [];
    return (
    <div
      key={`${group.kind}-${group.raw}-${group.file}-${group.version}`}
      className="relative min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
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
      {foldedLogs.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-col gap-1.5">
          <div className="text-xs font-medium text-white/55">更新日志</div>
          {foldedLogs.map((folded, logIndex) => {
            const key = `${groupIndex}:${logIndex}`;
            return (
              <UpdateLogCard
                key={`${folded.log.version}-${logIndex}`}
                folded={folded}
                expanded={expandedLogs.has(key)}
                onToggle={() => toggleLog(key)}
              />
            );
          })}
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
  };

  return (
    <div className="relative min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
      <div className="flex min-w-0 flex-col gap-2">
        {groupedDownloads.map(renderGroup)}
        {groupedDownloads.length === 0 && (
          <div className="text-sm text-white/45">无包体配置</div>
        )}
      </div>
    </div>
  );
}

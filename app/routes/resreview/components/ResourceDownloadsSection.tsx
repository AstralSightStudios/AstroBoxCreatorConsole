import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLineDown, Download } from "@phosphor-icons/react";
import { loadDeviceNameMap } from "~/logic/devices/catalog";
import type { PrResourcePreview } from "../types";

interface DownloadGroup {
  raw: string;
  file: string;
  version: string;
  devices: string[];
}

function groupDownloads(packages: PrResourcePreview["packages"]): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>();
  for (const pkg of packages) {
    const key = `${pkg.url || ""}||${pkg.fileName || ""}||${pkg.version || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        raw: pkg.url || "",
        file: pkg.fileName || "",
        version: pkg.version || "",
        devices: [],
      });
    }
    const group = groups.get(key)!;
    if (pkg.deviceId && !group.devices.includes(pkg.deviceId)) {
      group.devices.push(pkg.deviceId);
    }
  }
  return Array.from(groups.values());
}

export function ResourceDownloadsSection({ resource }: { resource: PrResourcePreview }) {
  const [deviceNameMap, setDeviceNameMap] = useState<Map<string, string>>(new Map());
  const groupedDownloads = useMemo(() => groupDownloads(resource.packages), [resource.packages]);
  const allDownloadUrls = useMemo(
    () => groupedDownloads.map((group) => group.raw).filter(Boolean),
    [groupedDownloads],
  );

  useEffect(() => {
    loadDeviceNameMap().then(setDeviceNameMap).catch(() => {});
  }, []);

  const handleDownloadAll = useCallback(() => {
    for (const url of allDownloadUrls) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [allDownloadUrls]);

  return (
    <div className="relative rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-white/55">支持设备</span>
        {groupedDownloads.length > 0 && (
          <button
            onClick={handleDownloadAll}
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 transition"
          >
            <ArrowLineDown size={12} />
            下载所有包
          </button>
        )}
      </div>
      <div className="space-y-2">
        {groupedDownloads.map((group) => (
          <div
            key={`${group.raw}-${group.file}-${group.version}`}
            className="relative rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <div className="text-xs text-white/55">
              支持设备：
              {group.devices.map((device) => {
                const name = deviceNameMap.get(device);
                return name ? `${device}（${name}）` : device;
              }).join(" / ") || "-"}
            </div>
            <div className="mt-1 text-xs text-white/55">版本：{group.version || "-"}</div>
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
                  onClick={() => window.open(group.raw, "_blank", "noopener,noreferrer")}
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
        ))}
        {groupedDownloads.length === 0 && (
          <div className="text-sm text-white/45">无包体配置</div>
        )}
      </div>
    </div>
  );
}

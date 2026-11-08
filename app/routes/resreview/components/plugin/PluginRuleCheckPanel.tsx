import { useState } from "react";
import {
  ArrowsClockwise,
  Check,
  Info,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { PluginIndexEntryGroup } from "~/logic/publish/plugin-review";
import { Button } from "~/components/ScaleAwareThemes";
import { LoadingIndicator } from "../LoadingIndicator";
import { PluginEntryTabBar } from "./PluginEntryTabBar";

interface PluginRuleCheckPanelProps {
  groups: PluginIndexEntryGroup[];
  loading: boolean;
  reloading?: boolean;
  error?: string;
  publishedError?: string;
  onReload?: () => void;
}

type CheckStatus = "pass" | "fail" | "warn" | "manual";

interface CheckRow {
  title: string;
  status: CheckStatus;
  detail: string;
}

function describeParsedLine(group: PluginIndexEntryGroup): string {
  if (!group.parsed) return "";
  const entry = group.parsed;
  const refText = entry.shortForm
    ? "github.com 短格式，固定按 main 分支"
    : `${entry.refKind}/${entry.branch}`;
  return `解析为 ${entry.owner}/${entry.repo} @ ${refText}。`;
}

function buildRows(group: PluginIndexEntryGroup): CheckRow[] {
  const rows: CheckRow[] = [];
  const lineErrors = group.lineIssues.filter((issue) => issue.level === "error");
  const lineWarns = group.lineIssues.filter((issue) => issue.level === "warn");
  rows.push({
    title: "新增行格式",
    status: lineErrors.length > 0 ? "fail" : lineWarns.length > 0 ? "warn" : "pass",
    detail:
      lineErrors.length > 0
        ? lineErrors.map((issue) => issue.message).join("；")
        : lineWarns.length > 0
          ? lineWarns.map((issue) => issue.message).join("；")
          : describeParsedLine(group) || "地址格式符合插件源 index.txt 规范。",
  });
  const folderPreview = group.folders.slice(0, 4).join("、");
  const folderSuffix =
    group.folders.length > 4 ? ` 等 ${group.folders.length} 个` : "";
  rows.push({
    title: "作者仓库 index.txt",
    status: group.loadError ? "fail" : group.folders.length > 0 ? "pass" : "fail",
    detail: group.loadError
      ? group.loadError
      : group.folders.length > 0
        ? `解析到 ${group.folders.length} 个构建产物文件夹：${folderPreview}${folderSuffix}。`
        : "没有解析到构建产物文件夹。",
  });

  if (group.plugins.length === 0) {
    rows.push({
      title: "manifest.json",
      status: "fail",
      detail: "没有解析到任何可用 manifest。",
    });
    return rows;
  }

  for (const plugin of group.plugins) {
    const label = plugin.manifest?.name || plugin.rawName || plugin.folder || "未命名条目";
    const errors = plugin.issueList.filter((issue) => issue.level === "error");
    const warns = plugin.issueList.filter((issue) => issue.level === "warn");
    rows.push({
      title: `manifest：${label}`,
      status: errors.length > 0 ? "fail" : warns.length > 0 ? "warn" : "pass",
      detail:
        errors.length > 0
          ? errors.map((issue) => issue.message).join("；")
          : warns.length > 0
            ? warns.map((issue) => issue.message).join("；")
            : `字段与引用文件检查通过（${plugin.folder || "根目录"}）。`,
    });
  }

  const missingFiles = group.plugins.flatMap((plugin) =>
    plugin.files.filter((file) => file.exists === false),
  );
  rows.push({
    title: "引用文件存在性",
    status:
      missingFiles.length > 0
        ? "fail"
        : group.plugins.some((plugin) => plugin.files.some((file) => file.exists === null))
          ? "warn"
          : "pass",
    detail:
      missingFiles.length > 0
        ? `${missingFiles.length} 个引用文件不存在：${missingFiles
            .map((file) => file.path)
            .join("、")}`
        : "icon / entry / additional_files 均存在且非空。",
  });

  return rows;
}

const STATUS_META: Record<
  CheckStatus,
  { icon: typeof Check; color: string; label: string }
> = {
  pass: { icon: Check, color: "text-emerald-400", label: "通过" },
  fail: { icon: X, color: "text-red-400", label: "失败" },
  warn: { icon: Warning, color: "text-amber-400", label: "警告" },
  manual: { icon: Warning, color: "text-white/45", label: "人工" },
};

export function PluginRuleCheckPanel({
  groups,
  loading,
  reloading,
  error,
  publishedError,
  onReload,
}: PluginRuleCheckPanelProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (loading && groups.length === 0) {
    return (
      <LoadingIndicator
        text="正在执行插件索引检查"
        hint="检查新增行格式、作者仓库、manifest 字段与引用文件"
      />
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
        检查失败：{error}
      </div>
    );
  }
  if (groups.length === 0) {
    return <p className="text-sm text-white/45">没有从 index.txt diff 中识别到新增条目。</p>;
  }

  const safeActiveIdx = Math.min(activeIdx, Math.max(0, groups.length - 1));
  const group = groups[safeActiveIdx];
  const rows = buildRows(group);
  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { pass: 0, fail: 0, warn: 0, manual: 0 } as Record<CheckStatus, number>,
  );

  return (
    <div className="flex flex-col gap-3">
      <PluginEntryTabBar groups={groups} activeIndex={safeActiveIdx} onChange={setActiveIdx} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <Check size={14} weight="bold" /> 通过 {counts.pass}
          </span>
          <span className="inline-flex items-center gap-1 text-red-400">
            <X size={14} weight="bold" /> 失败 {counts.fail}
          </span>
          <span className="inline-flex items-center gap-1 text-amber-400">
            <Warning size={14} weight="bold" /> 警告 {counts.warn}
          </span>
        </div>
        {onReload && (
          <Button
            size="1"
            variant="soft"
            color="gray"
            className="ml-auto shrink-0"
            disabled={loading || reloading}
            onClick={onReload}
          >
            <ArrowsClockwise size={14} />
            重新检查
          </Button>
        )}
      </div>

      {publishedError && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          官方插件索引读取失败，无法完整检查同名冲突：{publishedError}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs leading-relaxed text-white/55">
        <div className="mb-1.5 flex items-center gap-1.5 text-white/70">
          <Info size={14} weight="bold" />
          新增行格式要求
        </div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            一行一个作者插件仓库根地址，推荐完整 raw 形式：
            <code className="break-all font-mono-sarasa text-white/75">
              https://raw.githubusercontent.com/&lt;owner&gt;/&lt;repo&gt;/refs/heads/&lt;branch&gt;/
            </code>
          </li>
          <li>
            必须在一行内写完且以 <code className="font-mono-sarasa text-white/75">/</code>{" "}
            结尾；不能包含空格或 <code className="font-mono-sarasa text-white/75">manifest.json</code>；
            分支名不能包含 <code className="font-mono-sarasa text-white/75">/</code>。
          </li>
          <li>不能与上游 index.txt 已有行或本次 PR 的其他新增行重复。</li>
          <li>
            该地址指向的仓库根目录需要 <code className="font-mono-sarasa text-white/75">index.txt</code>，
            每行一个构建产物文件夹；每个文件夹内需要{" "}
            <code className="font-mono-sarasa text-white/75">manifest.json</code>，
            其 icon / entry / additional_files 必须存在且非空，entry 以{" "}
            <code className="font-mono-sarasa text-white/75">.wasm</code> 结尾。
          </li>
          <li>
            也接受 <code className="font-mono-sarasa text-white/75">https://github.com/&lt;owner&gt;/&lt;repo&gt;</code>{" "}
            短格式，但会固定按 main 分支解析，建议使用完整 raw 地址。
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const meta = STATUS_META[row.status];
          const Icon = meta.icon;
          return (
            <div
              key={`${row.title}-${index}`}
              className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            >
              <Icon size={16} weight="bold" className={`mt-0.5 shrink-0 ${meta.color}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{row.title}</span>
                  <span className={`text-xs ${meta.color}`}>{meta.label}</span>
                </div>
                <p className="mt-1 break-words text-xs text-white/55">{row.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

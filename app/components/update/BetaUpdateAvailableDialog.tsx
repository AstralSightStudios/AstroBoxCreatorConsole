import { useMemo, useState } from "react";
import { GithubLogoIcon } from "@phosphor-icons/react";
import { Button, Dialog } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import {
  detectBetaPlatform,
  ignoreBetaBuild,
  isTauriRuntime,
  selectBetaArtifact,
  UPDATE_REPO,
  type BetaArtifactInfo,
  type BetaPlatform,
  type BetaUpdatePrompt,
} from "~/logic/update/update-checker";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface BetaUpdateAvailableDialogProps {
  prompt: BetaUpdatePrompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PLATFORM_LABELS: Record<BetaPlatform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

/**
 * GitHub Actions 的构建摘要页。带 `/attempts/{n}` 才能定位到实际产出该构建的
 * 那次 attempt；用户在这个页面里按平台自行选择 artifact 下载。
 */
function buildBetaRunUrl(info: BetaArtifactInfo): string {
  const base = (
    info.htmlUrl || `https://github.com/${UPDATE_REPO}/actions/runs/${info.runId}`
  ).replace(/\/+$/, "");
  return info.runAttempt > 0 ? `${base}/attempts/${info.runAttempt}` : base;
}

export default function BetaUpdateAvailableDialog({
  prompt,
  open,
  onOpenChange,
}: BetaUpdateAvailableDialogProps) {
  const { isNarrow } = useUiScaleViewport();
  const [platform] = useState<BetaPlatform | null>(() => detectBetaPlatform());

  const info = prompt?.info ?? null;
  const artifact = useMemo(
    () => (info ? selectBetaArtifact(info, platform) : null),
    [info, platform],
  );

  const notesHtml = useMemo(() => {
    if (!prompt || !info) return "";
    const lines = [
      `**工作流：** ${info.workflowName}`,
      `**运行编号：** #${info.runNumber}.${info.runAttempt}`,
      `**提交：** \`${info.headSha.slice(0, 7)}\``,
      `**构建时间：** ${info.createdAt}`,
      `**当前构建：** ${prompt.currentBuildLabel}`,
    ];
    if (info.version) lines.push(`**构建版本：** ${info.version}`);
    if (prompt.comparison === "unknown") {
      lines.push(
        "",
        "> 无法确认当前构建是否已经包含该版本。若当前使用的是本地构建，请自行判断是否需要下载。",
      );
    }
    lines.push("", "**可下载产物：**");
    for (const item of info.artifacts) {
      lines.push(
        `- ${PLATFORM_LABELS[item.platform]} · ${item.name} · ${formatSize(item.size)}`,
      );
    }
    return renderCommentMarkdownHtml(lines.join("\n")).trim();
  }, [info, prompt]);

  if (!info) return null;

  const buildUrl = buildBetaRunUrl(info);

  const handleOpenBuildPage = () => {
    if (isTauriRuntime()) {
      void openUrl(buildUrl).catch(() =>
        window.open(buildUrl, "_blank", "noopener,noreferrer"),
      );
      return;
    }
    // Web / bun dev：直接开新标签页，避免 Tauri opener 在浏览器里抛错。
    window.open(buildUrl, "_blank", "noopener,noreferrer");
  };

  const handleIgnore = () => {
    ignoreBetaBuild(info);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>
          发现新的 Beta 构建 #{info.runNumber}.{info.runAttempt}
        </Dialog.Title>
        <Dialog.Description size="2" className="mb-3 text-white/55">
          构建产物需要前往 GitHub Actions 的构建摘要页，按自己的平台手动下载。
        </Dialog.Description>

        <ScrollArea className="mb-3 max-h-[var(--ui-viewport-height-42pct)] overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
          <div className="p-3 text-[13px] leading-relaxed text-white/80">
            {notesHtml ? (
              <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
            ) : (
              <p className="text-white/40">本次构建暂无详细信息。</p>
            )}
          </div>
        </ScrollArea>

        {artifact ? (
          <p className="mb-3 text-[12px] leading-relaxed text-white/45">
            当前平台（{PLATFORM_LABELS[artifact.platform]}）匹配产物：
            {artifact.name}（{formatSize(artifact.size)}）。
          </p>
        ) : (
          <p className="mb-3 text-[12px] leading-relaxed text-amber-200/80">
            {platform
              ? "当前平台没有匹配的构建产物，请前往 GitHub 页面手动选择对应平台的包。"
              : "无法识别当前平台，请前往 GitHub 页面手动选择对应平台的包。"}
          </p>
        )}

        <div
          className={`mt-4 flex gap-2 ${
            isNarrow ? "flex-col" : "flex-row items-center justify-between"
          }`}
        >
          <Button
            variant="soft"
            color="gray"
            className={isNarrow ? "w-full" : undefined}
            onClick={handleIgnore}
          >
            忽略此构建
          </Button>
          <div
            className={`flex gap-2 ${
              isNarrow ? "flex-col" : "flex-row items-center"
            }`}
          >
            <Button
              variant="soft"
              color="gray"
              className={isNarrow ? "w-full" : undefined}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              className={isNarrow ? "w-full" : undefined}
              onClick={handleOpenBuildPage}
            >
              <GithubLogoIcon size={15} weight="fill" />
              前往 GitHub 下载
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

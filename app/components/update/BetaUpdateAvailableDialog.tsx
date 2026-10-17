import { useMemo, useState } from "react";
import { DownloadSimpleIcon, GitBranchIcon, SpinnerIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  detectBetaPlatform,
  ignoreBetaBuild,
  isTauriRuntime,
  selectBetaArtifact,
  type BetaPlatform,
  type BetaUpdatePrompt,
} from "~/logic/update/update-checker";
import { downloadBetaArtifact } from "~/logic/update/beta-download";
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

export default function BetaUpdateAvailableDialog({
  prompt,
  open,
  onOpenChange,
}: BetaUpdateAvailableDialogProps) {
  const [downloading, setDownloading] = useState(false);
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

  const handleViewWorkflow = () => {
    openUrl(info.htmlUrl).catch(() =>
      window.open(info.htmlUrl, "_blank", "noopener,noreferrer"),
    );
  };

  const handleDownload = async () => {
    if (!artifact) return;
    // 非 Tauri 环境无法带鉴权下载，退回到打开构建页面
    if (!isTauriRuntime()) {
      handleViewWorkflow();
      return;
    }
    try {
      const targetPath = await save({
        title: `保存 Beta 构建产物（${PLATFORM_LABELS[artifact.platform]}）`,
        defaultPath: `${artifact.name}.zip`,
        filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
      });
      if (!targetPath) return;

      setDownloading(true);
      const bytes = await downloadBetaArtifact(artifact, targetPath);
      toast.success(`构建产物已保存（${formatSize(bytes)}）`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        `下载构建产物失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setDownloading(false);
    }
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

        <ScrollArea className="mb-3 max-h-[var(--ui-viewport-height-42pct)] overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
          <div className="p-3 text-[13px] leading-relaxed text-white/80">
            {notesHtml ? (
              <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
            ) : (
              <p className="text-white/40">本次构建暂无详细信息。</p>
            )}
          </div>
        </ScrollArea>

        {!artifact && (
          <p className="mb-3 text-[12px] leading-relaxed text-amber-200/80">
            当前平台没有可下载的构建产物，请点击「查看工作流」手动选择。
          </p>
        )}

        <Flex justify="between" align="center">
          <Button variant="soft" color="gray" onClick={handleIgnore}>
            忽略此构建
          </Button>
          <Flex gap="2" align="center">
            <Button
              variant="soft"
              color="gray"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button variant="outline" onClick={handleViewWorkflow}>
              <GitBranchIcon size={15} />
              查看工作流
            </Button>
            <Button
              onClick={() => void handleDownload()}
              disabled={downloading || !artifact}
            >
              {downloading ? (
                <SpinnerIcon size={15} className="animate-spin" />
              ) : (
                <DownloadSimpleIcon size={15} />
              )}
              {downloading
                ? "下载中…"
                : artifact
                  ? `下载 ${PLATFORM_LABELS[artifact.platform]} 产物`
                  : "当前平台无产物"}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

import { useMemo, useState } from "react";
import { DownloadSimpleIcon, GitBranchIcon, SpinnerIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex } from "~/components/ScaleAwareThemes";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  ignoreBetaRun,
  isTauriRuntime,
  type BetaArtifactInfo,
} from "~/logic/update/update-checker";
import { downloadBetaArtifact } from "~/logic/update/beta-download";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface BetaUpdateAvailableDialogProps {
  info: BetaArtifactInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

export default function BetaUpdateAvailableDialog({
  info,
  open,
  onOpenChange,
}: BetaUpdateAvailableDialogProps) {
  const [downloading, setDownloading] = useState(false);

  const notesHtml = useMemo(() => {
    if (!info) return "";
    return renderCommentMarkdownHtml(
      `**工作流：** ${info.workflowName}\n` +
        `**运行编号：** #${info.runNumber}\n` +
        `**构建产物：** ${info.artifactName}\n` +
        `**大小：** ${formatSize(info.artifactSize)}\n` +
        `**创建时间：** ${info.createdAt}`,
    ).trim();
  }, [info]);

  if (!info) return null;

  const handleViewWorkflow = () => {
    openUrl(info.htmlUrl).catch(() =>
      window.open(info.htmlUrl, "_blank", "noopener,noreferrer"),
    );
  };

  const handleDownload = async () => {
    // 非 Tauri 环境无法带鉴权下载，退回到打开构建页面
    if (!isTauriRuntime()) {
      handleViewWorkflow();
      return;
    }
    try {
      const targetPath = await save({
        title: "保存 Beta 构建产物",
        defaultPath: `${info.artifactName}.zip`,
        filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
      });
      if (!targetPath) return;

      setDownloading(true);
      const bytes = await downloadBetaArtifact(info, targetPath);
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
    ignoreBetaRun(info.runId);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>发现新的 Beta 构建 #{info.runNumber}</Dialog.Title>

        <div className="mb-4 max-h-[var(--ui-viewport-height-46pct)] overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[13px] leading-relaxed text-white/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {notesHtml ? (
            <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
          ) : (
            <p className="text-white/40">本次构建暂无详细信息。</p>
          )}
        </div>

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
            <Button onClick={() => void handleDownload()} disabled={downloading}>
              {downloading ? (
                <SpinnerIcon size={15} className="animate-spin" />
              ) : (
                <DownloadSimpleIcon size={15} />
              )}
              {downloading ? "下载中…" : "下载 Artifact"}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
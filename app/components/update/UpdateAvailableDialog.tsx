import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex } from "~/components/ScaleAwareThemes";
import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ignoreTag,
  type UpdateInfo,
} from "~/logic/update/update-checker";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface UpdateAvailableDialogProps {
  info: UpdateInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UpdateAvailableDialog({
  info,
  open,
  onOpenChange,
}: UpdateAvailableDialogProps) {
  const notesHtml = useMemo(
    () => renderCommentMarkdownHtml(info?.body || "").trim(),
    [info?.body],
  );
  if (!info) return null;

  const handleDownload = () => {
    openUrl(info.htmlUrl).catch(() =>
      window.open(info.htmlUrl, "_blank", "noopener,noreferrer"),
    );
  };

  const handleIgnore = () => {
    ignoreTag(info.tagName);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>发现新版本 {info.name}</Dialog.Title>



        <div className="mb-4 max-h-[var(--ui-viewport-height-46pct)] overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[13px] leading-relaxed text-white/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {notesHtml ? (
            <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
          ) : (
            <p className="text-white/40">本次更新暂无说明。</p>
          )}
        </div>

        <Flex justify="between" align="center">
          <Button variant="soft" color="gray" onClick={handleIgnore}>
            忽略此版本
          </Button>
          <Flex gap="2" align="center">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleDownload}>
              <DownloadSimpleIcon size={15} />
              下载更新
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

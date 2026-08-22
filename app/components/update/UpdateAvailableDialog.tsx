import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  compareVersions,
  normalizeVersion,
  ignoreTag,
  type UpdateInfo,
} from "~/logic/update/update-checker";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface UpdateAvailableDialogProps {
  info: UpdateInfo | null;
  currentVersion: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPublishedDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function UpdateAvailableDialog({
  info,
  currentVersion,
  open,
  onOpenChange,
}: UpdateAvailableDialogProps) {
  const notesHtml = useMemo(
    () => renderCommentMarkdownHtml(info?.body || "").trim(),
    [info?.body],
  );
  if (!info) return null;
  const publishedLabel = formatPublishedDate(info.publishedAt);
  const outdated =
    !!currentVersion &&
    compareVersions(info.tagName, currentVersion) > 0;

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

        <Flex direction="column" gap="2" mb="3">
          <Text size="1" color="gray">
            当前版本 v{normalizeVersion(currentVersion ?? "") || "未知"}
            {" → "}
            最新版本 {info.tagName.startsWith("v") ? info.tagName : `v${info.tagName}`}
            {publishedLabel ? ` · ${publishedLabel}` : ""}
          </Text>
          {currentVersion && !outdated && (
            <Text size="1" color="amber">
              注意：该版本不高于当前版本（可能为手动指定的检查结果）。
            </Text>
          )}
        </Flex>

        <div className="mb-4 max-h-[46vh] overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[13px] leading-relaxed text-white/80">
          {notesHtml ? (
            <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
          ) : (
            <p className="text-white/40">本次更新暂无说明。</p>
          )}
        </div>

        <Flex justify="end" gap="3">
          <Button variant="ghost" color="gray" onClick={handleIgnore}>
            忽略此版本
          </Button>
          <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleDownload}>
            <DownloadSimpleIcon size={15} />
            下载更新
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

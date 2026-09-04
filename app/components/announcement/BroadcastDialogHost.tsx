import { Button, Dialog, Flex } from "~/components/ScaleAwareThemes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBroadcasts,
  filterUnseen,
  markBroadcastSeen,
  type BroadcastItem,
} from "~/logic/announcement/broadcast";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

// 错开启动时序：更新检测约 3 秒后进行，公告再晚一点，避免弹窗叠在一起
const FETCH_DELAY_MS = 4_500;

/** 启动后拉取官网公告并逐条弹窗展示；看过的内容不再重复弹出。 */
export default function BroadcastDialogHost() {
  const [queue, setQueue] = useState<BroadcastItem[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await fetchBroadcasts();
          if (!cancelled) setQueue(filterUnseen(items));
        } catch {
          // 公告拉取失败不打扰用户
        }
      })();
    }, FETCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const current = queue[0] ?? null;
  const contentHtml = useMemo(
    () => renderCommentMarkdownHtml(current?.content || "").trim(),
    [current?.content],
  );

  const dismissCurrent = () => {
    if (current) markBroadcastSeen(current);
    setQueue((items) => items.slice(1));
  };

  return (
    <Dialog.Root
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (!open) dismissCurrent();
      }}
    >
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{current?.title ?? ""}</Dialog.Title>

        <div className="mb-4 max-h-[var(--ui-viewport-height-52pct)] overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[13px] leading-relaxed text-white/80">
          {contentHtml ? (
            <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
          ) : (
            <p className="text-white/40">（无正文）</p>
          )}
        </div>

        <Flex justify="end" gap="3">
          <Button onClick={dismissCurrent}>知道了</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

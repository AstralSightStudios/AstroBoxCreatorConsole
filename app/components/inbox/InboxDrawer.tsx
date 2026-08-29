import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { XIcon } from "@phosphor-icons/react";
import { InboxApi } from "~/api/astrobox/inbox";
import type { InboxNotification } from "~/logic/inbox/types";
import { useInbox } from "~/logic/inbox/use-inbox";
import InboxMessageCard from "./InboxMessageCard";

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 30;

export default function InboxDrawer({ open, onClose }: InboxDrawerProps) {
  const { markRead, markAllRead, remove } = useInbox();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await InboxApi.list({ limit: PAGE_SIZE });
      setItems(res.items.filter((m) => m.kind === "cc-notice"));
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch {
      // 静默失败，保留空态。
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadInitial();
  }, [open, loadInitial]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await InboxApi.list({ limit: PAGE_SIZE, cursor: nextCursor });
      setItems((prev) => [
        ...prev,
        ...res.items.filter((m) => m.kind === "cc-notice"),
      ]);
      setNextCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  const handleRead = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((m) =>
          m.id === id && !m.readAt
            ? { ...m, readAt: new Date().toISOString() }
            : m,
        ),
      );
      void markRead(id);
    },
    [markRead],
  );

  const handleRemove = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((m) => m.id !== id));
      void remove(id);
    },
    [remove],
  );

  const handleMarkAllRead = useCallback(() => {
    setItems((prev) =>
      prev.map((m) =>
        m.readAt ? m : { ...m, readAt: new Date().toISOString() },
      ),
    );
    void markAllRead();
  }, [markAllRead]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-[min(420px,94vw)] flex-col border-l border-white/10 bg-nav"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium text-white/90">信箱</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="rounded-md px-2 py-1 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
                >
                  全部已读
                </button>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={onClose}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
                >
                  <XIcon size={16} />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {loading ? (
                <p className="py-8 text-center text-xs text-white/40">加载中…</p>
              ) : items.length === 0 ? (
                <p className="py-8 text-center text-xs text-white/40">
                  暂无审核通知
                </p>
              ) : (
                <>
                  {items.map((message) => (
                    <InboxMessageCard
                      key={message.id}
                      message={message}
                      onRead={handleRead}
                      onRemove={handleRemove}
                    />
                  ))}
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="block w-full rounded-md py-2 text-center text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80 disabled:opacity-50"
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

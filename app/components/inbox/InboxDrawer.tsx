import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { ScrollArea, Skeleton } from "@radix-ui/themes";
import { InboxApi } from "~/api/astrobox/inbox";
import {
  isCcNoticeMetadata,
  type InboxNotification,
} from "~/logic/inbox/types";
import { useInbox } from "~/logic/inbox/use-inbox";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import DynamicDrawerHandle from "./DynamicDrawerHandle";
import InboxMessageCard from "./InboxMessageCard";
import InboxReadStack from "./InboxReadStack";
import PanelButton from "./PanelButton";
import { iconButtonClass } from "./styles";
import type { PendingAction } from "./types";

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 30;

export default function InboxDrawer({ open, onClose }: InboxDrawerProps) {
  const { count, markRead, markAllRead, remove } = useInbox();
  const navigate = useNavigate();
  const { isDesktop } = useNavVisibility();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [readStackExpanded, setReadStackExpanded] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const pendingActionsRef = useRef<Map<string, PendingAction>>(new Map());
  const [pendingActions, setPendingActions] = useState<
    Map<string, PendingAction>
  >(new Map());
  // 窄屏底部抽屉：拖拽把手控制 sheet 位移。
  const sheetY = useMotionValue(0);
  const [dragProgress, setDragProgress] = useState(0);
  const dragStateRef = useRef<{ startY: number; baseY: number } | null>(null);

  const handleDragMove = useCallback((event: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const delta = event.clientY - drag.startY;
    sheetY.set(Math.max(0, drag.baseY + delta));
    setDragProgress(Math.min(1, Math.max(0, delta / 240)));
  }, [sheetY]);

  const handleDragEnd = useCallback(
    (event: PointerEvent) => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      const drag = dragStateRef.current;
      dragStateRef.current = null;
      setDragProgress(0);
      if (!drag) return;
      const delta = event.clientY - drag.startY;
      if (delta > 110) {
        // 先让 sheet 跟手滑出屏幕，再触发关闭动画，避免突兀跳走。
        void animate(
          sheetY,
          typeof window !== "undefined" ? window.innerHeight : 800,
          {
            type: "tween",
            duration: 0.18,
            ease: "easeIn",
            onComplete: () => onClose(),
          },
        );
        return;
      }
      void animate(sheetY, 0, {
        type: "spring",
        stiffness: 320,
        damping: 32,
      });
    },
    [animate, handleDragMove, onClose, sheetY],
  );

  const handleDragStart = useCallback(
    (event: React.PointerEvent) => {
      dragStateRef.current = { startY: event.clientY, baseY: sheetY.get() };
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", handleDragEnd);
    },
    [handleDragEnd, handleDragMove, sheetY],
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
    },
    [handleDragEnd, handleDragMove],
  );

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

  // 桌面端没有 X 按钮，点遮罩或按 Escape 也能关闭。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const unreadMessages = items.filter((message) => !message.readAt);
  const readMessages = items.filter((message) => !!message.readAt);
  const canCollapseReadMessages = readMessages.length > 1;

  useEffect(() => {
    if (readMessages.length <= 1) {
      setReadStackExpanded(false);
    }
  }, [readMessages.length]);

  useEffect(() => {
    if (readStackExpanded || !canCollapseReadMessages || !expandedId) return;
    if (!readMessages.some((message) => message.id === expandedId)) return;
    setExpandedId(null);
  }, [canCollapseReadMessages, expandedId, readMessages, readStackExpanded]);

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

  const applyReadLocal = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((m) =>
        m.id === id && !m.readAt
          ? { ...m, readAt: new Date().toISOString() }
          : m,
      ),
    );
  }, []);

  const handleMarkRead = useCallback(
    async (message: InboxNotification) => {
      if (message.readAt || pendingActionsRef.current.has(message.id)) return;
      pendingActionsRef.current.set(message.id, "read");
      setPendingActions(new Map(pendingActionsRef.current));
      try {
        applyReadLocal(message.id);
        await markRead(message.id);
      } catch {
        // ignore
      } finally {
        pendingActionsRef.current.delete(message.id);
        setPendingActions(new Map(pendingActionsRef.current));
      }
    },
    [applyReadLocal, markRead],
  );

  // 关闭抽屉时，若仍有展开中的未读消息，先补记已读。
  useEffect(() => {
    if (!open) {
      const expanded = expandedId
        ? items.find((message) => message.id === expandedId)
        : null;
      if (expanded && !expanded.readAt) {
        void handleMarkRead(expanded);
      }
      setExpandedId(null);
      setReadStackExpanded(false);
      pendingActionsRef.current.clear();
      setPendingActions(new Map());
      sheetY.set(0);
      setDragProgress(0);
    }
  }, [expandedId, handleMarkRead, items, open, sheetY]);

  const handleMarkAllRead = useCallback(async () => {
    if (bulkPending) return;
    setBulkPending(true);
    try {
      setItems((prev) =>
        prev.map((m) =>
          m.readAt ? m : { ...m, readAt: new Date().toISOString() },
        ),
      );
      await markAllRead();
    } catch {
      // ignore
    } finally {
      setBulkPending(false);
    }
  }, [bulkPending, markAllRead]);

  const handleDeleteMessage = useCallback(
    async (id: string) => {
      if (pendingActionsRef.current.has(id)) return;
      pendingActionsRef.current.set(id, "delete");
      setPendingActions(new Map(pendingActionsRef.current));
      try {
        setItems((prev) => prev.filter((m) => m.id !== id));
        await remove(id);
      } catch {
        // ignore
      } finally {
        pendingActionsRef.current.delete(id);
        setPendingActions(new Map(pendingActionsRef.current));
      }
    },
    [remove],
  );

  const handleToggleMessage = useCallback(
    (id: string) => {
      if (expandedId === id) {
        const target = items.find((message) => message.id === id);
        if (target && !target.readAt) {
          void handleMarkRead(target);
        }
        setExpandedId(null);
        return;
      }
      const prev = expandedId
        ? items.find((message) => message.id === expandedId)
        : null;
      if (prev && !prev.readAt) {
        void handleMarkRead(prev);
      }
      setExpandedId(id);
    },
    [expandedId, handleMarkRead, items],
  );

  const handleOpenResource = useCallback(
    (message: InboxNotification) => {
      const meta = isCcNoticeMetadata(message.metadata)
        ? message.metadata
        : null;
      if (!meta) return;
      const approved = meta.subtype === "review-approved";
      onClose();
      navigate(approved ? "/manage" : "/publish");
    },
    [navigate, onClose],
  );

  const panelContent = (
    <>
      <header className="flex items-start justify-between gap-3 px-5.5 pt-5.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-white">
            信箱
          </h1>
          <p className="mt-1 text-[12px] text-white/50">{count} 条未读</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PanelButton
            onClick={() => void handleMarkAllRead()}
            disabled={count === 0}
            loading={bulkPending}
          >
            全部已读
          </PanelButton>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          {loading && items.length === 0 ? (
            <div
              className="flex flex-col gap-2"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="sr-only">加载中</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`inbox-message-skeleton-${index}`}
                  className="flex items-start gap-3 rounded-[14px] corner-rounded bg-[var(--nav-btn-bg)] p-3"
                  aria-hidden="true"
                >
                  <Skeleton className="size-[22px] shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-white/45">
              暂无审核通知
            </div>
          ) : (
            <>
              {unreadMessages.map((message) => (
                <InboxMessageCard
                  key={message.id}
                  message={message}
                  expanded={expandedId === message.id}
                  pendingAction={pendingActions.get(message.id)}
                  onMarkRead={(m) => void handleMarkRead(m)}
                  onDeleteMessage={(id) => void handleDeleteMessage(id)}
                  onToggleMessage={handleToggleMessage}
                  onOpenResource={handleOpenResource}
                />
              ))}

              {readMessages.length > 0 && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between px-2 pt-2.5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[17px] font-[700] leading-none text-white">
                        已读
                      </h2>
                      <p className="mt-1 text-[12px] text-white/50">
                        {readMessages.length} 条
                      </p>
                    </div>
                    {canCollapseReadMessages ? (
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        type="button"
                        aria-label={readStackExpanded ? "折叠已读" : "展开已读"}
                        className={iconButtonClass}
                        onClick={() => setReadStackExpanded((prev) => !prev)}
                      >
                        {readStackExpanded ? (
                          <CaretUpIcon size={18} weight="bold" />
                        ) : (
                          <CaretDownIcon size={18} weight="bold" />
                        )}
                      </motion.button>
                    ) : null}
                  </div>

                  <div className="relative">
                    <InboxReadStack
                      messages={readMessages}
                      expanded={readStackExpanded || !canCollapseReadMessages}
                      expandedId={expandedId}
                      pendingActions={pendingActions}
                      onMarkRead={(m) => void handleMarkRead(m)}
                      onDeleteMessage={(id) => void handleDeleteMessage(id)}
                      onToggleMessage={handleToggleMessage}
                      onOpenResource={handleOpenResource}
                    />
                    {canCollapseReadMessages && !readStackExpanded ? (
                      <button
                        type="button"
                        className="tauri-no-drag absolute inset-0 z-20 rounded-[14px]"
                        aria-label="展开已读列表"
                        onClick={() => setReadStackExpanded(true)}
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}

          {hasMore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="tauri-no-drag block w-full rounded-md py-2 text-center text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80 disabled:opacity-50"
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-[110] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {isDesktop ? (
            <motion.aside
              className="fixed z-[120] flex w-[min(387px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[18px] text-white shadow-[var(--nav-panel-shadow)]"
              style={{
                top: "max(0.5rem, env(safe-area-inset-top))",
                bottom: "max(0.5rem, env(safe-area-inset-bottom))",
                right: "max(0.5rem, env(safe-area-inset-right))",
              }}
              initial={{ x: "calc(100% + 16px)" }}
              animate={{ x: 0 }}
              exit={{ x: "calc(100% + 16px)" }}
              transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
            >
              {/* 浮层面板底：窄屏侧栏同款透明度 + 背景模糊 */}
              <div
                className="absolute inset-0 rounded-[18px] border border-[var(--nav-border-strong)] backdrop-blur-[40px]"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
              />
              <div className="relative z-1 flex h-full w-full flex-col">
                {panelContent}
              </div>
            </motion.aside>
          ) : (
            <motion.div
              className="fixed inset-x-0 top-0 z-[120] w-screen"
              style={{
                height: "100dvh",
                paddingTop: "max(100px, calc(env(safe-area-inset-top) + 56px))",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "tween",
                duration: 0.28,
                ease: [0.32, 0.72, 0, 1],
              }}
            >
              {/* 窄屏底部抽屉：圆角顶 + 毛玻璃 + 可拖动把手 */}
              <motion.div
                style={{ y: sheetY }}
                className="relative flex h-full w-full flex-col overflow-hidden rounded-t-[24px] border-t-[1.5px] border-[var(--nav-border-strong)] bg-[rgba(0,0,0,0.75)] pt-2.5 text-white backdrop-blur-md"
              >
                <button
                  type="button"
                  aria-label="收起信箱"
                  onPointerDown={handleDragStart}
                  style={{ touchAction: "none" }}
                  className="tauri-no-drag mx-auto flex h-11 w-16 shrink-0 items-center justify-center bg-transparent text-[rgba(255,255,255,0.5)]"
                >
                  <DynamicDrawerHandle progress={dragProgress} direction="down" />
                </button>
                <div className="relative z-1 flex min-h-0 flex-1 flex-col pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                  {panelContent}
                </div>
              </motion.div>
            </motion.div>
          )}
        </>
      ) : null}
    </AnimatePresence>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { ScrollArea, Skeleton } from "@radix-ui/themes";
import { toast } from "sonner";
import { InboxApi } from "~/api/astrobox/inbox";
import {
  isCcNoticeMetadata,
  type InboxNotification,
} from "~/logic/inbox/types";
import { useInbox } from "~/logic/inbox/use-inbox";
import { useAccountState } from "~/logic/account/store";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
import InboxMessageCard from "./InboxMessageCard";
import InboxReadStack from "./InboxReadStack";
import PanelButton from "./PanelButton";
import { iconButtonClass } from "./styles";
import type { PendingAction } from "./types";

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * 打开时复用一条已存在（由导航抽屉写入）的临时历史记录。
   * `true` 时用 `replaceState` 接管该记录，避免返回时要按两次。
   */
  replaceHistoryEntry?: boolean;
}

/** 与 AstroBox 端一致：一次拉满 60 条，不做分页。 */
const PAGE_SIZE = 60;
const INBOX_QUERY_KEY = "astrobox-inbox";
/** 打开抽屉时写入的临时历史记录标记，用于接管 Android 返回键/返回手势。 */
const INBOX_HISTORY_STATE = "__inboxDrawerOpen";

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function InboxDrawer({
  open,
  onClose,
  replaceHistoryEntry = false,
}: InboxDrawerProps) {
  const { count, markRead, markAllRead, remove, refreshUnread } = useInbox();
  const navigate = useNavigate();
  const token = useAccountState().astrobox?.token;
  // 首次打开前不请求，之后由 React Query 缓存；抽屉常驻挂载，开合不再打接口。
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const {
    data: inboxData,
    error: inboxError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [INBOX_QUERY_KEY, token],
    queryFn: () => InboxApi.list({ limit: PAGE_SIZE }),
    enabled: hasOpenedOnce && Boolean(token),
    refetchOnWindowFocus: false,
  });
  // 信箱只展示资源审核通知，其余类型（评论回复等）由 AstroBox 端负责。
  const items = useMemo(
    () => (inboxData?.items ?? []).filter((m) => m.kind === "cc-notice"),
    [inboxData],
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [readStackExpanded, setReadStackExpanded] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const pendingActionsRef = useRef<Map<string, PendingAction>>(new Map());
  const [pendingActions, setPendingActions] = useState<
    Map<string, PendingAction>
  >(new Map());
  // 抽屉当前是否持有一条临时历史记录（打开时写入，关闭时消费）。
  const historyEntryActiveRef = useRef(false);

  useEffect(() => {
    if (open) setHasOpenedOnce(true);
  }, [open]);

  // Android 系统返回手势/返回键：打开抽屉时压入一条临时历史记录，返回时
  // 消费它并关闭抽屉，而不是让 WebView 退到上一层页面。窄屏下信箱由导航
  // 抽屉内的入口打开，此时 openInbox 已把导航的临时记录交接过来，用
  // replaceState 复用，保证一次返回只关闭信箱。
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (historyEntryActiveRef.current) return;

    const currentState =
      (window.history.state as Record<string, unknown> | null) ?? {};
    const nextState = { ...currentState, [INBOX_HISTORY_STATE]: true };
    if (replaceHistoryEntry) {
      window.history.replaceState(nextState, "");
    } else {
      window.history.pushState(nextState, "");
    }
    historyEntryActiveRef.current = true;

    return () => {
      if (!historyEntryActiveRef.current) return;
      historyEntryActiveRef.current = false;
      // 只有当前历史项仍是本抽屉写入的那条时才回退。若抽屉打开期间发生了
      // 路由导航（导航会替换掉这条临时记录），就不能再 back，否则会把刚
      // 打开的目标页面退掉。
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[INBOX_HISTORY_STATE]) {
        window.history.back();
      }
    };
  }, [open, replaceHistoryEntry]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      if (!historyEntryActiveRef.current) return;
      // 系统返回已经消费了临时记录，这里只负责关闭抽屉；不要再触发 back。
      historyEntryActiveRef.current = false;
      onClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onClose]);

  useEffect(() => {
    if (inboxError) toast.error(errorText(inboxError));
  }, [inboxError]);


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

  const handleMarkRead = useCallback(
    async (message: InboxNotification) => {
      if (message.readAt || pendingActionsRef.current.has(message.id)) return;
      pendingActionsRef.current.set(message.id, "read");
      setPendingActions(new Map(pendingActionsRef.current));
      try {
        await markRead(message.id);
        await refetch();
        await refreshUnread();
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        pendingActionsRef.current.delete(message.id);
        setPendingActions(new Map(pendingActionsRef.current));
      }
    },
    [markRead, refetch, refreshUnread],
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
    }
  }, [expandedId, handleMarkRead, items, open]);

  const handleMarkAllRead = useCallback(async () => {
    if (bulkPending) return;
    setBulkPending(true);
    try {
      await markAllRead();
      await refetch();
      await refreshUnread();
      toast.success("已全部标记为已读");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBulkPending(false);
    }
  }, [bulkPending, markAllRead, refetch, refreshUnread]);

  const handleDeleteMessage = useCallback(
    async (id: string) => {
      if (pendingActionsRef.current.has(id)) return;
      pendingActionsRef.current.set(id, "delete");
      setPendingActions(new Map(pendingActionsRef.current));
      try {
        await remove(id);
        await refetch();
        await refreshUnread();
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        pendingActionsRef.current.delete(id);
        setPendingActions(new Map(pendingActionsRef.current));
      }
    },
    [refetch, refreshUnread, remove],
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
      // 抽屉打开时当前历史项是临时记录，用 replace 让目标路由直接接管它；
      // 同时释放引用，避免关闭抽屉的清理逻辑再 back 一次。
      const replaceHistory = historyEntryActiveRef.current;
      if (replaceHistory) {
        historyEntryActiveRef.current = false;
      }
      onClose();
      navigate(
        approved ? "/manage" : "/publish",
        replaceHistory ? { replace: true } : undefined,
      );
    },
    [navigate, onClose],
  );

  const panelContent = (
    <>
      <header className="flex items-start justify-between gap-3 px-5.5 pt-5.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
            信箱
          </h1>
          <p className="mt-1 text-[12px] opacity-50">{count} 条未读</p>
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

      {/* scrollbars="vertical"：不挂载 Radix 的横向滚动条，viewport 的
          overflow-x 会恒为 hidden，即使内容意外超宽也不会出现 x 轴滑动。
          宽度锁定靠 app.css 的 .inbox-scroll-area 规则（见那里的说明）。 */}
      <ScrollArea
        scrollbars="vertical"
        data-vaul-no-drag
        className="inbox-scroll-area min-h-0 flex-1 overscroll-y-contain touch-pan-y"
      >
        <div className="flex w-full min-w-0 flex-col gap-2 px-3.5 pb-3.5">
          {isLoading && items.length === 0 ? (
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
                  className="flex items-start gap-3 rounded-[14px] squircle bg-[var(--nav-btn-bg)] p-3"
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
            <div className="py-16 text-center text-sm opacity-45">
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
                      <h2 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
                        已读通知
                      </h2>
                      <p className="mt-1 text-[12px] opacity-50">
                        {readMessages.length} 条通知
                      </p>
                    </div>
                    {canCollapseReadMessages ? (
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        type="button"
                        aria-label={
                          readStackExpanded
                            ? "收起已读通知"
                            : "展开已读通知"
                        }
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
                        aria-label={`展开 ${readMessages.length} 条已读通知`}
                        onClick={() => setReadStackExpanded(true)}
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </>
  );

  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="信箱"
      description="查看资源审核通知"
      handleLabel="收起信箱"
      sideOnDesktop
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 pb-[max(0.875rem,var(--ui-safe-area-bottom))]">
        {panelContent}
      </div>
    </FloatingDrawer>
  );
}

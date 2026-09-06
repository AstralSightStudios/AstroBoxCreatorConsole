import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Badge, Button, Spinner, TextArea } from "@radix-ui/themes";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import type { PartialOptions } from "overlayscrollbars";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  AFDIAN_DIALOGS_QUERY_KEY,
  getAfdianDialogs,
  getAfdianMessages,
  sendAfdianMessage,
  type AfdianDialog,
  type AfdianMessage,
  type AfdianMessagePage,
} from "~/api/afdian-messages";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
} from "~/api/afdian-account";
import Page from "~/layout/page";

const SIDEBAR_WIDTH_STORAGE_KEY = "afdian-messages-sidebar-width";
const SIDEBAR_MIN_WIDTH = 144;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_COMPACT_WIDTH = 220;
const AUTO_HIDE_SCROLLBAR_OPTIONS: PartialOptions = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: {
    theme: "os-theme-light",
    autoHide: "scroll",
    autoHideDelay: 700,
  },
};

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function getStoredSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!stored) return SIDEBAR_DEFAULT_WIDTH;
    const value = Number(stored);
    return Number.isFinite(value)
      ? clampSidebarWidth(value)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function AfdianOrderCard({ content }: { content: unknown }) {
  const record = asRecord(content);
  if (!record) return <p>此订单消息没有可显示的内容</p>;

  const productType = numberValue(record.product_type);
  const plan = asRecord(record.plan);
  const planName = textValue(plan?.name) || textValue(plan?.title);
  const skuDetails = Array.isArray(record.sku_detail)
    ? record.sku_detail
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          name: textValue(item.name),
          count: numberValue(item.count),
        }))
        .filter((item) => item.name && item.name !== "默认型号")
    : [];
  const displayName = [
    planName,
    ...skuDetails.map((item) => item.name),
  ].filter(Boolean).join(" · ");
  const amount =
    textValue(record.show_amount) ||
    textValue(record.total_amount) ||
    textValue(record.per_month);
  const month = numberValue(record.month);
  const remark = textValue(record.remark);
  const orderNo = textValue(record.out_trade_no);
  const isProduct = productType === 1;

  return (
    <div className="min-w-64 rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/55">{isProduct ? "商品订单" : "发电订单"}</p>
        {isProduct && (
          <Badge color="purple" variant="soft">
            商品
          </Badge>
        )}
      </div>
      {amount && (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-sm text-white/70">¥</span>
          <span className="text-xl font-medium text-white">{amount}</span>
          {month && month > 0 && !isProduct && (
            <span className="text-xs text-white/45">/ {month} 个月</span>
          )}
        </div>
      )}
      {displayName && (
        <p className="mt-2 line-clamp-2 text-sm text-white/75">{displayName}</p>
      )}
      {skuDetails.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-white/50">
          {skuDetails.map((item, index) => (
            <span key={`${item.name}-${index}`}>
              {item.name}
              {item.count && item.count > 1 ? ` × ${item.count}` : ""}
            </span>
          ))}
        </div>
      )}
      {remark && (
        <p className="mt-2 whitespace-pre-wrap border-t border-white/10 pt-2 text-xs leading-5 text-white/55">
          {remark}
        </p>
      )}
      {orderNo && (
        <p className="mt-2 truncate border-t border-white/10 pt-2 font-mono-sarasa text-[11px] text-white/35">
          {orderNo}
        </p>
      )}
    </div>
  );
}

function MessageContent({ message }: { message: AfdianMessage }) {
  if (message.messageType === 1 || typeof message.content === "string") {
    return <p className="whitespace-pre-wrap text-sm leading-6">{String(message.content)}</p>;
  }
  if (message.messageType === 2) {
    return <AfdianOrderCard content={message.content} />;
  }
  if (message.messageType === 4) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-6 text-white/70">
        {typeof message.content === "string"
          ? message.content
          : "系统消息"}
      </p>
    );
  }
  return <p className="text-sm text-white/55">此类消息请在爱发电中查看</p>;
}

function MessageBubble({ message }: { message: AfdianMessage }) {
  const sent = message.direction === "send";
  return (
    <div className={`flex ${sent ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(640px,85%)] rounded-xl px-3.5 py-2.5 ${
          sent ? "bg-purple-500/20 text-white" : "bg-white/[0.06] text-white/85"
        }`}
      >
        <MessageContent message={message} />
        <p className="mt-1 text-right text-[11px] text-white/40">
          {formatDateTime(message.sentAt)}
        </p>
      </div>
    </div>
  );
}

function DialogList({
  items,
  selectedUserId,
  onSelect,
  compact,
  onScroll,
}: {
  items: AfdianDialog[];
  selectedUserId: string;
  onSelect: (userId: string) => void;
  compact: boolean;
  onScroll?: (element: HTMLElement) => void;
}) {
  return (
    <OverlayScrollbarsComponent
      defer
      className="min-h-0 flex-1"
      options={AUTO_HIDE_SCROLLBAR_OPTIONS}
      events={
        onScroll
          ? {
              scroll: (instance) => {
                onScroll(instance.elements().scrollOffsetElement);
              },
            }
          : undefined
      }
    >
      <div
        className={`flex min-h-full flex-col ${
          compact ? "items-center gap-2 px-1" : "gap-1"
        }`}
      >
        {items.map((item) => {
          const selected = item.user.userId === selectedUserId;
          return (
            <button
              key={item.user.userId}
              type="button"
              className={
                compact
                  ? `flex w-full shrink-0 flex-col items-center gap-2 rounded-xl px-1.5 py-3 text-center transition-colors ${
                      selected
                        ? "bg-blue-500/90 text-white"
                        : "text-white/55 hover:bg-white/[0.05]"
                    }`
                  : `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      selected ? "bg-white/10" : "hover:bg-white/[0.05]"
                    }`
              }
              onClick={() => onSelect(item.user.userId)}
            >
              <span className="relative">
                <Avatar
                  size={compact ? "4" : "3"}
                  radius="full"
                  src={item.user.avatar ?? undefined}
                  fallback={item.user.name.slice(0, 1) || "爱"}
                />
                {item.unreadCount > 0 && (
                  <Badge
                    color="red"
                    variant="solid"
                    className={`absolute justify-center px-1 text-[10px] ${
                      compact ? "-right-2 -top-2 min-w-4" : "-right-2 -top-2"
                    }`}
                  >
                    {item.unreadCount > 99 ? "99+" : item.unreadCount}
                  </Badge>
                )}
              </span>
              {compact ? (
                <span className="w-full truncate text-xs">
                  {item.user.name}
                </span>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm text-white/85">
                      {item.user.name}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-white/40">
                    {item.preview || "暂无消息摘要"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
        {items.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-white/45">
            暂无私信对话
          </p>
        )}
      </div>
    </OverlayScrollbarsComponent>
  );
}

function MessageComposer({
  value,
  error,
  sending,
  disabled,
  onChange,
  onSend,
}: {
  value: string;
  error: string;
  sending: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-white/10 px-3 pb-3 pt-2.5">
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      <div className="flex items-end gap-2">
        <TextArea
          value={value}
          disabled={sending}
          placeholder="输入私信内容，按 Enter 发送"
          className="min-h-[72px] min-w-0 flex-1 resize-none border border-white/10 bg-black/20 text-sm text-white/85 outline-none placeholder:text-white/30"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          disabled={disabled || sending}
          onClick={onSend}
          className="shrink-0"
        >
          {sending ? <Spinner size="1" /> : "发送"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-white/35">Shift + Enter 换行</p>
    </div>
  );
}

export default function AfdianMessagesPage() {
  const nativeAvailable = isAfdianNativeAvailable();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedUserId, setSelectedUserId] = useState(
    searchParams.get("userId") || "",
  );
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });
  const connected = sessionQuery.data?.connected === true;
  const dialogsQuery = useInfiniteQuery({
    queryKey: AFDIAN_DIALOGS_QUERY_KEY,
    queryFn: ({ pageParam }) => getAfdianDialogs(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: nativeAvailable && connected,
    staleTime: 30_000,
    retry: 1,
  });
  const dialogs = dialogsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    const requestedUserId = searchParams.get("userId");
    if (requestedUserId && requestedUserId !== selectedUserId) {
      setSelectedUserId(requestedUserId);
      return;
    }
    if (!selectedUserId && dialogs[0]) {
      setSelectedUserId(dialogs[0].user.userId);
    }
  }, [dialogs, searchParams, selectedUserId]);

  const selectedDialog = dialogs.find(
    (item) => item.user.userId === selectedUserId,
  );
  const messagesQuery = useInfiniteQuery({
    queryKey: ["afdian", "messages", selectedUserId],
    queryFn: ({ pageParam }) =>
      getAfdianMessages({
        userId: selectedUserId,
        messageType: pageParam ? "old" : "new",
        messageId: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.oldestMessageId ?? undefined : undefined,
    enabled: nativeAvailable && connected && Boolean(selectedUserId),
    staleTime: 10_000,
    retry: 1,
  });
  const messages = useMemo(() => {
    const unique = new Map<string, AfdianMessage>();
    for (const item of messagesQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      unique.set(item.id, item);
    }
    return [...unique.values()].sort((left, right) => {
      const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : 0;
      const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : 0;
      return leftTime - rightTime;
    });
  }, [messagesQuery.data]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef =
    useRef<OverlayScrollbarsComponentRef<"div">>(null);
  const shouldScrollToBottomRef = useRef(true);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const compactSidebar = sidebarWidth < SIDEBAR_COMPACT_WIDTH;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_WIDTH_STORAGE_KEY,
        String(sidebarWidth),
      );
    } catch {
      return;
    }
  }, [sidebarWidth]);

  useEffect(() => {
    setDraft("");
    setSendError("");
    shouldScrollToBottomRef.current = true;
  }, [selectedUserId]);

  useEffect(() => {
    if (
      !selectedUserId ||
      messagesQuery.isLoading ||
      messagesQuery.isError ||
      messages.length === 0 ||
      !shouldScrollToBottomRef.current
    ) {
      return;
    }
    shouldScrollToBottomRef.current = false;
    const frame = requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current
        ?.osInstance()
        ?.elements().scrollOffsetElement;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    messages.length,
    messagesQuery.isError,
    messagesQuery.isLoading,
    selectedUserId,
  ]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !selectedUserId || isSending) return;

    setIsSending(true);
    setSendError("");
    try {
      const sentMessage = await sendAfdianMessage({
        userId: selectedUserId,
        content,
      });
      queryClient.setQueryData<{
        pages: AfdianMessagePage[];
        pageParams: unknown[];
      }>(["afdian", "messages", selectedUserId], (current) => {
        if (!current || current.pages.length === 0) return current;
        const firstPage = current.pages[0];
        const items = firstPage.items.some((item) => item.id === sentMessage.id)
          ? firstPage.items.map((item) =>
              item.id === sentMessage.id ? sentMessage : item,
            )
          : [...firstPage.items, sentMessage];
        return {
          ...current,
          pages: [{ ...firstPage, items }, ...current.pages.slice(1)],
        };
      });
      setDraft("");
      shouldScrollToBottomRef.current = true;
      void queryClient.invalidateQueries({
        queryKey: AFDIAN_DIALOGS_QUERY_KEY,
      });
      requestAnimationFrame(() => {
        const viewport = messagesViewportRef.current
          ?.osInstance()
          ?.elements().scrollOffsetElement;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    } catch (error) {
      setSendError(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "消息发送失败",
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const nextWidth = event.clientX - workspace.getBoundingClientRect().left;
    setSidebarWidth(clampSidebarWidth(nextWidth));
  };

  const handleResizePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
  };

  const handleDialogScroll = (target: HTMLElement) => {
    if (
      !compactSidebar ||
      !dialogsQuery.hasNextPage ||
      dialogsQuery.isFetchingNextPage
    ) {
      return;
    }
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 80) {
      void dialogsQuery.fetchNextPage();
    }
  };

  const selectDialog = (userId: string) => {
    setSelectedUserId(userId);
    setSearchParams({ userId }, { replace: true });
  };

  if (!nativeAvailable) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
            爱发电私信仅支持客户端。
          </div>
        </div>
      </Page>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center px-3 py-20 text-sm text-white/50 sm:px-5">
          <Spinner />
        </div>
      </Page>
    );
  }

  if (sessionQuery.isError) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
            {getAfdianErrorMessage(sessionQuery.error, "无法读取爱发电登录状态")}
          </div>
        </div>
      </Page>
    );
  }

  if (!connected) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-nav-item px-5 py-12 text-center">
            <p className="text-white/80">尚未登录爱发电</p>
            <p className="text-sm text-white/50">登录后即可查看私信对话。</p>
            <Button onClick={() => navigate("/settings")}>
              前往设置
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-3 sm:px-5">
        {dialogsQuery.isError ? (
          <div className="flex items-center justify-between rounded-xl bg-nav-item px-4 py-3 text-sm text-white/60">
            <span>私信列表暂时无法加载</span>
            <Button variant="soft" onClick={() => void dialogsQuery.refetch()}>
              <ArrowClockwiseIcon size={14} />
              重试
            </Button>
          </div>
        ) : dialogsQuery.isLoading ? (
          <div className="flex items-center justify-center rounded-xl bg-nav-item py-16 text-sm text-white/50">
            <Spinner />
          </div>
        ) : (
          <div
            ref={workspaceRef}
            className={isResizing ? "flex min-h-0 flex-1 select-none" : "flex min-h-0 flex-1"}
          >
            <section
              style={{ width: sidebarWidth }}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl bg-nav-item p-2"
            >
              {!compactSidebar && (
                <div className="flex shrink-0 items-center justify-between px-2 py-2">
                  <p className="text-sm font-medium text-white/80">全部对话</p>
                  {dialogsQuery.hasNextPage && (
                    <Button
                      size="1"
                      variant="ghost"
                      disabled={dialogsQuery.isFetchingNextPage}
                      onClick={() => void dialogsQuery.fetchNextPage()}
                    >
                      {dialogsQuery.isFetchingNextPage ? <Spinner size="1" /> : "加载更多"}
                    </Button>
                  )}
                </div>
              )}
              <DialogList
                items={dialogs}
                selectedUserId={selectedUserId}
                onSelect={selectDialog}
                compact={compactSidebar}
                onScroll={handleDialogScroll}
              />
            </section>

            <div
              role="separator"
              aria-label="调整对话列表宽度"
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className="group flex w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center outline-none"
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onPointerCancel={handleResizePointerUp}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setSidebarWidth((value) =>
                    Math.max(SIDEBAR_MIN_WIDTH, value - 16),
                  );
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setSidebarWidth((value) =>
                    Math.min(SIDEBAR_MAX_WIDTH, value + 16),
                  );
                }
              }}
            >
              <span className="my-3 w-px bg-white/10 transition-colors group-hover:bg-white/25 group-focus:bg-white/35" />
            </div>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-nav-item">
              {selectedDialog ? (
                <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
                  <Avatar
                    size="3"
                    radius="full"
                    src={selectedDialog.user.avatar ?? undefined}
                    fallback={selectedDialog.user.name.slice(0, 1) || "爱"}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/90">
                      {selectedDialog.user.name}
                    </p>
                    <p className="text-xs text-white/40">
                      最近消息 {formatDateTime(selectedDialog.sentAt)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex min-h-0 flex-1 flex-col">
                {messagesQuery.isLoading ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/50">
                    <Spinner />
                  </div>
                ) : messagesQuery.isError ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/50">
                    私信内容暂时无法加载
                  </div>
                ) : !selectedDialog ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/45">
                    请选择一个对话
                  </div>
                ) : (
                  <OverlayScrollbarsComponent
                    defer
                    ref={messagesViewportRef}
                    className="min-h-0 flex-1"
                    options={AUTO_HIDE_SCROLLBAR_OPTIONS}
                  >
                    <div className="flex min-h-full flex-col px-4">
                      {messagesQuery.hasNextPage && (
                        <Button
                          variant="ghost"
                          className="my-2 flex shrink-0 self-center"
                          disabled={messagesQuery.isFetchingNextPage}
                          onClick={() => void messagesQuery.fetchNextPage()}
                        >
                          {messagesQuery.isFetchingNextPage ? <Spinner size="1" /> : "加载更早消息"}
                        </Button>
                      )}
                      <div className="flex min-h-full flex-1 flex-col gap-2 py-3">
                        {messages.map((message) => (
                          <MessageBubble key={message.id} message={message} />
                        ))}
                        {messages.length === 0 && (
                          <div className="flex flex-1 items-center justify-center text-sm text-white/45">
                            暂无消息内容
                          </div>
                        )}
                      </div>
                    </div>
                  </OverlayScrollbarsComponent>
                )}

                {selectedDialog && !messagesQuery.isLoading && (
                  <MessageComposer
                    value={draft}
                    error={sendError}
                    sending={isSending}
                    disabled={!draft.trim()}
                    onChange={(value) => {
                      setDraft(value);
                      if (sendError) setSendError("");
                    }}
                    onSend={() => void handleSend()}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

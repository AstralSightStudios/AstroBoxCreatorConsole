import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Avatar, Badge, Button, Spinner } from "@radix-ui/themes";
import type { PartialOptions } from "overlayscrollbars";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useSearchParams } from "react-router";
import {
  AFDIAN_DIALOGS_QUERY_KEY,
  getAfdianDialogs,
  type AfdianDialog,
} from "~/api/afdian-messages";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
} from "~/api/afdian-account";

const DIALOG_LIST_SCROLLBAR_OPTIONS: PartialOptions = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: {
    theme: "os-theme-light",
    autoHide: "scroll",
    autoHideDelay: 700,
  },
};

export function AfdianDialogList({
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
      options={DIALOG_LIST_SCROLLBAR_OPTIONS}
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

export default function AfdianMessagesSidebar() {
  const nativeAvailable = isAfdianNativeAvailable();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });
  const dialogsQuery = useInfiniteQuery({
    queryKey: AFDIAN_DIALOGS_QUERY_KEY,
    queryFn: ({ pageParam }) => getAfdianDialogs(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: nativeAvailable && sessionQuery.data?.connected === true,
    staleTime: 30_000,
    retry: 1,
  });
  const dialogs = dialogsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedUserId = searchParams.get("userId") || "";

  const selectDialog = (userId: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("userId", userId);
    setSearchParams(nextSearchParams, { replace: true });
  };

  let content;

  if (!nativeAvailable) {
    content = (
      <p className="px-3 py-8 text-center text-sm text-white/45">
        爱发电私信仅支持客户端
      </p>
    );
  } else if (sessionQuery.isLoading || dialogsQuery.isLoading) {
    content = (
      <div className="flex flex-1 items-center justify-center text-white/50">
        <Spinner />
      </div>
    );
  } else if (sessionQuery.isError) {
    content = (
      <div className="flex flex-col items-center gap-3 px-3 py-8 text-center text-sm text-white/50">
        <p>{getAfdianErrorMessage(sessionQuery.error, "无法读取爱发电登录状态")}</p>
        <Button size="1" variant="soft" onClick={() => void sessionQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  } else if (!sessionQuery.data?.connected) {
    content = (
      <p className="px-3 py-8 text-center text-sm text-white/45">
        尚未登录爱发电
      </p>
    );
  } else if (dialogsQuery.isError) {
    content = (
      <div className="flex flex-col items-center gap-3 px-3 py-8 text-center text-sm text-white/50">
        <p>私信列表暂时无法加载</p>
        <Button size="1" variant="soft" onClick={() => void dialogsQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  } else {
    content = (
      <AfdianDialogList
        items={dialogs}
        selectedUserId={selectedUserId}
        onSelect={selectDialog}
        compact={false}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
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
      {content}
    </section>
  );
}

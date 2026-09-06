import { useInfiniteQuery } from "@tanstack/react-query";
import { Avatar, Badge, Spinner } from "@radix-ui/themes";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import {
  AFDIAN_DIALOGS_QUERY_KEY,
  getAfdianDialogs,
  type AfdianDialog,
} from "~/api/afdian-messages";

interface AfdianRecentConversationsProps {
  enabled: boolean;
  limit: 10 | 20;
}

function formatUnreadCount(value: number) {
  return value > 99 ? "99+" : String(value);
}

function ConversationItem({ item }: { item: AfdianDialog }) {
  const navigate = useNavigate();
  const unread = item.unreadCount > 0;

  return (
    <button
      type="button"
      className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-lg px-1 py-1 text-center transition-colors hover:bg-white/5 active:bg-white/10"
      title={item.preview || item.user.name}
      onClick={() =>
        navigate(`/afdian-messages?userId=${encodeURIComponent(item.user.userId)}`)
      }
    >
      <span className="relative">
        <Avatar
          size="3"
          radius="full"
          src={item.user.avatar ?? undefined}
          fallback={item.user.name.slice(0, 1) || "爱"}
        />
        {unread && (
          <Badge
            color="red"
            variant="solid"
            className="absolute -right-2 -top-2 min-w-4 justify-center px-1 text-[10px]"
          >
            {formatUnreadCount(item.unreadCount)}
          </Badge>
        )}
      </span>
      <span className="w-full truncate text-xs text-white/70">{item.user.name}</span>
    </button>
  );
}

export default function AfdianRecentConversations({
  enabled,
  limit,
}: AfdianRecentConversationsProps) {
  const query = useInfiniteQuery({
    queryKey: AFDIAN_DIALOGS_QUERY_KEY,
    queryFn: ({ pageParam }) => getAfdianDialogs(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
  const conversations = Array.from(
    new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.user.userId,
        item,
      ]),
    ).values(),
  ).sort((left, right) => {
    const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : 0;
    const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : 0;
    return rightTime - leftTime;
  });
  const visibleConversations = conversations.slice(0, limit);

  useEffect(() => {
    if (
      !enabled ||
      visibleConversations.length >= limit ||
      !query.hasNextPage ||
      query.isFetchingNextPage
    ) {
      return;
    }
    void query.fetchNextPage();
  }, [
    enabled,
    limit,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    visibleConversations.length,
  ]);

  if (!enabled) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center px-1.5 pt-3">
        <p className="font-[520] text-size-large">最近私信</p>
      </div>

      {query.isLoading ? (
        <div className="flex items-center gap-2 px-1.5 py-3 text-size-small text-white/50">
          <Spinner size="1" />
          正在加载私信
        </div>
      ) : query.isError ? (
        <div className="px-1.5 py-3 text-size-small text-white/50">
          私信暂时无法加载
        </div>
      ) : visibleConversations.length === 0 ? (
        <div className="px-1.5 py-3 text-size-small text-white/50">
          暂无私信对话
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-1 pb-1">
            {visibleConversations.map((item) => (
              <ConversationItem
                key={item.user.userId}
                item={item}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

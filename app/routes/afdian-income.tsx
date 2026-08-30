import {
  Avatar,
  Badge,
  Button,
  Spinner,
  Table,
  Tabs,
} from "@radix-ui/themes";
import {
  ArrowClockwiseIcon,
  CurrencyCircleDollarIcon,
} from "@phosphor-icons/react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  AFDIAN_MANAGEMENT_OVERVIEW_QUERY_KEY,
  getAfdianIncomeStats,
  getAfdianManagementOverview,
  getAfdianReceivedOrders,
  getAfdianSponsors,
  type AfdianReceivedOrder,
} from "~/api/afdian-management";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
} from "~/api/afdian-account";
import DataCard from "~/components/cards/datacard";
import Page from "~/layout/page";
import { formatAfdianCurrency } from "~/logic/afdian/income";

type ManagementTab = "overview" | "stats" | "orders" | "sponsors";

function formatInteger(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN")
    : "--";
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getIncomeMonthLabel(asOf?: string) {
  if (!asOf) return "本月收入";
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return "本月收入";
  const month = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
  }).format(date);
  return `${month}收入`;
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/55">
      <Spinner size="2" />
      正在加载
    </div>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-white/55">
        {getAfdianErrorMessage(error, "爱发电数据暂时无法加载")}
      </p>
      <Button variant="soft" onClick={retry}>
        <ArrowClockwiseIcon size={15} />
        重试
      </Button>
    </div>
  );
}

function OverviewSection({ enabled }: { enabled: boolean }) {
  const query = useQuery({
    queryKey: AFDIAN_MANAGEMENT_OVERVIEW_QUERY_KEY,
    queryFn: getAfdianManagementOverview,
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  const data = query.data;
  const metrics = [
    { label: "今日收入", value: formatAfdianCurrency(data?.todayIncome) },
    { label: "今日订单数", value: formatInteger(data?.todayOrderCount) },
    { label: getIncomeMonthLabel(data?.asOf), value: formatAfdianCurrency(data?.monthIncome) },
    { label: "累计收入", value: formatAfdianCurrency(data?.allIncome) },
    { label: "近 31 天赞助者", value: formatInteger(data?.recentSponsorCount) },
    { label: "历史赞助者", value: formatInteger(data?.allSponsorCount) },
    { label: "主页访问人数", value: formatInteger(data?.uv) },
    { label: "主页访问次数", value: formatInteger(data?.pv) },
    { label: "当前可提现", value: formatAfdianCurrency(data?.balance) },
    { label: "当前可提现（税后）", value: formatAfdianCurrency(data?.balanceAfterTax) },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
      {metrics.map((metric) => (
        <DataCard key={metric.label} label={metric.label}>
          <p className="card-num">{metric.value}</p>
        </DataCard>
      ))}
    </div>
  );
}

function IncomeStatsSection({ enabled }: { enabled: boolean }) {
  const query = useInfiniteQuery({
    queryKey: ["afdian", "income-stats"],
    queryFn: ({ pageParam }) => getAfdianIncomeStats(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled,
    retry: 1,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl bg-nav-item">
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>日期</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>收入</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>订单</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>赞助者</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>老赞助者</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>访问人数</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.date}>
                <Table.RowHeaderCell>{item.date}</Table.RowHeaderCell>
                <Table.Cell>{formatAfdianCurrency(item.income)}</Table.Cell>
                <Table.Cell>{formatInteger(item.orderCount)}</Table.Cell>
                <Table.Cell>{formatInteger(item.sponsorCount)}</Table.Cell>
                <Table.Cell>{formatInteger(item.returningSponsorCount)}</Table.Cell>
                <Table.Cell>{formatInteger(item.uv)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </div>
      {items.length === 0 && (
        <p className="py-10 text-center text-sm text-white/50">暂无收入统计</p>
      )}
      {query.hasNextPage && (
        <Button
          variant="soft"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? <Spinner size="1" /> : "加载更多"}
        </Button>
      )}
    </div>
  );
}

function orderStatus(order: AfdianReceivedOrder) {
  switch (order.status) {
    case 1:
      return { label: "待支付", color: "amber" as const };
    case 2:
      return { label: "已支付", color: "green" as const };
    case 8:
      return { label: "待发货", color: "blue" as const };
    case 9:
      return { label: "已收货", color: "gray" as const };
    default:
      return { label: "未知状态", color: "gray" as const };
  }
}

function ReceivedOrdersSection({ enabled }: { enabled: boolean }) {
  const query = useInfiniteQuery({
    queryKey: ["afdian", "received-orders"],
    queryFn: ({ pageParam }) => getAfdianReceivedOrders(pageParam),
    initialPageParam: {
      page: 1,
      lastOrderId: null as string | null,
      lastCartOrderId: null as string | null,
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore
        ? {
            page: lastPage.page + 1,
            lastOrderId: lastPage.nextOrderId ?? null,
            lastCartOrderId: lastPage.nextCartOrderId ?? null,
          }
        : undefined,
    enabled,
    retry: 1,
  });
  const orders = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {orders.map((order) => {
        const status = orderStatus(order);
        return (
          <article key={order.id} className="rounded-xl bg-nav-item p-4">
            <div className="flex items-start gap-3">
              <Avatar
                size="3"
                src={order.sponsorAvatar ?? undefined}
                fallback={order.sponsorName.slice(0, 1) || "爱"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-white">{order.title}</p>
                  <Badge color={status.color} variant="soft">
                    {status.label}
                  </Badge>
                  <Badge color="gray" variant="soft">
                    {order.productType === 1 ? "商品" : "方案"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-white/55">
                  {order.sponsorName}
                  {order.planName ? ` · ${order.planName}` : ""}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {formatDateTime(order.createdAt)} · {order.id}
                </p>
                {order.remark && (
                  <p className="mt-2 text-sm text-white/70">留言：{order.remark}</p>
                )}
              </div>
              <p className="shrink-0 text-lg font-medium text-white">
                {formatAfdianCurrency(order.amount)}
              </p>
            </div>
          </article>
        );
      })}
      {orders.length === 0 && (
        <p className="py-10 text-center text-sm text-white/50">暂无收到的发电</p>
      )}
      {query.hasNextPage && (
        <Button
          variant="soft"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? <Spinner size="1" /> : "加载更多"}
        </Button>
      )}
    </div>
  );
}

function SponsorsSection({ enabled }: { enabled: boolean }) {
  const query = useInfiniteQuery({
    queryKey: ["afdian", "sponsors"],
    queryFn: ({ pageParam }) => getAfdianSponsors(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled,
    retry: 1,
  });
  const sponsors = query.data?.pages.flatMap((page) => page.items) ?? [];
  const totalCount = query.data?.pages[0]?.totalCount;

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="px-1 text-sm text-white/50">
        共 {formatInteger(totalCount)} 位赞助者
      </p>
      <div className="grid gap-2.5 lg:grid-cols-2">
        {sponsors.map((sponsor) => (
          <article key={sponsor.id} className="rounded-xl bg-nav-item p-4">
            <div className="flex items-start gap-3">
              <Avatar
                size="3"
                src={sponsor.avatar ?? undefined}
                fallback={sponsor.name.slice(0, 1) || "爱"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{sponsor.name}</p>
                <p className="mt-1 text-sm text-white/55">
                  累计发电 {formatAfdianCurrency(sponsor.totalAmount)}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  首次 {formatDateTime(sponsor.firstSponsoredAt)} · 最近{" "}
                  {formatDateTime(sponsor.lastSponsoredAt)}
                </p>
                {sponsor.planNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sponsor.planNames.map((name) => (
                      <Badge key={name} color="purple" variant="soft">
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {sponsors.length === 0 && (
        <p className="py-10 text-center text-sm text-white/50">暂无赞助者</p>
      )}
      {query.hasNextPage && (
        <Button
          variant="soft"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? <Spinner size="1" /> : "加载更多"}
        </Button>
      )}
    </div>
  );
}

export default function AfdianIncomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nativeAvailable = isAfdianNativeAvailable();
  const [tab, setTab] = useState<ManagementTab>("overview");
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });
  const connected = sessionQuery.data?.connected === true;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["afdian"] });
  };

  return (
    <Page>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CurrencyCircleDollarIcon size={25} className="text-purple-300" />
              <h1 className="text-2xl font-medium text-white">爱发电收入</h1>
            </div>
            <p className="mt-1 text-sm text-white/50">
              收入、订单与赞助者数据
            </p>
          </div>
          {connected && (
            <Button variant="soft" onClick={() => void refresh()}>
              <ArrowClockwiseIcon size={15} />
              刷新
            </Button>
          )}
        </div>

        {!nativeAvailable ? (
          <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
            爱发电收入管理仅支持客户端。
          </div>
        ) : sessionQuery.isLoading ? (
          <LoadingState />
        ) : sessionQuery.isError ? (
          <ErrorState
            error={sessionQuery.error}
            retry={() => void sessionQuery.refetch()}
          />
        ) : !connected ? (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-nav-item px-5 py-12 text-center">
            <p className="text-white/80">尚未登录爱发电</p>
            <p className="text-sm text-white/50">登录后即可查看收入与赞助者数据。</p>
            <Button onClick={() => navigate("/settings")}>前往设置</Button>
          </div>
        ) : (
          <Tabs.Root value={tab} onValueChange={(value) => setTab(value as ManagementTab)}>
            <div className="overflow-x-auto">
              <Tabs.List>
                <Tabs.Trigger value="overview">整体概况</Tabs.Trigger>
                <Tabs.Trigger value="stats">收入统计</Tabs.Trigger>
                <Tabs.Trigger value="orders">收到发电</Tabs.Trigger>
                <Tabs.Trigger value="sponsors">赞助者管理</Tabs.Trigger>
              </Tabs.List>
            </div>
            <div className="pt-4">
              <Tabs.Content value="overview">
                <OverviewSection enabled={tab === "overview"} />
              </Tabs.Content>
              <Tabs.Content value="stats">
                <IncomeStatsSection enabled={tab === "stats"} />
              </Tabs.Content>
              <Tabs.Content value="orders">
                <ReceivedOrdersSection enabled={tab === "orders"} />
              </Tabs.Content>
              <Tabs.Content value="sponsors">
                <SponsorsSection enabled={tab === "sponsors"} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        )}
      </div>
    </Page>
  );
}

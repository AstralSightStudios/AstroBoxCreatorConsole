import { ArrowCounterClockwiseIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AfdianIncomeOverview } from "~/api/afdian-account";
import type { AfdianManagementOverview } from "~/api/afdian-management";
import AfdianMonthlyIncomeCard from "~/components/afdian/monthly-income-card";
import AnimatedNumber from "~/components/animated-number";
import DataCard from "~/components/cards/datacard";
import { Button, Checkbox, Dialog } from "~/components/ScaleAwareThemes";
import {
  AFDIAN_CARD_GROUPS,
  DEFAULT_AFDIAN_CARD_IDS,
  buildAfdianOverviewValues,
  loadAfdianCardSelection,
  saveAfdianCardSelection,
  type AfdianCardId,
  type AfdianTrendPoint,
} from "~/logic/afdian/cards";
import { parseAfdianAmount } from "~/logic/afdian/income";

const CURRENCY_FORMAT: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const DISPLAY_GROUPS: Array<{
  id: string;
  label: string;
  cards: AfdianCardId[];
}> = [
  {
    id: "income",
    label: "收入",
    cards: [
      "monthly-overview",
      "today-income",
      "yesterday-income",
      "seven-day-income",
      "thirty-day-income",
      "previous-month-income",
      "all-income",
      "month-net-income",
      "previous-month-net-income",
      "all-net-income",
      "recent-income-chart",
      "monthly-income-chart",
    ],
  },
  {
    id: "sponsors",
    label: "发电人数",
    cards: [
      "today-sponsors",
      "yesterday-sponsors",
      "seven-day-sponsors",
      "thirty-day-sponsors",
      "month-sponsors",
      "previous-month-sponsors",
      "all-sponsors",
    ],
  },
  {
    id: "orders",
    label: "发电次数",
    cards: [
      "today-orders",
      "yesterday-orders",
      "seven-day-orders",
      "thirty-day-orders",
      "month-orders",
      "previous-month-orders",
    ],
  },
  {
    id: "visits",
    label: "访问数据",
    cards: [
      "yesterday-visits",
      "seven-day-visits",
      "thirty-day-visits",
      "month-visits",
      "previous-month-visits",
      "all-visitors",
      "all-visits",
      "visit-trend-chart",
    ],
  },
  {
    id: "withdrawal",
    label: "提现",
    cards: ["balance", "balance-after-tax", "withdrawal-countdown"],
  },
];

const CARD_LABELS = new Map(
  AFDIAN_CARD_GROUPS.flatMap((group) =>
    group.cards.map((card) => [card.id, card.label] as const),
  ),
);

function renderCurrency(value?: number | string | null) {
  const amount =
    typeof value === "number"
      ? value
      : parseAfdianAmount(value == null ? null : String(value));
  if (amount === null || !Number.isFinite(amount)) return "--";
  return (
    <AnimatedNumber
      value={amount}
      initial
      locales="zh-CN"
      format={CURRENCY_FORMAT}
      className="font-mono-sarasa"
    />
  );
}

function renderInteger(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return (
    <AnimatedNumber
      value={value}
      initial
      locales="zh-CN"
      format={{ maximumFractionDigits: 0 }}
      className="font-mono-sarasa"
    />
  );
}

function MetricCard({
  id,
  value,
  currency = false,
  suffix,
}: {
  id: AfdianCardId;
  value?: number | string | null;
  currency?: boolean;
  suffix?: string;
}) {
  const rendered = currency
    ? renderCurrency(value)
    : renderInteger(typeof value === "number" ? value : null);
  return (
    <DataCard label={CARD_LABELS.get(id) ?? "--"}>
      <p className="card-num">
        {rendered}
        {suffix && rendered !== "--" ? suffix : null}
      </p>
    </DataCard>
  );
}

function TrendCard({
  title,
  data,
  type,
}: {
  title: string;
  data: AfdianTrendPoint[];
  type: "income" | "visits";
}) {
  const chart =
    type === "visits" ? (
      <LineChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--gray-a5)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          minTickGap={20}
          tick={{ fill: "var(--gray-a10)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gray-a6)" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: "var(--gray-a10)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip type={type} />} />
        <Line
          dataKey="value"
          name="访问人数"
          type="monotone"
          stroke="var(--accent-9)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    ) : (
      <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--gray-a5)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          minTickGap={20}
          tick={{ fill: "var(--gray-a10)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gray-a6)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--gray-a10)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip type={type} />} />
        <Bar dataKey="value" name="收入" fill="var(--accent-9)" />
      </BarChart>
    );

  return (
    <DataCard label={title}>
      {data.length > 0 ? (
        <div className="h-56 w-full">
          <ResponsiveContainer>{chart}</ResponsiveContainer>
        </div>
      ) : (
        <div className="grid h-56 place-items-center text-sm text-white/45">
          暂无统计数据
        </div>
      )}
    </DataCard>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  type,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  type: "income" | "visits";
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-md border border-white/10 bg-nav px-3 py-2 text-sm">
      <p className="text-white/55">{label}</p>
      <p className="mt-1 text-white">
        {type === "income"
          ? new Intl.NumberFormat("zh-CN", CURRENCY_FORMAT).format(value ?? 0)
          : `${(value ?? 0).toLocaleString("zh-CN")} 人`}
      </p>
    </div>
  );
}

function CardPicker({
  selected,
  onChange,
}: {
  selected: readonly AfdianCardId[];
  onChange: (selection: AfdianCardId[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (id: AfdianCardId, checked: boolean) => {
    const next = new Set(selectedSet);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(
      AFDIAN_CARD_GROUPS.flatMap((group) => group.cards.map((card) => card.id)).filter(
        (cardId) => next.has(cardId),
      ),
    );
  };

  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button variant="soft">
          <SlidersHorizontalIcon size={15} />
          管理卡片
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>管理卡片</Dialog.Title>
        <Dialog.Description size="2">
          选择要在整体概况中显示的数据，卡片会按固定顺序排列。
        </Dialog.Description>
        <div className="mt-4 max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {AFDIAN_CARD_GROUPS.map((group) => (
            <section key={group.id}>
              <p className="mb-2 text-sm font-medium text-white/60">{group.label}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.cards.map((card) => (
                  <label
                    key={card.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-nav-item px-3 py-2.5 text-sm text-white/85"
                  >
                    <Checkbox
                      checked={selectedSet.has(card.id)}
                      onCheckedChange={(checked) => toggle(card.id, checked === true)}
                    />
                    {card.label}
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="soft"
            color="gray"
            onClick={() => onChange([...DEFAULT_AFDIAN_CARD_IDS])}
          >
            <ArrowCounterClockwiseIcon size={15} />
            恢复默认
          </Button>
          <Dialog.Close>
            <Button>完成</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function renderCard(
  id: AfdianCardId,
  data: AfdianManagementOverview,
  incomeOverview: AfdianIncomeOverview,
  values: ReturnType<typeof buildAfdianOverviewValues>,
) {
  switch (id) {
    case "monthly-overview":
      return (
        <AfdianMonthlyIncomeCard
          currentMonth={incomeOverview.currentMonth}
          previousMonth={incomeOverview.previousMonth}
          withdrawable={incomeOverview.withdrawable}
          asOf={incomeOverview.asOf}
        />
      );
    case "today-income":
      return <MetricCard id={id} value={data.todayIncome} currency />;
    case "yesterday-income":
      return <MetricCard id={id} value={values.yesterdayIncome} currency />;
    case "seven-day-income":
      return <MetricCard id={id} value={values.sevenDayIncome} currency />;
    case "thirty-day-income":
      return <MetricCard id={id} value={values.thirtyDayIncome} currency />;
    case "previous-month-income":
      return <MetricCard id={id} value={values.previousMonthIncome} currency />;
    case "all-income":
      return <MetricCard id={id} value={data.allIncome} currency />;
    case "month-net-income":
      return <MetricCard id={id} value={values.currentMonthNetIncome} currency />;
    case "previous-month-net-income":
      return <MetricCard id={id} value={values.previousMonthNetIncome} currency />;
    case "all-net-income":
      return <MetricCard id={id} value={values.allNetIncome} currency />;
    case "today-sponsors":
      return <MetricCard id={id} value={values.todaySponsors} />;
    case "yesterday-sponsors":
      return <MetricCard id={id} value={values.yesterdaySponsors} />;
    case "seven-day-sponsors":
      return <MetricCard id={id} value={values.sevenDaySponsors} />;
    case "thirty-day-sponsors":
      return <MetricCard id={id} value={values.thirtyDaySponsors} />;
    case "month-sponsors":
      return <MetricCard id={id} value={data.recentSponsorCount} />;
    case "previous-month-sponsors":
      return <MetricCard id={id} value={values.previousMonthSponsors} />;
    case "all-sponsors":
      return <MetricCard id={id} value={data.allSponsorCount} />;
    case "today-orders":
      return <MetricCard id={id} value={data.todayOrderCount} />;
    case "yesterday-orders":
      return <MetricCard id={id} value={values.yesterdayOrders} />;
    case "seven-day-orders":
      return <MetricCard id={id} value={values.sevenDayOrders} />;
    case "thirty-day-orders":
      return <MetricCard id={id} value={values.thirtyDayOrders} />;
    case "month-orders":
      return <MetricCard id={id} value={values.monthOrders} />;
    case "previous-month-orders":
      return <MetricCard id={id} value={values.previousMonthOrders} />;
    case "yesterday-visits":
      return <MetricCard id={id} value={values.yesterdayVisits} />;
    case "seven-day-visits":
      return <MetricCard id={id} value={values.sevenDayVisits} />;
    case "thirty-day-visits":
      return <MetricCard id={id} value={values.thirtyDayVisits} />;
    case "month-visits":
      return <MetricCard id={id} value={values.monthVisits} />;
    case "previous-month-visits":
      return <MetricCard id={id} value={values.previousMonthVisits} />;
    case "all-visitors":
      return <MetricCard id={id} value={data.uv} />;
    case "all-visits":
      return <MetricCard id={id} value={data.pv} />;
    case "balance":
      return <MetricCard id={id} value={data.balance} currency />;
    case "balance-after-tax":
      return <MetricCard id={id} value={data.balanceAfterTax} currency />;
    case "withdrawal-countdown":
      return (
        <MetricCard id={id} value={values.daysUntilWithdrawal} suffix="天" />
      );
    case "recent-income-chart":
      return <TrendCard title="近 30 天收入" data={values.incomeTrend} type="income" />;
    case "monthly-income-chart":
      return <TrendCard title="月度收入" data={values.monthlyIncomeTrend} type="income" />;
    case "visit-trend-chart":
      return <TrendCard title="访问人数趋势" data={values.visitTrend} type="visits" />;
  }
}

export default function AfdianOverviewDashboard({
  data,
  incomeOverview,
}: {
  data: AfdianManagementOverview;
  incomeOverview: AfdianIncomeOverview;
}) {
  const [selectedCards, setSelectedCards] = useState<AfdianCardId[]>(
    loadAfdianCardSelection,
  );
  const selectedSet = useMemo(() => new Set(selectedCards), [selectedCards]);
  const resolvedData = useMemo(
    () => ({
      ...data,
      todayIncome: incomeOverview.today,
      monthIncome: incomeOverview.currentMonth,
      asOf: incomeOverview.asOf,
    }),
    [data, incomeOverview],
  );
  const values = useMemo(
    () => buildAfdianOverviewValues(resolvedData),
    [resolvedData],
  );
  const updateSelection = (selection: AfdianCardId[]) => {
    setSelectedCards(selection);
    saveAfdianCardSelection(selection);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CardPicker selected={selectedCards} onChange={updateSelection} />
      </div>
      {DISPLAY_GROUPS.map((group) => {
        const visibleCards = group.cards.filter((id) => selectedSet.has(id));
        if (visibleCards.length === 0) return null;
        return (
          <section key={group.id}>
            <p className="mb-2 px-1 text-sm font-medium text-white/50">
              {group.label}
            </p>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
              {visibleCards.map((id) => {
                const wide =
                  id === "monthly-overview" ||
                  id === "recent-income-chart" ||
                  id === "monthly-income-chart" ||
                  id === "visit-trend-chart";
                return (
                  <div key={id} className={wide ? "col-span-2" : undefined}>
                    {renderCard(id, resolvedData, incomeOverview, values)}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {selectedCards.length === 0 && (
        <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
          尚未选择要显示的卡片。
        </div>
      )}
    </div>
  );
}

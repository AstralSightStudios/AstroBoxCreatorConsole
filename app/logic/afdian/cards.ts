import type {
  AfdianIncomeStatItem,
  AfdianManagementOverview,
  AfdianMonthlyIncomeItem,
} from "~/api/afdian-management";
import { calculateAfdianNet, parseAfdianAmount } from "~/logic/afdian/income";

export const AFDIAN_CARD_GROUPS = [
  {
    id: "charts",
    label: "图表",
    cards: [
      { id: "monthly-income-chart", label: "月度收入" },
      { id: "recent-income-chart", label: "近 30 天收入" },
      { id: "visit-trend-chart", label: "访问人数趋势" },
    ],
  },
  {
    id: "income",
    label: "收入",
    cards: [
      { id: "monthly-overview", label: "本月收入概览" },
      { id: "today-income", label: "今日收入" },
      { id: "yesterday-income", label: "昨日收入" },
      { id: "seven-day-income", label: "近 7 天收入" },
      { id: "thirty-day-income", label: "近 30 天收入" },
      { id: "previous-month-income", label: "上月收入" },
      { id: "all-income", label: "历史收入" },
      { id: "month-net-income", label: "本月收入（抽成后）" },
      { id: "previous-month-net-income", label: "上月收入（抽成后）" },
      { id: "all-net-income", label: "历史收入（抽成后）" },
    ],
  },
  {
    id: "sponsors",
    label: "发电人数",
    cards: [
      { id: "today-sponsors", label: "今日发电人数" },
      { id: "yesterday-sponsors", label: "昨日发电人数" },
      { id: "seven-day-sponsors", label: "近 7 天发电人数" },
      { id: "thirty-day-sponsors", label: "近 30 天发电人数" },
      { id: "month-sponsors", label: "本月发电人数" },
      { id: "previous-month-sponsors", label: "上月发电人数" },
      { id: "all-sponsors", label: "历史发电人数" },
    ],
  },
  {
    id: "orders",
    label: "发电次数",
    cards: [
      { id: "today-orders", label: "今日发电次数" },
      { id: "yesterday-orders", label: "昨日发电次数" },
      { id: "seven-day-orders", label: "近 7 天发电次数" },
      { id: "thirty-day-orders", label: "近 30 天发电次数" },
      { id: "month-orders", label: "本月发电次数" },
      { id: "previous-month-orders", label: "上月发电次数" },
    ],
  },
  {
    id: "visits",
    label: "访问数据",
    cards: [
      { id: "yesterday-visits", label: "昨日访问人数" },
      { id: "seven-day-visits", label: "近 7 天访问人数" },
      { id: "thirty-day-visits", label: "近 30 天访问人数" },
      { id: "month-visits", label: "本月访问人数" },
      { id: "previous-month-visits", label: "上月访问人数" },
      { id: "all-visitors", label: "历史访问人数" },
      { id: "all-visits", label: "历史访问次数" },
    ],
  },
  {
    id: "withdrawal",
    label: "提现",
    cards: [
      { id: "balance", label: "可提现（抽成前）" },
      { id: "balance-after-tax", label: "可提现（抽成后）" },
      { id: "withdrawal-countdown", label: "距离下次提现" },
    ],
  },
] as const;

export type AfdianCardId =
  (typeof AFDIAN_CARD_GROUPS)[number]["cards"][number]["id"];

export const DEFAULT_AFDIAN_CARD_IDS: readonly AfdianCardId[] = [
  "monthly-overview",
  "today-income",
  "all-income",
  "recent-income-chart",
  "month-sponsors",
  "all-sponsors",
  "today-orders",
  "yesterday-orders",
  "month-orders",
  "all-visitors",
  "all-visits",
  "visit-trend-chart",
  "balance",
  "balance-after-tax",
  "withdrawal-countdown",
];

export const AFDIAN_CARD_PREFERENCES_KEY = "afdian-dashboard-visible-cards";

const ALL_AFDIAN_CARD_IDS = AFDIAN_CARD_GROUPS.flatMap((group) =>
  group.cards.map((card) => card.id),
);
const AFDIAN_CARD_ID_SET = new Set<string>(ALL_AFDIAN_CARD_IDS);

export function normalizeAfdianCardSelection(value: unknown): AfdianCardId[] {
  if (!Array.isArray(value)) return [...DEFAULT_AFDIAN_CARD_IDS];
  const selected = new Set(
    value.filter(
      (item): item is AfdianCardId =>
        typeof item === "string" && AFDIAN_CARD_ID_SET.has(item),
    ),
  );
  return ALL_AFDIAN_CARD_IDS.filter((id) => selected.has(id));
}

export function loadAfdianCardSelection(): AfdianCardId[] {
  if (typeof window === "undefined") return [...DEFAULT_AFDIAN_CARD_IDS];
  try {
    const stored = window.localStorage.getItem(AFDIAN_CARD_PREFERENCES_KEY);
    return stored === null
      ? [...DEFAULT_AFDIAN_CARD_IDS]
      : normalizeAfdianCardSelection(JSON.parse(stored));
  } catch {
    return [...DEFAULT_AFDIAN_CARD_IDS];
  }
}

export function saveAfdianCardSelection(selection: readonly AfdianCardId[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AFDIAN_CARD_PREFERENCES_KEY,
      JSON.stringify(normalizeAfdianCardSelection(selection)),
    );
  } catch {
    return;
  }
}

export interface AfdianTrendPoint {
  key: string;
  label: string;
  value: number;
}

export interface AfdianOverviewValues {
  currentMonthIncome: number | null;
  previousMonthIncome: number | null;
  currentMonthNetIncome: number | null;
  previousMonthNetIncome: number | null;
  allNetIncome: number | null;
  yesterdayIncome: number | null;
  sevenDayIncome: number | null;
  thirtyDayIncome: number | null;
  todaySponsors: number | null;
  yesterdaySponsors: number | null;
  sevenDaySponsors: number | null;
  thirtyDaySponsors: number | null;
  previousMonthSponsors: number | null;
  yesterdayOrders: number | null;
  sevenDayOrders: number | null;
  thirtyDayOrders: number | null;
  monthOrders: number | null;
  previousMonthOrders: number | null;
  yesterdayVisits: number | null;
  sevenDayVisits: number | null;
  thirtyDayVisits: number | null;
  monthVisits: number | null;
  previousMonthVisits: number | null;
  daysUntilWithdrawal: number | null;
  incomeTrend: AfdianTrendPoint[];
  visitTrend: AfdianTrendPoint[];
  monthlyIncomeTrend: AfdianTrendPoint[];
}

interface DateRange {
  start: string;
  end: string;
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyFromUtc(value: Date) {
  return dateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function getShanghaiDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  if (!values.year || !values.month || !values.day) return null;
  return { year: values.year, month: values.month, day: values.day };
}

function offsetDateKey(parts: { year: number; month: number; day: number }, offset: number) {
  return dateKeyFromUtc(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset)),
  );
}

function getDateRanges(asOf: string) {
  const parts = getShanghaiDateParts(asOf);
  if (!parts) return null;
  const today = dateKey(parts.year, parts.month, parts.day);
  const tomorrow = offsetDateKey(parts, 1);
  const monthStart = dateKey(parts.year, parts.month, 1);
  const nextMonthDate = new Date(Date.UTC(parts.year, parts.month, 1));
  const previousMonthDate = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  const nextMonthStart = dateKeyFromUtc(nextMonthDate);
  const previousMonthStart = dateKeyFromUtc(previousMonthDate);
  return {
    parts,
    today,
    tomorrow,
    yesterday: { start: offsetDateKey(parts, -1), end: today },
    sevenDay: { start: offsetDateKey(parts, -6), end: tomorrow },
    thirtyDay: { start: offsetDateKey(parts, -29), end: tomorrow },
    month: { start: monthStart, end: nextMonthStart },
    previousMonth: { start: previousMonthStart, end: monthStart },
  };
}

function inRange(date: string, range: DateRange) {
  return date >= range.start && date < range.end;
}

function sumInteger(
  stats: readonly AfdianIncomeStatItem[],
  range: DateRange,
  field: "orderCount" | "sponsorCount" | "uv",
) {
  const values = stats
    .filter((item) => inRange(item.date, range))
    .map((item) => item[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function sumIncome(
  stats: readonly AfdianIncomeStatItem[],
  range: DateRange,
  today: string,
  todayIncome: string,
) {
  const values = stats
    .filter((item) => item.date !== today && inRange(item.date, range))
    .map((item) => parseAfdianAmount(item.income))
    .filter((value): value is number => value !== null);
  if (inRange(today, range)) {
    const current = parseAfdianAmount(todayIncome);
    if (current !== null) values.push(current);
  }
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function sumOrders(
  stats: readonly AfdianIncomeStatItem[],
  range: DateRange,
  today: string,
  todayOrderCount: number,
) {
  const values = stats
    .filter((item) => item.date !== today && inRange(item.date, range))
    .map((item) => item.orderCount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (inRange(today, range) && Number.isFinite(todayOrderCount)) {
    values.push(todayOrderCount);
  }
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function findMonthlyIncome(
  items: readonly AfdianMonthlyIncomeItem[],
  year: number,
  month: number,
) {
  return items.find((item) => item.year === year && item.month === month);
}

function getPreviousMonth(parts: { year: number; month: number }) {
  const date = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function shortDayLabel(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function buildDailyTrend(
  stats: readonly AfdianIncomeStatItem[],
  range: DateRange,
  field: "income" | "uv",
) {
  return stats
    .filter((item) => inRange(item.date, range))
    .map((item) => ({
      key: item.date,
      label: shortDayLabel(item.date),
      value:
        field === "income"
          ? parseAfdianAmount(item.income) ?? 0
          : typeof item.uv === "number"
            ? item.uv
            : 0,
    }));
}

function buildMonthlyTrend(
  data: AfdianManagementOverview,
  parts: { year: number; month: number },
) {
  const currentKey = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  const values = new Map<string, number>();
  for (const item of data.monthlyIncome) {
    const amount = parseAfdianAmount(item.totalAmount);
    if (amount !== null) {
      values.set(`${item.year}-${String(item.month).padStart(2, "0")}`, amount);
    }
  }
  const currentAmount = parseAfdianAmount(data.monthIncome);
  if (currentAmount !== null) values.set(currentKey, currentAmount);
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([key, value]) => {
      const [year, month] = key.split("-");
      return { key, label: `${year.slice(-2)}/${Number(month)}`, value };
    });
}

export function buildAfdianOverviewValues(
  data: AfdianManagementOverview,
): AfdianOverviewValues {
  const ranges = getDateRanges(data.asOf);
  if (!ranges) {
    return {
      currentMonthIncome: parseAfdianAmount(data.monthIncome),
      previousMonthIncome: null,
      currentMonthNetIncome: calculateAfdianNet(data.monthIncome),
      previousMonthNetIncome: null,
      allNetIncome: calculateAfdianNet(data.allIncome),
      yesterdayIncome: null,
      sevenDayIncome: null,
      thirtyDayIncome: null,
      todaySponsors: null,
      yesterdaySponsors: null,
      sevenDaySponsors: null,
      thirtyDaySponsors: null,
      previousMonthSponsors: null,
      yesterdayOrders: null,
      sevenDayOrders: null,
      thirtyDayOrders: null,
      monthOrders: null,
      previousMonthOrders: null,
      yesterdayVisits: null,
      sevenDayVisits: null,
      thirtyDayVisits: null,
      monthVisits: null,
      previousMonthVisits: null,
      daysUntilWithdrawal: null,
      incomeTrend: [],
      visitTrend: [],
      monthlyIncomeTrend: [],
    };
  }

  const previousMonth = getPreviousMonth(ranges.parts);
  const previousMonthBill = findMonthlyIncome(
    data.monthlyIncome,
    previousMonth.year,
    previousMonth.month,
  );
  const previousMonthIncome =
    parseAfdianAmount(previousMonthBill?.totalAmount) ??
    sumIncome(data.dailyStats, ranges.previousMonth, ranges.today, data.todayIncome);
  const previousMonthNetIncome =
    parseAfdianAmount(previousMonthBill?.creatorAmount) ??
    (previousMonthIncome === null
      ? null
      : calculateAfdianNet(String(previousMonthIncome)));
  const monthlyNetValues = data.monthlyIncome
    .map((item) =>
      parseAfdianAmount(item.creatorAmount) ?? calculateAfdianNet(item.totalAmount),
    )
    .filter((value): value is number => value !== null);
  const hasCurrentMonthBill = Boolean(
    findMonthlyIncome(data.monthlyIncome, ranges.parts.year, ranges.parts.month),
  );
  const currentMonthNetIncome = calculateAfdianNet(data.monthIncome);
  if (!hasCurrentMonthBill && currentMonthNetIncome !== null) {
    monthlyNetValues.push(currentMonthNetIncome);
  }
  const allNetIncome =
    monthlyNetValues.length > 0
      ? monthlyNetValues.reduce((sum, value) => sum + value, 0)
      : calculateAfdianNet(data.allIncome);
  const nextMonth = new Date(
    Date.UTC(ranges.parts.year, ranges.parts.month, 1),
  );
  const today = new Date(
    Date.UTC(ranges.parts.year, ranges.parts.month - 1, ranges.parts.day),
  );

  return {
    currentMonthIncome: parseAfdianAmount(data.monthIncome),
    previousMonthIncome,
    currentMonthNetIncome,
    previousMonthNetIncome,
    allNetIncome,
    yesterdayIncome: sumIncome(
      data.dailyStats,
      ranges.yesterday,
      ranges.today,
      data.todayIncome,
    ),
    sevenDayIncome: sumIncome(
      data.dailyStats,
      ranges.sevenDay,
      ranges.today,
      data.todayIncome,
    ),
    thirtyDayIncome: sumIncome(
      data.dailyStats,
      ranges.thirtyDay,
      ranges.today,
      data.todayIncome,
    ),
    todaySponsors: sumInteger(
      data.dailyStats,
      { start: ranges.today, end: ranges.tomorrow },
      "sponsorCount",
    ),
    yesterdaySponsors: sumInteger(data.dailyStats, ranges.yesterday, "sponsorCount"),
    sevenDaySponsors: sumInteger(data.dailyStats, ranges.sevenDay, "sponsorCount"),
    thirtyDaySponsors: sumInteger(data.dailyStats, ranges.thirtyDay, "sponsorCount"),
    previousMonthSponsors:
      previousMonthBill?.sponsorCount ??
      sumInteger(data.dailyStats, ranges.previousMonth, "sponsorCount"),
    yesterdayOrders: sumOrders(
      data.dailyStats,
      ranges.yesterday,
      ranges.today,
      data.todayOrderCount,
    ),
    sevenDayOrders: sumOrders(
      data.dailyStats,
      ranges.sevenDay,
      ranges.today,
      data.todayOrderCount,
    ),
    thirtyDayOrders: sumOrders(
      data.dailyStats,
      ranges.thirtyDay,
      ranges.today,
      data.todayOrderCount,
    ),
    monthOrders: sumOrders(
      data.dailyStats,
      ranges.month,
      ranges.today,
      data.todayOrderCount,
    ),
    previousMonthOrders: sumOrders(
      data.dailyStats,
      ranges.previousMonth,
      ranges.today,
      data.todayOrderCount,
    ),
    yesterdayVisits: sumInteger(data.dailyStats, ranges.yesterday, "uv"),
    sevenDayVisits: sumInteger(data.dailyStats, ranges.sevenDay, "uv"),
    thirtyDayVisits: sumInteger(data.dailyStats, ranges.thirtyDay, "uv"),
    monthVisits: sumInteger(data.dailyStats, ranges.month, "uv"),
    previousMonthVisits: sumInteger(data.dailyStats, ranges.previousMonth, "uv"),
    daysUntilWithdrawal: Math.max(
      0,
      Math.round((nextMonth.getTime() - today.getTime()) / 86_400_000),
    ),
    incomeTrend: buildDailyTrend(data.dailyStats, ranges.thirtyDay, "income"),
    visitTrend: buildDailyTrend(data.dailyStats, ranges.thirtyDay, "uv"),
    monthlyIncomeTrend: buildMonthlyTrend(data, ranges.parts),
  };
}

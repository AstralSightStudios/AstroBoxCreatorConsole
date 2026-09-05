import { describe, expect, test } from "bun:test";
import type { AfdianManagementOverview } from "../../app/api/afdian-management";
import {
  DEFAULT_AFDIAN_CARD_IDS,
  buildAfdianOverviewValues,
  normalizeAfdianCardSelection,
} from "../../app/logic/afdian/cards";

const overview: AfdianManagementOverview = {
  todayIncome: "10",
  todayOrderCount: 2,
  monthIncome: "100",
  allIncome: "500",
  recentSponsorCount: 7,
  allSponsorCount: 50,
  uv: 300,
  pv: 800,
  balance: "20",
  balanceAfterTax: "18.8",
  asOf: "2026-09-06T12:00:00+08:00",
  dailyStats: [
    {
      date: "2026-08-01",
      income: "40",
      orderCount: 2,
      sponsorCount: 3,
      returningSponsorCount: 1,
      uv: 6,
    },
    {
      date: "2026-08-31",
      income: "30",
      orderCount: 4,
      sponsorCount: 5,
      returningSponsorCount: 2,
      uv: 8,
    },
    {
      date: "2026-09-01",
      income: "20",
      orderCount: 1,
      sponsorCount: 1,
      returningSponsorCount: 0,
      uv: 2,
    },
    {
      date: "2026-09-05",
      income: "5",
      orderCount: 3,
      sponsorCount: 2,
      returningSponsorCount: 1,
      uv: 4,
    },
    {
      date: "2026-09-06",
      income: "8",
      orderCount: 1,
      sponsorCount: 2,
      returningSponsorCount: 1,
      uv: 3,
    },
  ],
  monthlyIncome: [
    {
      year: 2026,
      month: 8,
      totalAmount: "70",
      creatorAmount: "65",
      sponsorCount: 8,
    },
  ],
};

describe("爱发电卡片", () => {
  test("过滤无效选项并保持固定顺序", () => {
    expect(
      normalizeAfdianCardSelection([
        "all-income",
        "invalid",
        "today-income",
        "today-income",
      ]),
    ).toEqual(["today-income", "all-income"]);
    expect(normalizeAfdianCardSelection(null)).toEqual(DEFAULT_AFDIAN_CARD_IDS);
    expect(normalizeAfdianCardSelection([])).toEqual([]);
  });

  test("按固定日期范围汇总收入与次数", () => {
    const values = buildAfdianOverviewValues(overview);

    expect(values.yesterdayIncome).toBe(5);
    expect(values.sevenDayIncome).toBe(65);
    expect(values.thirtyDayIncome).toBe(65);
    expect(values.previousMonthIncome).toBe(70);
    expect(values.monthOrders).toBe(6);
    expect(values.previousMonthOrders).toBe(6);
  });

  test("生成发电人数、访问与结算卡数据", () => {
    const values = buildAfdianOverviewValues(overview);

    expect(values.todaySponsors).toBe(2);
    expect(values.previousMonthSponsors).toBe(8);
    expect(values.monthVisits).toBe(9);
    expect(values.previousMonthVisits).toBe(14);
    expect(values.currentMonthNetIncome).toBe(94);
    expect(values.previousMonthNetIncome).toBe(65);
    expect(values.allNetIncome).toBe(159);
    expect(values.daysUntilWithdrawal).toBe(25);
    expect(values.monthlyIncomeTrend).toEqual([
      { key: "2026-08", label: "26/8", value: 70 },
      { key: "2026-09", label: "26/9", value: 100 },
    ]);
  });
});

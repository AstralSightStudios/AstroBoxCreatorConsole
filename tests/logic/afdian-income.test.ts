import { describe, expect, test } from "bun:test";
import {
  estimateAfdianMonthlyNet,
  formatAfdianCurrency,
  parseAfdianAmount,
} from "../../app/logic/afdian/income";

describe("爱发电收入计算", () => {
  test("按上海自然日预估扣除百分之六后的本月收入", () => {
    expect(
      estimateAfdianMonthlyNet("300.00", "2026-08-30T12:00:00+08:00"),
    ).toBe(291.4);
  });

  test("月初按完整月份折算", () => {
    expect(
      estimateAfdianMonthlyNet("10", "2026-02-01T08:00:00+08:00"),
    ).toBe(263.2);
  });

  test("拒绝无效金额并统一格式化人民币", () => {
    expect(parseAfdianAmount("1,234.50")).toBe(1234.5);
    expect(parseAfdianAmount("invalid")).toBeNull();
    expect(formatAfdianCurrency("1234.5")).toBe("¥1,234.50");
    expect(formatAfdianCurrency(null)).toBe("--");
  });
});

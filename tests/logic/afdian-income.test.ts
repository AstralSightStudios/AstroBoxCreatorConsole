import { describe, expect, test } from "bun:test";
import {
  calculateAfdianNet,
  formatAfdianCurrency,
  getAfdianIncomeMonthLabel,
  parseAfdianAmount,
  resolveAfdianSettlementDisplay,
} from "../../app/logic/afdian/income";

describe("爱发电收入计算", () => {
  test("按已产生收入计算扣除百分之六后的到手金额", () => {
    expect(calculateAfdianNet("43.00")).toBe(40.42);
    expect(calculateAfdianNet("300.00")).toBe(282);
  });

  test("拒绝无效金额并统一格式化人民币", () => {
    expect(parseAfdianAmount("1,234.50")).toBe(1234.5);
    expect(parseAfdianAmount("invalid")).toBeNull();
    expect(formatAfdianCurrency("1234.5")).toBe("¥1,234.50");
    expect(formatAfdianCurrency(null)).toBe("--");
  });

  test("使用北京时间显示当前收入月份", () => {
    expect(getAfdianIncomeMonthLabel("2026-08-30T12:00:00+08:00")).toBe(
      "8月收入",
    );
  });

  test("每月一日十点前按上月收入预计到手", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "10",
        previousMonth: "100",
        withdrawable: "0",
        asOf: "2026-09-01T09:59:00+08:00",
      }),
    ).toEqual({ label: "预计到手", amount: 94 });
  });

  test("结算后显示可提现金额", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "10",
        previousMonth: "100",
        withdrawable: "94",
        asOf: "2026-09-01T10:00:00+08:00",
      }),
    ).toEqual({ label: "可提现", amount: 94 });
  });

  test("提现后恢复显示当月预计到手", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "43",
        previousMonth: "100",
        withdrawable: "0",
        asOf: "2026-09-04T12:00:00+08:00",
      }),
    ).toEqual({ label: "预计到手", amount: 40.42 });
  });
});

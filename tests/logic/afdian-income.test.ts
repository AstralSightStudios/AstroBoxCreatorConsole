import { describe, expect, test } from "bun:test";
import {
  calculateAfdianNet,
  formatAfdianCurrency,
  getAfdianIncomeMonthLabel,
  isAfdianSettlementWindow,
  parseAfdianAmount,
  resolveAfdianSettlementDisplay,
} from "../../app/logic/afdian/income";

describe("爱发电收入计算", () => {
  test("按已产生收入计算扣除百分之六后的到手金额", () => {
    expect(calculateAfdianNet("43.00")).toBe(40.42);
    expect(calculateAfdianNet("300.00")).toBe(282);
  });

  test("到手金额向下取整到分而不是四舍五入", () => {
    // 3.35 × 0.94 = 3.149：四舍五入会得到 3.15，平台口径是 3.14。
    expect(calculateAfdianNet("3.35")).toBe(3.14);
    // 二进制误差不能把整分金额多算一分。
    expect(calculateAfdianNet("43.00")).toBe(40.42);
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

  test("每月一日十点前切上月口径并取待结算金额", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "0",
        unconfirmedAmount: "100",
        withdrawable: "0",
        asOf: "2026-09-01T09:59:00+08:00",
      }),
    ).toEqual({
      isSettlementWindow: true,
      label: "上月收入",
      secondaryLabel: "预计到手 · 扣除 6%",
      income: 100,
      afterFee: 94,
    });
  });

  test("服务端报告结算中时即使已过十点仍算结算期", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "0",
        unconfirmedAmount: "100",
        withdrawable: "0",
        asOf: "2026-09-01T11:00:00+08:00",
        isBalanceSettling: true,
      }).isSettlementWindow,
    ).toBe(true);
  });

  test("非一日忽略滞后的结算中信号", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "10",
        unconfirmedAmount: "100",
        withdrawable: "0",
        asOf: "2026-09-02T09:00:00+08:00",
        isBalanceSettling: true,
      }).isSettlementWindow,
    ).toBe(false);
    expect(isAfdianSettlementWindow({ asOf: "2026-09-30T09:00:00+08:00" })).toBe(
      false,
    );
  });

  test("待结算金额缺失时显示占位而不是 0", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "0",
        unconfirmedAmount: null,
        withdrawable: "0",
        asOf: "2026-09-01T09:00:00+08:00",
      }),
    ).toMatchObject({
      label: "上月收入",
      income: null,
      afterFee: null,
    });
  });

  test("待结算金额为 0 时正常显示 0", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "0",
        unconfirmedAmount: "0",
        withdrawable: "0",
        asOf: "2026-09-01T09:00:00+08:00",
      }),
    ).toMatchObject({ income: 0, afterFee: 0 });
  });

  test("结算后显示可提现金额", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "10",
        unconfirmedAmount: "100",
        withdrawable: "94",
        asOf: "2026-09-01T10:00:00+08:00",
      }),
    ).toEqual({
      isSettlementWindow: false,
      label: "9月收入",
      secondaryLabel: "可提现",
      income: 10,
      afterFee: 94,
    });
  });

  test("提现后恢复显示当月预计到手", () => {
    expect(
      resolveAfdianSettlementDisplay({
        currentMonth: "43",
        unconfirmedAmount: "100",
        withdrawable: "0",
        asOf: "2026-09-04T12:00:00+08:00",
      }),
    ).toEqual({
      isSettlementWindow: false,
      label: "9月收入",
      secondaryLabel: "预计到手 · 扣除 6%",
      income: 43,
      afterFee: 40.42,
    });
  });
});

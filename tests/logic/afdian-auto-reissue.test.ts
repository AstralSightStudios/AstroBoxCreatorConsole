import { describe, expect, test } from "bun:test";
import type { AfdianAutoReissueStatus } from "../../app/api/astrobox/order";
import {
  describeAutoReissueState,
  formatAutoReissueStats,
  formatAutoReissueTime,
  validateAutoReissueInput,
} from "../../app/logic/afdian-auto-reissue";

const stats = (overrides: Partial<AfdianAutoReissueStatus["lastStats"]> = {}) => ({
  fetched: 0,
  matched: 0,
  checked: 0,
  granted: 0,
  waitingBinding: 0,
  failed: 0,
  truncated: false,
  ...overrides,
});

const status = (overrides: Partial<AfdianAutoReissueStatus> = {}): AfdianAutoReissueStatus => ({
  configured: true,
  enabled: true,
  afdianUserId: "afd-user-0001",
  intervalMinutes: 15,
  lastStatus: "ok",
  lastError: "",
  lastRunAt: "2026-11-13T12:00:00.000Z",
  lastSuccessAt: "2026-11-13T12:00:00.000Z",
  nextRunAt: "2026-11-13T12:15:00.000Z",
  lastStats: stats(),
  ...overrides,
});

describe("validateAutoReissueInput（与服务端 saveBody 同一套规则）", () => {
  test("合法输入通过，首尾空白不计", () => {
    expect(validateAutoReissueInput(" 0123456789abcdef0123456789abcdef ", " tok_En-12345678 ")).toBeNull();
    expect(validateAutoReissueInput("12345678", "12345678")).toBeNull();
  });

  test("留空提示补全", () => {
    expect(validateAutoReissueInput("", "tok-12345678")).toContain("请输入");
    expect(validateAutoReissueInput("user-12345678", "   ")).toContain("请输入");
  });

  test("长度与字符集越界被拦下", () => {
    expect(validateAutoReissueInput("short", "tok-12345678")).toContain("user_id");
    expect(validateAutoReissueInput("a".repeat(65), "tok-12345678")).toContain("user_id");
    expect(validateAutoReissueInput("user id 1234", "tok-12345678")).toContain("user_id");
    expect(validateAutoReissueInput("user-12345678", "short")).toContain("API token");
    expect(validateAutoReissueInput("user-12345678", "a".repeat(129))).toContain("API token");
    expect(validateAutoReissueInput("user-12345678", "tok 12345678")).toContain("API token");
    expect(validateAutoReissueInput("user-12345678", "令牌令牌令牌令牌令牌")).toContain("API token");
  });
});

describe("describeAutoReissueState", () => {
  test("没配置：灰色「未开启」", () => {
    expect(describeAutoReissueState(status({ configured: false, enabled: false }))).toMatchObject({
      tone: "gray",
      label: "未开启",
    });
  });

  test("开着：按最近一轮的结果分颜色", () => {
    expect(describeAutoReissueState(status({ lastStatus: "" })).label).toBe("等待首次同步");
    expect(describeAutoReissueState(status({ lastStatus: "ok" }))).toMatchObject({ tone: "green", label: "运行正常" });
    expect(describeAutoReissueState(status({ lastStatus: "network" })).tone).toBe("orange");
    expect(describeAutoReissueState(status({ lastStatus: "rejected" })).tone).toBe("orange");
    expect(describeAutoReissueState(status({ lastStatus: "seller_inactive" })).detail).toContain("创作者权限");
    expect(describeAutoReissueState(status({ lastStatus: "error" })).tone).toBe("orange");
  });

  test("服务端停用：红色，并按原因给出下一步", () => {
    const rejected = describeAutoReissueState(
      status({ enabled: false, lastStatus: "disabled", lastError: "rejected:400004 sign error" }),
    );
    expect(rejected).toMatchObject({ tone: "red", label: "已停用" });
    expect(rejected.detail).toContain("拒绝");
    const unreadable = describeAutoReissueState(
      status({ enabled: false, lastStatus: "disabled", lastError: "credentials_unreadable" }),
    );
    expect(unreadable.detail).toContain("无法读取");
    expect(describeAutoReissueState(status({ enabled: false, lastStatus: "disabled", lastError: "" })).detail).toContain(
      "重新填写",
    );
  });
});

describe("formatAutoReissueStats", () => {
  test("没跑成功过不显示", () => {
    expect(formatAutoReissueStats(stats({ fetched: 5 }), "")).toBe("");
    expect(formatAutoReissueStats(stats({ fetched: 5 }), "network")).toBe("");
  });

  test("只列有内容的项", () => {
    expect(formatAutoReissueStats(stats({ fetched: 12 }), "ok")).toBe("读取 12 笔订单");
    expect(
      formatAutoReissueStats(
        stats({ fetched: 30, checked: 4, granted: 2, waitingBinding: 1, failed: 1, truncated: true }),
        "ok",
      ),
    ).toBe("读取 30 笔订单，校对 4 笔，补发 2 项，1 项买家尚未绑定，1 项补发失败，订单较多，更早的订单未读取");
  });
});

test("formatAutoReissueTime：空值与坏值显示占位，合法时间走本地化", () => {
  expect(formatAutoReissueTime("")).toBe("—");
  expect(formatAutoReissueTime("not a date")).toBe("—");
  expect(formatAutoReissueTime("2026-11-13T12:00:00.000Z")).toBe(new Date("2026-11-13T12:00:00.000Z").toLocaleString());
});

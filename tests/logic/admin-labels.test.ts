import { describe, expect, test } from "bun:test";
import {
  formatCdkStatus,
  formatCommercePlatform,
  formatEntitlementSource,
  formatPublicOrderStatus,
  formatReportStatus,
  formatReportType,
  formatValidationStatus,
} from "../../app/logic/catalog/admin-labels";

describe("后台枚举中文标签", () => {
  test("已知枚举翻译成中文", () => {
    expect(formatCommercePlatform("afd")).toBe("爱发电");
    expect(formatCommercePlatform("cdk")).toBe("CDK 兑换");
    expect(formatPublicOrderStatus("pending_binding")).toBe("待绑定账号");
    expect(formatPublicOrderStatus("granted")).toBe("已发放");
    expect(formatEntitlementSource("order")).toBe("订单");
    expect(formatCdkStatus("available")).toBe("未使用");
    expect(formatCdkStatus("redeemed")).toBe("已兑换");
    expect(formatReportStatus("pending")).toBe("待处理");
    expect(formatReportType("comment")).toBe("评论");
    expect(formatValidationStatus("active")).toBe("有效");
  });

  test("未知枚举原样返回，不丢信息", () => {
    expect(formatCommercePlatform("mystery")).toBe("mystery");
    expect(formatPublicOrderStatus("something_new")).toBe("something_new");
  });

  test("空值统一显示 --", () => {
    expect(formatCommercePlatform(undefined)).toBe("--");
    expect(formatReportStatus(null)).toBe("--");
    expect(formatCdkStatus("  ")).toBe("--");
  });
});

import { describe, expect, test } from "bun:test";
import { adminUserDisplayName } from "../../app/logic/account/admin-user-directory";
import type { AdminUserSummary } from "../../app/api/astrobox/admin";

function user(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    userId: "u-1",
    username: "",
    displayName: "",
    email: "",
    avatar: "",
    vip: "None",
    vipExpireMap: {},
    roles: [],
    createdAt: "",
    activeBans: [],
    ...overrides,
  };
}

describe("账号展示名", () => {
  test("优先昵称，其次用户名，最后 uid", () => {
    expect(
      adminUserDisplayName(
        user({ displayName: "张三", username: "zhangsan", userId: "u-1" }),
      ),
    ).toBe("张三");
    expect(
      adminUserDisplayName(user({ username: "zhangsan", userId: "u-1" })),
    ).toBe("zhangsan");
    expect(adminUserDisplayName(user({ userId: "u-1" }))).toBe("u-1");
  });

  test("解析失败时退回传入的兜底值", () => {
    expect(adminUserDisplayName(null, "u-2")).toBe("u-2");
    expect(adminUserDisplayName(undefined, "u-2")).toBe("u-2");
    expect(adminUserDisplayName(null)).toBe("");
  });
});

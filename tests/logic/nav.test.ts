import { describe, expect, test } from "bun:test";
import {
  isNavItemVisible,
  normalizeNavItemPreferences,
} from "../../app/config/nav";
import {
  findNavIndex,
  hasRequiredNavRole,
  NAV_PRIMARY_ACTION,
  NAV_SECTIONS,
  sortNavItems,
} from "../../app/layout/nav-config";

describe("导航分组", () => {
  test("爱发电使用独立分组", () => {
    const afdianSection = NAV_SECTIONS.find((section) => section.id === "afdian");
    const dashboardSection = NAV_SECTIONS.find(
      (section) => section.id === "dashboard",
    );

    expect(afdianSection?.title).toBe("爱发电");
    expect(afdianSection?.items.map((item) => item.id)).toEqual([
      "afdian-income",
      "afdian-messages",
    ]);
    expect(
      dashboardSection?.items.some((item) => item.id.startsWith("afdian-")),
    ).toBe(false);
  });

  test("快捷操作保持在导航底部", () => {
    expect(NAV_PRIMARY_ACTION).toMatchObject({
      id: "publish-new-resource",
      path: "/new-resource",
      fixedPosition: true,
    });
  });
});

describe("导航项偏好", () => {
  test("归一化存储数据并去除重复项", () => {
    expect(
      normalizeNavItemPreferences({
        hiddenItemIds: ["analysis", "analysis", null],
        itemOrder: ["interactions", 1, "overview", "overview"],
      }),
    ).toEqual({
      hiddenItemIds: ["analysis"],
      itemOrder: ["interactions", "overview"],
    });
  });

  test("按用户顺序排列并在末尾保留新项目", () => {
    const items = [{ id: "overview" }, { id: "analysis" }, { id: "new" }];

    expect(
      sortNavItems(items, ["analysis", "overview"]).map((item) => item.id),
    ).toEqual(["analysis", "overview", "new"]);
  });

  test("显隐配置仅隐藏指定项目", () => {
    const preferences = {
      hiddenItemIds: ["analysis"],
      itemOrder: [],
    };

    expect(isNavItemVisible("analysis", preferences)).toBe(false);
    expect(isNavItemVisible("overview", preferences)).toBe(true);
  });

  test("页面切换顺序跟随用户设置", () => {
    expect(findNavIndex("/analysis", ["analysis", "overview"])).toBe(0);
    expect(findNavIndex("/", ["analysis", "overview"])).toBe(1);
  });

  test("显示配置不会绕过角色限制", () => {
    const adminItem = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === "admin-hotupdate",
    );

    expect(adminItem).toBeDefined();
    expect(hasRequiredNavRole(adminItem!, [])).toBe(false);
    expect(hasRequiredNavRole(adminItem!, ["admin"])).toBe(true);
  });
});

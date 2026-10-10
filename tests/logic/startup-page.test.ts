import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STARTUP_PAGE,
  STARTUP_PAGE_OPTIONS,
  normalizeStartupPage,
} from "../../app/config/startupPage";
import {
  hasAppliedStartupRedirect,
  markStartupRedirectApplied,
  resetStartupRedirect,
  resolveStartupRedirectPath,
} from "../../app/logic/startup-page";
import { NAV_ITEMS_IN_ORDER, normalizePath } from "../../app/layout/nav-config";

describe("启动页面配置", () => {
  test("候选页面覆盖全部导航项且路径合法", () => {
    const navPaths = new Set(
      NAV_ITEMS_IN_ORDER.map((item) => normalizePath(item.path)),
    );

    for (const option of STARTUP_PAGE_OPTIONS) {
      expect(normalizePath(option.path).startsWith("/")).toBe(true);
      expect(option.group.length).toBeGreaterThan(0);
    }
    expect(
      STARTUP_PAGE_OPTIONS.some((option) =>
        navPaths.has(normalizePath(option.path)),
      ),
    ).toBe(true);
    // 概览页始终是默认落点，必须留在候选里。
    expect(
      STARTUP_PAGE_OPTIONS.some((option) => normalizePath(option.path) === "/"),
    ).toBe(true);
  });

  test("归一化非法值回落概览", () => {
    expect(normalizeStartupPage("/resreview")).toBe("/resreview");
    expect(normalizeStartupPage("resreview")).toBe("/resreview");
    expect(normalizeStartupPage("/resreview/")).toBe("/resreview");
    expect(normalizeStartupPage("/not-a-page")).toBe(DEFAULT_STARTUP_PAGE);
    expect(normalizeStartupPage("../../etc")).toBe(DEFAULT_STARTUP_PAGE);
    expect(normalizeStartupPage(null)).toBe(DEFAULT_STARTUP_PAGE);
    expect(normalizeStartupPage(123)).toBe(DEFAULT_STARTUP_PAGE);
  });
});

describe("启动页跳转判定", () => {
  test("启动落在概览页时跳到配置的启动页", () => {
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        startupPage: "/resreview",
        redirectApplied: false,
      }),
    ).toBe("/resreview");
  });

  test("默认启动页不产生跳转", () => {
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        redirectApplied: false,
      }),
    ).toBeNull();
  });

  test("未完成登录时交给欢迎页处理", () => {
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: false,
        startupPage: "/resreview",
        redirectApplied: false,
      }),
    ).toBeNull();
  });

  test("显式路径（深链、手动导航）不跳转", () => {
    for (const pathname of ["/resreview", "/manage", "/settings", "/welcome"]) {
      expect(
        resolveStartupRedirectPath({
          pathname,
          canUseConsole: true,
          startupPage: "/resreview",
          redirectApplied: false,
        }),
      ).toBeNull();
    }
  });

  test("每次启动只跳转一次", () => {
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        startupPage: "/resreview",
        redirectApplied: false,
      }),
    ).toBe("/resreview");
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        startupPage: "/resreview",
        redirectApplied: false,
      }),
    ).toBe("/resreview");
  });

  test("会话标记消费后不再跳转", () => {
    resetStartupRedirect();
    expect(hasAppliedStartupRedirect()).toBe(false);
    markStartupRedirectApplied();
    expect(hasAppliedStartupRedirect()).toBe(true);
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        startupPage: "/resreview",
      }),
    ).toBeNull();
    resetStartupRedirect();
  });

  test("重置后重新获得一次跳转机会（退出登录再登录）", () => {
    resetStartupRedirect();
    markStartupRedirectApplied();
    resetStartupRedirect();
    expect(hasAppliedStartupRedirect()).toBe(false);
    expect(
      resolveStartupRedirectPath({
        pathname: "/",
        canUseConsole: true,
        startupPage: "/resreview",
      }),
    ).toBe("/resreview");
    resetStartupRedirect();
  });
});
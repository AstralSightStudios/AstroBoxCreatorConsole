import { describe, expect, test } from "bun:test";
import { isAstroboxAdminRole } from "../../app/logic/account/manage-resource-access";

describe("资源管理后台角色", () => {
  test("admin 与 moderator 放行", () => {
    expect(isAstroboxAdminRole(["admin"])).toBe(true);
    expect(isAstroboxAdminRole(["moderator"])).toBe(true);
    expect(isAstroboxAdminRole(["pr-reviewer", "moderator"])).toBe(true);
  });

  test("其它角色与空值拒绝", () => {
    expect(isAstroboxAdminRole(["pr-reviewer"])).toBe(false);
    expect(isAstroboxAdminRole([])).toBe(false);
    expect(isAstroboxAdminRole(undefined)).toBe(false);
  });
});

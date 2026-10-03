import { describe, expect, test } from "bun:test";
import { hasCommunityRepoManagePermission } from "../../app/api/github/pr-review";

describe("社区仓库管理权限", () => {
  test("写入及以上权限可以通过", () => {
    expect(hasCommunityRepoManagePermission("admin")).toBe(true);
    expect(hasCommunityRepoManagePermission("maintain")).toBe(true);
    expect(hasCommunityRepoManagePermission("write")).toBe(true);
  });

  test("只读和分诊权限不能进入", () => {
    expect(hasCommunityRepoManagePermission("triage")).toBe(false);
    expect(hasCommunityRepoManagePermission("read")).toBe(false);
    expect(hasCommunityRepoManagePermission("")).toBe(false);
  });
});

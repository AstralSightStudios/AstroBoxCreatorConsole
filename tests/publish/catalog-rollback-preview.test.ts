import { describe, expect, test } from "bun:test";
import {
  buildFieldDiffs,
  buildPublishingRepoPreview,
} from "../../app/logic/publish/catalog-rollback-preview";
import type { CatalogEntry } from "../../app/logic/publish/catalog";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "demo",
    name: "Demo",
    restype: "watchface",
    repo_owner: "octocat",
    repo_name: "astrobox-resource-demo",
    repo_commit_hash: "new2222",
    icon: "media/icon.png",
    cover: "media/cover.png",
    tags: "new",
    device_vendors: "xiaomi",
    devices: "xmrw6",
    paid_type: "paid",
    ...overrides,
  };
}

describe("回退目录行对比", () => {
  test("只列出当前状态到回退目标的字段变化", () => {
    const current = entry();
    const after = entry({
      repo_commit_hash: "old1111",
      tags: "old",
      paid_type: "free",
    });

    const changes = buildFieldDiffs(current, after);
    expect(changes.map((change) => change.field)).toEqual([
      "repo_commit_hash",
      "tags",
      "paid_type",
    ]);
    expect(changes[0]).toMatchObject({
      before: "new2222",
      after: "old1111",
    });
    expect(changes[2]).toMatchObject({
      before: "paid",
      after: "",
    });
  });

  test("回退移除整行时把当前非空字段全部列为删除", () => {
    const current = entry({ cover: "", repo_commit_hash: "" });
    const changes = buildFieldDiffs(current, undefined);
    expect(changes.map((change) => change.field)).toContain("id");
    expect(changes.map((change) => change.field)).toContain("name");
    expect(changes.find((change) => change.field === "cover")).toBeUndefined();
    expect(changes.find((change) => change.field === "repo_commit_hash")).toBeUndefined();
    expect(changes.every((change) => change.after === "")).toBe(true);
  });

  test("新增资源回退前无行时把目标字段全部列为新增", () => {
    const after = entry({ icon: "", cover: "" });
    const changes = buildFieldDiffs(undefined, after);
    expect(changes.map((change) => change.field)).toContain("id");
    expect(changes.find((change) => change.field === "icon")).toBeUndefined();
    expect(changes.every((change) => change.before === "")).toBe(true);
  });
});

describe("回退发布仓库对比", () => {
  test("同一仓库时给出当前与目标 commit", () => {
    const current = entry({ repo_commit_hash: "new2222" });
    const after = entry({ repo_commit_hash: "old1111" });
    const result = buildPublishingRepoPreview(current, after);
    expect(result).toMatchObject({
      owner: "octocat",
      repo: "astrobox-resource-demo",
      beforeCommit: "new2222",
      afterCommit: "old1111",
      comparable: true,
    });
  });

  test("仓库改名时不直接比较并给出原因", () => {
    const current = entry({ repo_name: "renamed" });
    const after = entry({ repo_name: "old-name" });
    const result = buildPublishingRepoPreview(current, after);
    expect(result?.comparable).toBe(false);
    expect(result?.reason).toContain("发布仓库已变更");
  });

  test("回退移除目录行时没有发布仓库对比", () => {
    expect(buildPublishingRepoPreview(entry(), undefined)).toBeUndefined();
  });

  test("回退前无目录行时展示目标 commit 但标记不可直接比较", () => {
    const result = buildPublishingRepoPreview(undefined, entry());
    expect(result).toMatchObject({
      afterCommit: "new2222",
      comparable: false,
    });
    expect(result?.reason).toContain("当前目录没有该资源行");
  });
});

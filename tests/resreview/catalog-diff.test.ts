import { describe, expect, test } from "bun:test";
import {
  diffCatalogEntries,
  splitSemicolonTokens,
} from "../../app/routes/resreview/catalog-diff";
import type { CatalogEntry } from "../../app/logic/publish/catalog";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "demo",
    name: "Demo",
    restype: "watchface",
    repo_owner: "o",
    repo_name: "r",
    repo_commit_hash: "abc1234",
    icon: "media/icon.png",
    cover: "media/cover.png",
    tags: "a;b",
    device_vendors: "V",
    devices: "d1",
    paid_type: "",
    ...overrides,
  };
}

describe("diffCatalogEntries", () => {
  test("新增资源（无基线）只列出非空字段", () => {
    const changes = diffCatalogEntries(
      undefined,
      entry({ cover: "", paid_type: "" }),
    );
    const fields = changes.map((change) => change.field);
    expect(fields).not.toContain("cover");
    expect(fields).toContain("id");
    expect(fields).toContain("tags");
  });

  test("只保留真正变化的字段", () => {
    const base = entry();
    const next = entry({ repo_commit_hash: "def5678", tags: "a;b;c" });
    const changes = diffCatalogEntries(base, next);
    expect(changes.map((change) => change.field)).toEqual([
      "repo_commit_hash",
      "tags",
    ]);
    const tags = changes.find((change) => change.field === "tags")!;
    expect(tags.oldValue).toBe("a;b");
    expect(tags.newValue).toBe("a;b;c");
  });

  test("paid_type 的 free 与空串视为等价", () => {
    const changes = diffCatalogEntries(
      entry({ paid_type: "free" }),
      entry({ paid_type: "" }),
    );
    expect(changes).toHaveLength(0);
  });

  test("完全一致时无变化", () => {
    expect(diffCatalogEntries(entry(), entry())).toHaveLength(0);
  });
});

describe("splitSemicolonTokens", () => {
  test("拆分并去除空白与空 token", () => {
    expect(splitSemicolonTokens(" a ; b ;; c ")).toEqual(["a", "b", "c"]);
  });

  test("空串返回空数组", () => {
    expect(splitSemicolonTokens("")).toEqual([]);
  });
});

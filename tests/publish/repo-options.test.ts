import { describe, expect, test } from "bun:test";
import {
  isAstroBoxResourceRepo,
  matchesRepoOption,
} from "../../app/logic/publish/repo-options";

describe("repo options", () => {
  test("搜索词匹配仓库名、描述与 topic", () => {
    const repo = {
      name: "my-watchface",
      description: "表盘资源",
      topics: ["astrobox-resource", "watchface"],
    };
    expect(matchesRepoOption(repo, "watch")).toBe(true);
    expect(matchesRepoOption(repo, "表盘")).toBe(true);
    expect(matchesRepoOption(repo, "astrobox-resource")).toBe(true);
    expect(matchesRepoOption(repo, "quickapp")).toBe(false);
    // 空关键词不过滤
    expect(matchesRepoOption(repo, "   ")).toBe(true);
  });

  test("资源仓库优先看 topic，旧仓库回退名称前缀", () => {
    expect(
      isAstroBoxResourceRepo({ name: "foo", topics: ["astrobox-resource"] }),
    ).toBe(true);
    expect(isAstroBoxResourceRepo({ name: "astrobox-resource-foo" })).toBe(true);
    expect(
      isAstroBoxResourceRepo({ name: "foo", topics: ["watchface"] }),
    ).toBe(false);
  });
});

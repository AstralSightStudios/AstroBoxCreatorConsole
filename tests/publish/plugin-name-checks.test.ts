import { describe, expect, test } from "bun:test";
import {
  applyPluginNameChecks,
  type PluginIndexEntryGroup,
} from "../../app/logic/publish/plugin-review";

function group(
  repo: string,
  names: string[],
): PluginIndexEntryGroup {
  return {
    key: repo,
    line: `https://raw.githubusercontent.com/${repo}/refs/heads/main/`,
    parsed: {
      raw: `https://raw.githubusercontent.com/${repo}/refs/heads/main/`,
      owner: repo.split("/")[0],
      repo: repo.split("/")[1],
      ref: "refs/heads/main",
      branch: "main",
      refKind: "heads",
      shortForm: false,
    },
    repoWebUrl: "",
    repoBranchUrl: "",
    lineIssues: [],
    folders: ["dist"],
    plugins: names.map((name, index) => ({
      key: `${repo}:${index}`,
      folder: "dist",
      manifestUrl: "",
      rawName: name,
      iconUrl: "",
      entryUrl: "",
      issueList: [],
      files: [],
    })),
  };
}

function errors(groups: PluginIndexEntryGroup[]) {
  return groups.flatMap((item) =>
    item.plugins.flatMap((plugin) =>
      plugin.issueList.filter((issue) => issue.level === "error"),
    ),
  );
}

describe("plugin name uniqueness", () => {
  test("flags duplicate names inside the same PR", () => {
    const groups = [group("a/one", ["Same Name"]), group("a/two", ["Same Name"])];
    applyPluginNameChecks(groups, []);
    expect(errors(groups)).toHaveLength(2);
  });

  test("flags duplicate names against the published index", () => {
    const groups = [group("a/one", ["Published Name"])];
    applyPluginNameChecks(groups, [
      {
        repo: "https://raw.githubusercontent.com/a/old/refs/heads/main/",
        folder: "dist",
        manifest: { name: "Published Name" },
      },
    ]);
    expect(errors(groups)).toHaveLength(1);
    expect(errors(groups)[0].message).toContain("全局唯一");
  });

  test("different names are allowed", () => {
    const groups = [group("a/one", ["A"]), group("a/two", ["B"])];
    applyPluginNameChecks(groups, []);
    expect(errors(groups)).toHaveLength(0);
  });
});

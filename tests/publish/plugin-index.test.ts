import { describe, expect, test } from "bun:test";
import {
  buildPluginFolderRawUrl,
  extractPluginIndexPatch,
  normalizePluginRepoBase,
  parsePluginRepoBase,
  resolvePluginIndexConflict,
  validatePluginIndexLine,
} from "../../app/logic/publish/plugin-index";

describe("plugin index line parsing", () => {
  test("normalizes raw and github.com short form like the repo Action", () => {
    expect(
      normalizePluginRepoBase(
        "https://raw.githubusercontent.com/owner/repo/refs/heads/main",
      ),
    ).toBe("https://raw.githubusercontent.com/owner/repo/refs/heads/main/");
    expect(normalizePluginRepoBase("https://github.com/owner/repo")).toBe(
      "https://raw.githubusercontent.com/owner/repo/refs/heads/main/",
    );
  });

  test("parses owner / repo / branch", () => {
    const parsed = parsePluginRepoBase(
      "https://raw.githubusercontent.com/owner/repo/refs/heads/astrobox-release/",
    );
    expect(parsed).toEqual({
      raw: "https://raw.githubusercontent.com/owner/repo/refs/heads/astrobox-release/",
      owner: "owner",
      repo: "repo",
      ref: "refs/heads/astrobox-release",
      branch: "astrobox-release",
      refKind: "heads",
      shortForm: false,
    });
  });

  test("rejects full manifest.json url", () => {
    const issues = validatePluginIndexLine(
      "https://raw.githubusercontent.com/owner/repo/refs/heads/main/dist/manifest.json",
    );
    expect(issues.some((issue) => issue.level === "error")).toBe(true);
  });

  test("rejects dist path because the base must point at branch root", () => {
    const issues = validatePluginIndexLine(
      "https://raw.githubusercontent.com/owner/repo/refs/heads/main/dist/",
    );
    expect(issues.some((issue) => issue.level === "error")).toBe(true);
  });

  test("warns for github.com short form", () => {
    const issues = validatePluginIndexLine("https://github.com/owner/repo");
    expect(issues.some((issue) => issue.level === "warn")).toBe(true);
    expect(issues.some((issue) => issue.level === "error")).toBe(false);
  });

  test("reports duplicate against upstream and within the same PR", () => {
    const line =
      "https://raw.githubusercontent.com/owner/repo/refs/heads/main/";
    expect(
      validatePluginIndexLine(line, { existingLines: [line] }).some(
        (issue) => issue.level === "error",
      ),
    ).toBe(true);
    expect(
      validatePluginIndexLine(line, {
        seenLines: new Set([normalizePluginRepoBase(line)]),
      }).some((issue) => issue.level === "error"),
    ).toBe(true);
  });
});

describe("plugin index patch", () => {
  test("extracts multiple added lines from one hunk", () => {
    const patch = [
      "@@ -36,3 +36,5 @@",
      " line-a",
      " line-b",
      "+https://raw.githubusercontent.com/a/one/refs/heads/main/",
      "+https://raw.githubusercontent.com/a/two/refs/heads/main/",
      " line-c",
    ].join("\n");
    expect(extractPluginIndexPatch(patch)).toEqual({
      addedLines: [
        "https://raw.githubusercontent.com/a/one/refs/heads/main/",
        "https://raw.githubusercontent.com/a/two/refs/heads/main/",
      ],
      removedLines: [],
    });
  });

  test("extracts lines from multiple hunks", () => {
    const patch = [
      "@@ -1,1 +1,2 @@",
      " a",
      "+https://raw.githubusercontent.com/a/one/refs/heads/main/",
      "@@ -9,1 +10,2 @@",
      " z",
      "+https://raw.githubusercontent.com/a/two/refs/heads/main/",
    ].join("\n");
    expect(extractPluginIndexPatch(patch).addedLines).toHaveLength(2);
  });
});

describe("resolvePluginIndexConflict", () => {
  const base = [
    "https://raw.githubusercontent.com/a/one/refs/heads/main/",
    "https://raw.githubusercontent.com/a/two/refs/heads/main/",
    "",
  ].join("\n");

  test("appends all new lines in PR order", () => {
    const result = resolvePluginIndexConflict(base, [
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
      "https://raw.githubusercontent.com/a/four/refs/heads/main/",
    ]);
    expect(result.content).toBe(
      `${base}https://raw.githubusercontent.com/a/three/refs/heads/main/\nhttps://raw.githubusercontent.com/a/four/refs/heads/main/\n`,
    );
    expect(result.appended).toHaveLength(2);
  });

  test("skips lines already present and duplicates inside the PR", () => {
    const result = resolvePluginIndexConflict(base, [
      "https://raw.githubusercontent.com/a/one/refs/heads/main/",
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
    ]);
    expect(result.appended).toHaveLength(1);
    expect(result.duplicates).toHaveLength(2);
  });

  test("preserves CRLF", () => {
    const crlf = base.replace(/\n/g, "\r\n");
    const result = resolvePluginIndexConflict(crlf, [
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
    ]);
    expect(result.content).toContain(
      "https://raw.githubusercontent.com/a/three/refs/heads/main/\r\n",
    );
    expect(result.content).not.toContain(
      "https://raw.githubusercontent.com/a/three/refs/heads/main/\n",
    );
  });

  test("adds a missing trailing newline before appending", () => {
    const result = resolvePluginIndexConflict("base", ["line"]);
    expect(result.content).toBe("base\nline\n");
  });

  test("is idempotent", () => {
    const first = resolvePluginIndexConflict(base, [
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
    ]);
    const second = resolvePluginIndexConflict(first.content, [
      "https://raw.githubusercontent.com/a/three/refs/heads/main/",
    ]);
    expect(second.content).toBe(first.content);
    expect(second.appended).toHaveLength(0);
  });
});

describe("plugin folder url", () => {
  test("joins folder and file", () => {
    expect(
      buildPluginFolderRawUrl(
        "https://raw.githubusercontent.com/a/b/refs/heads/main/",
        "dist/plugin-a",
        "manifest.json",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/a/b/refs/heads/main/dist/plugin-a/manifest.json",
    );
  });
});

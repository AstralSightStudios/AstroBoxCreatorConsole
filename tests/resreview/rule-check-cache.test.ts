import { beforeEach, describe, expect, test } from "bun:test";
import type { GithubPullFile } from "../../app/api/github/pr-review";
import type { CatalogEntry } from "../../app/logic/publish/catalog";
import {
  buildRuleCheckCacheKey,
  clearRuleCheckCache,
  readRuleCheckCache,
  writeRuleCheckCache,
} from "../../app/routes/resreview/rule-check-cache";
import type { PrResourcePreview } from "../../app/routes/resreview/types";
import type { ResourceRuleCheckResult } from "../../app/routes/resreview/rule-checks";

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "res-1",
    name: "测试资源",
    restype: "watchface",
    repo_owner: "owner",
    repo_name: "repo",
    repo_commit_hash: "abc123",
    icon: "icon.png",
    cover: "cover.png",
    tags: "",
    device_vendors: "",
    devices: "",
    paid_type: "free",
    ...overrides,
  };
}

function preview(overrides: Partial<PrResourcePreview> = {}): PrResourcePreview {
  return {
    entry: catalogEntry(),
    ref: "abc123",
    iconUrl: "",
    coverUrl: "",
    previewUrls: [],
    packages: [],
    ...overrides,
  };
}

function pullFiles(sha = "sha-1"): GithubPullFile[] {
  return [
    {
      filename: "index_v2.csv",
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
      sha,
    },
  ];
}

function checkResult(): ResourceRuleCheckResult {
  return { checks: [], packageChecks: [], imageSizes: [] };
}

beforeEach(() => {
  clearRuleCheckCache();
});

describe("buildRuleCheckCacheKey", () => {
  test("相同检查输入生成相同 key", () => {
    expect(
      buildRuleCheckCacheKey(preview(), pullFiles(), "token-a", "astro-a"),
    ).toBe(
      buildRuleCheckCacheKey(preview(), pullFiles(), "token-a", "astro-a"),
    );
  });

  test("PR 文件内容或资源 commit 变化时 key 不同", () => {
    const base = buildRuleCheckCacheKey(preview(), pullFiles(), "token-a");
    expect(
      buildRuleCheckCacheKey(preview(), pullFiles("sha-2"), "token-a"),
    ).not.toBe(base);
    expect(
      buildRuleCheckCacheKey(
        preview({
          entry: catalogEntry({ repo_commit_hash: "def456" }),
          ref: "def456",
        }),
        pullFiles(),
        "token-a",
      ),
    ).not.toBe(base);
  });

  test("读取账号变化时 key 不同", () => {
    expect(buildRuleCheckCacheKey(preview(), pullFiles(), "token-a")).not.toBe(
      buildRuleCheckCacheKey(preview(), pullFiles(), "token-b"),
    );
    expect(
      buildRuleCheckCacheKey(preview(), pullFiles(), "token-a", "astro-a"),
    ).not.toBe(
      buildRuleCheckCacheKey(preview(), pullFiles(), "token-a", "astro-b"),
    );
  });
});

describe("规则检查结果缓存", () => {
  test("写入后可读取，过期后失效", () => {
    const key = buildRuleCheckCacheKey(preview(), pullFiles(), "token-a");
    const now = 1_000_000;
    writeRuleCheckCache(key, checkResult(), now);
    expect(readRuleCheckCache(key, now + 60_000)).toEqual(checkResult());
    expect(readRuleCheckCache(key, now + 10 * 60 * 1000)).toBeUndefined();
  });

  test("超过容量上限时淘汰最旧结果", () => {
    for (let i = 0; i < 25; i += 1) {
      writeRuleCheckCache(`key-${i}`, checkResult(), i);
    }
    expect(readRuleCheckCache("key-0", 100)).toBeUndefined();
    expect(readRuleCheckCache("key-24", 100)).toEqual(checkResult());
  });
});

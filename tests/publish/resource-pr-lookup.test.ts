import { afterEach, describe, expect, test } from "bun:test";
import {
  catalogRowKey,
  clearResourceSubmissionLookupCache,
  extractPrNumberFromSubmissionCommitMessage,
  findMatchingAddedCatalogEntry,
  lookupResourceSubmissionPr,
  submissionSearchTerm,
} from "../../app/logic/publish/resource-pr-lookup";
import type { CatalogEntry } from "../../app/logic/publish/catalog";

const HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearResourceSubmissionLookupCache();
});

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "979821130209",
    name: "波普圆点",
    restype: "watchface",
    repo_owner: "imwjh",
    repo_name: "astrobox-resource-979821130209",
    repo_commit_hash: "0c0a0c6",
    icon: "media/face-256.png",
    cover: "media/cover_2160x1440.png",
    tags: "指针;艺术",
    device_vendors: "xiaomi",
    devices: "xmrw6",
    paid_type: "",
    ...overrides,
  };
}

function row(target: CatalogEntry) {
  return [
    target.id,
    target.name,
    target.restype,
    target.repo_owner,
    target.repo_name,
    target.repo_commit_hash,
    target.icon,
    target.cover,
    target.tags,
    target.device_vendors,
    target.devices,
    target.paid_type,
  ].join(",");
}

describe("extractPrNumberFromSubmissionCommitMessage", () => {
  test("识别 Action 的资源提交信息", () => {
    expect(
      extractPrNumberFromSubmissionCommitMessage(
        "Apply resource submission from PR #1654 (tmp/imwjh/astrobox-resource-979821130209)",
      ),
    ).toBe(1654);
  });

  test("识别合并提交与 squash 标题", () => {
    expect(
      extractPrNumberFromSubmissionCommitMessage(
        "Merge pull request #1654 from imwjh/resource",
      ),
    ).toBe(1654);
    expect(
      extractPrNumberFromSubmissionCommitMessage(
        "feat: add resource (#1654)\n\nbody",
      ),
    ).toBe(1654);
  });

  test("不把回退提交、Revert 与普通提交当资源来源", () => {
    expect(
      extractPrNumberFromSubmissionCommitMessage(
        "Rollback resource rows from PR #1654",
      ),
    ).toBeUndefined();
    expect(
      extractPrNumberFromSubmissionCommitMessage(
        'Revert "Apply resource submission from PR #1654 (tmp/a/b)"',
      ),
    ).toBeUndefined();
    expect(
      extractPrNumberFromSubmissionCommitMessage("chore: update catalog"),
    ).toBeUndefined();
  });
});

describe("submissionSearchTerm", () => {
  test("按提交协议归一化仓库名", () => {
    expect(
      submissionSearchTerm(entry({ repo_name: "Plants_VS_Zombie_Vela_Chv" })),
    ).toBe("plants_vs_zombie_vela_chv");
  });

  test("仓库名为空时返回空串", () => {
    expect(submissionSearchTerm(entry({ repo_name: "   " }))).toBe("");
  });
});

describe("findMatchingAddedCatalogEntry", () => {
  test("只匹配目标资源 ID 且内容等于当前行的 + 行", () => {
    const target = entry();
    const other = entry({ id: "other", name: "其他" });
    const patch = [
      "@@ -1,2 +1,4 @@",
      ` ${HEADER}`,
      `+${row(other)}`,
      `+${row(target)}`,
    ].join("\n");

    const matched = findMatchingAddedCatalogEntry(
      [{ filename: "index_v2.csv", patch }],
      target,
    );
    expect(matched?.id).toBe(target.id);
  });

  test("忽略文件头与未修改行", () => {
    const target = entry();
    const patch = [
      `+++ b/index_v2.csv`,
      ` ${HEADER}`,
      ` ${row(target)}`,
      `-${row(target)}`,
    ].join("\n");

    expect(
      findMatchingAddedCatalogEntry(
        [{ filename: "index_v2.csv", patch }],
        target,
      ),
    ).toBeUndefined();
  });

  test("内容与当前行不一致时不匹配，避免把后续修改当成来源", () => {
    const target = entry();
    const changed = entry({ repo_commit_hash: "ffffff1" });
    const patch = [`+${row(changed)}`].join("\n");

    expect(
      findMatchingAddedCatalogEntry(
        [{ filename: "index_v2.csv", patch }],
        target,
      ),
    ).toBeUndefined();
  });

  test("paid_type 的 free 与空串按同一行比较", () => {
    const target = entry({ paid_type: "" });
    const patch = `+${row({ ...target, paid_type: "free" })}`;

    expect(
      findMatchingAddedCatalogEntry(
        [{ filename: "index_v2.csv", patch }],
        target,
      )?.id,
    ).toBe(target.id);
  });

  test("忽略非目录文件", () => {
    const target = entry();
    const patch = `+${row(target)}`;

    expect(
      findMatchingAddedCatalogEntry(
        [{ filename: "tmp/imwjh/demo/resource.csv", patch }],
        target,
      ),
    ).toBeUndefined();
  });

  test("catalogRowKey 对格式差异做归一", () => {
    expect(catalogRowKey(entry({ paid_type: "free" }))).toBe(
      catalogRowKey(entry({ paid_type: "" })),
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("lookupResourceSubmissionPr", () => {
  test("按目录行定向搜索提交并返回 PR，不遍历提交历史", async () => {
    const target = entry();
    const catalogCsv = `${HEADER}\n${row(target)}\n`;
    const commitMessage =
      "Apply resource submission from PR #1654 (tmp/imwjh/astrobox-resource-979821130209)";
    const calls: string[] = [];

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/contents/")) {
        return jsonResponse({
          content: Buffer.from(catalogCsv).toString("base64"),
          sha: "catalog-sha",
        });
      }
      if (url.includes("/search/commits")) {
        return jsonResponse({
          total_count: 1,
          items: [
            {
              sha: "abc123",
              commit: { message: commitMessage },
              parents: [],
            },
          ],
        });
      }
      if (url.includes("/commits/")) {
        return jsonResponse({
          sha: "abc123",
          html_url: "https://github.com/example/commit/abc123",
          commit: { message: commitMessage },
          parents: [],
          files: [{ filename: "index_v2.csv", patch: `+${row(target)}` }],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await lookupResourceSubmissionPr(target.id, {
      token: "token",
      owner: "AstralSightStudios",
      repo: "AstroBox-Repo",
      branch: "main",
    });

    expect(result.prNumber).toBe(1654);
    expect(result.entry.id).toBe(target.id);
    expect(calls.filter((url) => url.includes("/contents/"))).toHaveLength(1);
    const searchCall = calls.find((url) => url.includes("/search/commits"));
    expect(searchCall).toBeDefined();
    const searchUrl = new URL(searchCall!);
    expect(searchUrl.searchParams.get("q")).toBe(
      'repo:AstralSightStudios/AstroBox-Repo "astrobox-resource-979821130209"',
    );
    expect(
      calls.filter((url) => url.includes("/repos/AstralSightStudios/AstroBox-Repo/commits/")),
    ).toHaveLength(1);
  });

  test("候选提交的目录行与当前行不一致时提示直接输入 PR", async () => {
    const target = entry();
    const changed = entry({ repo_commit_hash: "changed" });
    const catalogCsv = `${HEADER}\n${row(target)}\n`;
    const commitMessage =
      "Apply resource submission from PR #1654 (tmp/imwjh/astrobox-resource-979821130209)";

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse({
          content: Buffer.from(catalogCsv).toString("base64"),
          sha: "catalog-sha",
        });
      }
      if (url.includes("/search/commits")) {
        return jsonResponse({
          total_count: 1,
          items: [
            {
              sha: "abc123",
              commit: { message: commitMessage },
              parents: [],
            },
          ],
        });
      }
      if (url.includes("/commits/")) {
        return jsonResponse({
          sha: "abc123",
          commit: { message: commitMessage },
          parents: [],
          files: [{ filename: "index_v2.csv", patch: `+${row(changed)}` }],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await expect(
      lookupResourceSubmissionPr(target.id, {
        token: "token",
        owner: "AstralSightStudios",
        repo: "AstroBox-Repo",
        branch: "main",
      }),
    ).rejects.toThrow("请直接输入 PR 链接或序号");
  });
});

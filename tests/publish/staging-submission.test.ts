import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createSubmissionBranch,
  type CatalogUpdateRequest,
} from "../../app/logic/publish/staging-submission";
import { PUBLISH_CONFIG } from "../../app/config/publish";

const originalFetch = globalThis.fetch;

const TARGET_REPO = `${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}`;

const CATALOG_CSV = [
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type",
  "demo-id,Demo,quick_app,sl9325,demo_astrobox_release,abc1234,icon.png,cover.png,t1,vendorA,dev1,",
].join("\n");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function blobResponse(text: string) {
  return jsonResponse({ content: btoa(text), encoding: "base64" });
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: Handler) {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    return await handler(url, init);
  }) as typeof fetch;
}

function stubAccount(login = "sl9325", token = "tok-123") {
  const store = new Map<string, string>();
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  store.set(
    "ACCOUNT_STATE_V2",
    JSON.stringify({ github: { token, username: login }, astrobox: {} }),
  );
}

function buildPayload(
  intent: { mode: "create" } | { mode: "edit"; originalId: string },
): CatalogUpdateRequest {
  const itemId = intent.mode === "create" ? "brand-new-id" : "demo-id";
  return {
    repoInfo: {
      owner: "sl9325",
      name:
        intent.mode === "create"
          ? "brand-new-id_astrobox_release"
          : "demo_astrobox_release",
      branch: "main",
      commitSha: "abcdef1234567890",
    },
    iconPath: "icon.png",
    coverPath: "cover.png",
    tags: ["t1"],
    devices: [{ id: "dev1", vendor: "vendorA" }],
    itemId,
    itemName: "Demo",
    restype: "quick_app",
    paidType: "",
    intent,
  } as CatalogUpdateRequest;
}

const EDIT_REQUEST_JSON = JSON.stringify({
  schema_version: 1,
  mode: "edit",
  original_id: "demo-id",
  base_entry_digest: "deadbeef",
  base_catalog_commit: "abc1234",
});

/** 目标仓库通用路由：目录文件 / 上游 HEAD。 */
function commonHandler(calls: Array<{ url: string; method?: string }>): Handler {
  return (url, init) => {
    calls.push({ url: url.pathname + url.search, method: init?.method });
    const path = url.pathname;
    if (path === `/repos/${PUBLISH_CONFIG.upstreamRepoOwner}/${PUBLISH_CONFIG.upstreamRepoName}/contents/${PUBLISH_CONFIG.catalogFilePath}`) {
      return jsonResponse({ content: base64Utf8(CATALOG_CSV), sha: "csv-sha" });
    }
    if (
      path === `/repos/${PUBLISH_CONFIG.upstreamRepoOwner}/${PUBLISH_CONFIG.upstreamRepoName}/git/ref/heads/${PUBLISH_CONFIG.defaultBranch}`
    ) {
      return jsonResponse({ object: { sha: "upstream-head" } });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  };
}

beforeEach(() => {
  stubAccount();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createSubmissionBranch 重复提交守卫", () => {
  test("edit 模式存在同路径未处理请求时抛错，且不发起建分支请求", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    installFetch((url, init) => {
      calls.push({ url: url.pathname + url.search, method: init?.method });
      const path = url.pathname;
      if (path.endsWith("/contents/index_v2.csv")) {
        return jsonResponse({ content: base64Utf8(CATALOG_CSV), sha: "csv-sha" });
      }
      if (path.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/${TARGET_REPO}/pulls`) {
        return jsonResponse([{ number: 668, title: "[ABCC] Update resource: Demo" }]);
      }
      if (path === `/repos/${TARGET_REPO}/pulls/668/files`) {
        return jsonResponse([
          {
            filename: "tmp/sl9325/demo_astrobox_release/request.json",
            sha: "req-blob",
          },
        ]);
      }
      if (path === `/repos/${TARGET_REPO}/git/blobs/req-blob`) {
        return blobResponse(EDIT_REQUEST_JSON);
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
    });

    try {
      await createSubmissionBranch(buildPayload({ mode: "edit", originalId: "demo-id" }));
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("PR #668");
      expect(String(error)).toContain("tmp/sl9325/demo_astrobox_release");
    }
    // 不允许走到建分支（POST git/refs）
    expect(calls.some((call) => call.url.endsWith("/git/refs"))).toBe(false);
  });

  test("create 模式同路径查重行为保持", async () => {
    installFetch((url, init) => {
      const path = url.pathname;
      if (path.endsWith("/contents/index_v2.csv")) {
        return jsonResponse({ content: base64Utf8(CATALOG_CSV), sha: "csv-sha" });
      }
      if (path.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/${TARGET_REPO}/pulls`) {
        return jsonResponse([{ number: 700, title: "old submission" }]);
      }
      if (path === `/repos/${TARGET_REPO}/pulls/700/files`) {
        return jsonResponse([
          {
            filename: "tmp/sl9325/brand-new-id_astrobox_release/resource.csv",
            sha: "csv-blob",
          },
        ]);
      }
      if (path === `/repos/${TARGET_REPO}/git/blobs/csv-blob`) {
        return blobResponse("brand-new-id,Broken,row");
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
    });

    try {
      await createSubmissionBranch(buildPayload({ mode: "create" }));
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("已有未处理请求");
      expect(String(error)).toContain("PR #700");
    }
  });

  test("跨用户开放 PR 指向同一资源 ID 时抛错并带上 PR 号与标题", async () => {
    installFetch((url, init) => {
      const path = url.pathname;
      if (path.endsWith("/contents/index_v2.csv")) {
        return jsonResponse({ content: base64Utf8(CATALOG_CSV), sha: "csv-sha" });
      }
      if (path.endsWith("/git/ref/heads/main")) {
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/${TARGET_REPO}/pulls`) {
        return jsonResponse([{ number: 770, title: "[ABCC] 别人的提交" }]);
      }
      if (path === `/repos/${TARGET_REPO}/pulls/770/files`) {
        return jsonResponse([
          {
            filename: "tmp/someone-else/x_astrobox_release/request.json",
            sha: "other-req",
          },
        ]);
      }
      if (path === `/repos/${TARGET_REPO}/git/blobs/other-req`) {
        return blobResponse(
          EDIT_REQUEST_JSON.replace('"demo-id"', '" Demo-ID "'),
        );
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
    });

    try {
      await createSubmissionBranch(buildPayload({ mode: "edit", originalId: "demo-id" }));
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("PR #770");
      expect(String(error)).toContain("[ABCC] 别人的提交");
    }
  });

  test("非法 JSON/CSV 的历史 PR 容错跳过，无冲突时正常创建分支", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    installFetch((url, init) => {
      calls.push({ url: url.pathname + url.search, method: init?.method });
      const path = url.pathname;
      // 冲突扫描阶段
      if (path.endsWith("/contents/index_v2.csv")) {
        return jsonResponse({ content: base64Utf8(CATALOG_CSV), sha: "csv-sha" });
      }
      if (path === "/repos/AstralSightStudios/AstroBox-Repo/git/ref/heads/main") {
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/${TARGET_REPO}/pulls`) {
        return jsonResponse([{ number: 775, title: "legacy junk" }]);
      }
      if (path === `/repos/${TARGET_REPO}/pulls/775/files`) {
        return jsonResponse([
          { filename: "tmp/legacy/x/request.json", sha: "junk-json" },
          { filename: "tmp/legacy/y/resource.csv", sha: "junk-csv" },
        ]);
      }
      if (path === `/repos/${TARGET_REPO}/git/blobs/junk-json`) {
        return blobResponse("not json {{{");
      }
      if (path === `/repos/${TARGET_REPO}/git/blobs/junk-csv`) {
        return blobResponse("\u0000\u0001broken");
      }
      // fork 与分支创建阶段
      if (path === `/repos/${PUBLISH_CONFIG.upstreamRepoOwner}/${PUBLISH_CONFIG.upstreamRepoName}/forks`) {
        return jsonResponse({
          owner: { login: "sl9325" },
          name: PUBLISH_CONFIG.upstreamRepoName,
          default_branch: PUBLISH_CONFIG.defaultBranch,
        });
      }
      if (
        path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/ref/heads/${PUBLISH_CONFIG.defaultBranch}` ||
        path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/refs/heads/main`
      ) {
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/merge-upstream`) {
        return jsonResponse({});
      }
      if (/\/git\/refs\/heads\/astrobox-submit-\d+/.test(path)) {
        if (init?.method === "PATCH") return jsonResponse({});
        return jsonResponse({ object: { sha: "upstream-head" } });
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/refs`) {
        return jsonResponse({}, 201);
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/commits/upstream-head`) {
        return jsonResponse({ tree: { sha: "tree-0" } });
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/blobs`) {
        return jsonResponse({ sha: `blob-${calls.length}` }, 201);
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/trees`) {
        return jsonResponse({ sha: "tree-1" }, 201);
      }
      if (path === `/repos/sl9325/${PUBLISH_CONFIG.upstreamRepoName}/git/commits`) {
        return jsonResponse({ sha: "submit-commit" }, 201);
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
    });

    const result = await createSubmissionBranch(
      buildPayload({ mode: "edit", originalId: "demo-id" }),
    );

    expect(result.branch).toMatch(/^astrobox-submit-\d+$/);
    expect(result.forkOwner).toBe("sl9325");
    expect(result.entry.id).toBe("demo-id");
    expect(result.submissionPath).toBe("tmp/sl9325/demo_astrobox_release");
    // 分支创建请求确实发生且指向 fork HEAD
    const refCreate = calls.find(
      (call) => call.url.endsWith("/git/refs") && call.method === "POST",
    );
    expect(refCreate).toBeDefined();
  });
});

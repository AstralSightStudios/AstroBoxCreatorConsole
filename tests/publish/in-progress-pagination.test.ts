import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { COMMUNITY_REPO_CONFIG } from "../../app/config/community";
import { saveAccountState } from "../../app/logic/account/store";
import { CATALOG_CSV_HEADER } from "../../app/logic/publish/catalog";
import {
  clearInProgressResourcesCache,
  loadInProgressResourcesForCurrentUser,
} from "../../app/logic/publish/resources";

const originalFetch = globalThis.fetch;
const REPO = `${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}`;
const ORG = COMMUNITY_REPO_CONFIG.owner;

const CATALOG_ROW =
  "demo-id,Demo,quick_app,creator,demo_repo,abc1234,icon.png,cover.png,tags,vendorA,dev1,";

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
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

function stubAccount(username = "creator") {
  const store = new Map<string, string>();
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  saveAccountState({
    github: {
      avatar: "",
      username,
      token: "tok-123",
      scopes: [],
    },
  });
}

beforeEach(() => {
  stubAccount();
  clearInProgressResourcesCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("loadInProgressResourcesForCurrentUser 分页", () => {
  test("加载第二页只请求 search，不再重复拉整份仓库 PR 列表", async () => {
    const calls: string[] = [];

    installFetch((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url.pathname}${url.search}`);

      if (url.pathname === "/search/issues") {
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("q")).toContain("is:unmerged");
        return jsonResponse({
          total_count: 51,
          items: [
            {
              number: 42,
              title: "[ABCC] Add new resource: Demo",
              state: "open",
              user: { login: "creator" },
              created_at: "2026-11-01T00:00:00Z",
              updated_at: "2026-11-02T00:00:00Z",
              html_url: "https://github.com/example/pull/42",
            },
          ],
        });
      }
      if (url.pathname === `/orgs/${ORG}/members`) {
        return jsonResponse([]);
      }
      if (url.pathname === `/repos/${REPO}/issues/42/comments`) {
        return jsonResponse([]);
      }
      if (url.pathname === `/repos/${REPO}/pulls/42/reviews`) {
        return jsonResponse([]);
      }
      if (url.pathname === `/repos/${REPO}/pulls/42/files`) {
        return jsonResponse([
          {
            filename: "tmp/creator/demo_repo/resource.csv",
            patch: `@@ -0,0 +1,2 @@\n+${CATALOG_CSV_HEADER}\n+${CATALOG_ROW}\n`,
          },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const result = await loadInProgressResourcesForCurrentUser({ page: 2 });

    expect(result.hasMore).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.prNumber).toBe(42);
    expect(
      calls.some((call) => call.includes("/pulls?state=all")),
    ).toBe(false);
    expect(
      calls.some(
        (call) => call.includes("/search/issues") && call.includes("page=2"),
      ),
    ).toBe(true);
  });
});

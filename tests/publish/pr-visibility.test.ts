import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { COMMUNITY_REPO_CONFIG } from "../../app/config/community";
import { saveAccountState } from "../../app/logic/account/store";
import {
  hidePullRequestRecord,
  unhidePullRequestRecord,
} from "../../app/logic/publish/pr-visibility";
import { HIDE_PR_COMMENT } from "../../app/logic/publish/review-status";

const originalFetch = globalThis.fetch;
const REPO = `${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}`;

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

function pullResponse(overrides: Record<string, unknown> = {}) {
  return {
    number: 123,
    title: "[ABCC] Add new resource: Demo",
    html_url: "https://github.com/example/pull/123",
    state: "closed",
    merged_at: null,
    user: { login: "creator" },
    head: {
      ref: "astrobox-submit-1",
      sha: "abc123",
      repo: {
        full_name: `${REPO}`,
        name: COMMUNITY_REPO_CONFIG.name,
        owner: { login: "creator" },
        fork: true,
      },
    },
    base: { ref: COMMUNITY_REPO_CONFIG.defaultBranch },
    ...overrides,
  };
}

beforeEach(() => {
  stubAccount();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("hidePullRequestRecord", () => {
  test("posts a HIDE marker on a closed PR owned by the current user", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    let postedBody = "";

    installFetch((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path: url.pathname });
      if (url.pathname === `/repos/${REPO}/pulls/123`) {
        return jsonResponse(pullResponse());
      }
      if (url.pathname === `/repos/${REPO}/issues/123/comments`) {
        if (method === "POST") {
          postedBody = String(init?.body ?? "");
          return jsonResponse({ id: 999 });
        }
        return jsonResponse([]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    await hidePullRequestRecord(123);

    expect(postedBody).toContain(HIDE_PR_COMMENT);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /repos/${REPO}/pulls/123`,
      `GET /repos/${REPO}/issues/123/comments`,
      `POST /repos/${REPO}/issues/123/comments`,
    ]);
  });

  test("does not post a duplicate marker when the author already hid it", async () => {
    const calls: Array<{ method: string; path: string }> = [];

    installFetch((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path: url.pathname });
      if (url.pathname === `/repos/${REPO}/pulls/123`) {
        return jsonResponse(pullResponse());
      }
      if (url.pathname === `/repos/${REPO}/issues/123/comments`) {
        return jsonResponse([
          { id: 88, body: HIDE_PR_COMMENT, user: { login: "creator" } },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    await hidePullRequestRecord(123);

    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  test("rejects open pull requests", async () => {
    installFetch((url) => {
      if (url.pathname === `/repos/${REPO}/pulls/123`) {
        return jsonResponse(pullResponse({ state: "open", merged_at: null }));
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    await expect(hidePullRequestRecord(123)).rejects.toThrow(
      "只能隐藏已关闭的 PR。",
    );
  });

  test("rejects pull requests authored by other users", async () => {
    installFetch((url) => {
      if (url.pathname === `/repos/${REPO}/pulls/123`) {
        return jsonResponse(
          pullResponse({ user: { login: "someone-else" } }),
        );
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    await expect(hidePullRequestRecord(123)).rejects.toThrow(
      "只能隐藏你自己提交的 PR。",
    );
  });
});

describe("unhidePullRequestRecord", () => {
  test("deletes only the current author's markers", async () => {
    const deleted: string[] = [];

    installFetch((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.pathname === `/repos/${REPO}/issues/123/comments`) {
        return jsonResponse([
          { id: 88, body: HIDE_PR_COMMENT, user: { login: "creator" } },
          { id: 89, body: HIDE_PR_COMMENT, user: { login: "someone-else" } },
          { id: 90, body: "普通评论", user: { login: "creator" } },
        ]);
      }
      if (
        method === "DELETE" &&
        url.pathname.startsWith(`/repos/${REPO}/issues/comments/`)
      ) {
        deleted.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const count = await unhidePullRequestRecord(123);

    expect(count).toBe(1);
    expect(deleted).toEqual([`/repos/${REPO}/issues/comments/88`]);
  });
});

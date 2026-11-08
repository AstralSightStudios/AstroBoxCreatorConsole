import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { COMMUNITY_REPO_CONFIG } from "../../app/config/community";
import { CATALOG_CSV_HEADER } from "../../app/logic/publish/catalog";
import { saveAccountState } from "../../app/logic/account/store";
import {
  findOpenSubmissionForResourceId,
  type OpenSubmissionLookupProgress,
} from "../../app/logic/publish/staging-submission";

const originalFetch = globalThis.fetch;
const REPO = `${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}`;

const CATALOG_ROW =
  "demo-id,Demo,quick_app,creator,demo_repo,abc1234,icon.png,cover.png,tags,vendorA,dev1,";

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
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

function stubAccount() {
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
      username: "creator",
      token: "tok-123",
      scopes: [],
    },
  });
}

beforeEach(() => {
  stubAccount();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("findOpenSubmissionForResourceId", () => {
  test("并发扫描开放 PR，命中后返回并汇报进度", async () => {
    const progress: OpenSubmissionLookupProgress[] = [];

    installFetch((url) => {
      if (url.pathname === `/repos/${REPO}/pulls`) {
        return jsonResponse([
          { number: 11, title: "PR A" },
          { number: 12, title: "PR B" },
        ]);
      }
      if (url.pathname === `/repos/${REPO}/pulls/11/files`) {
        return jsonResponse([]);
      }
      if (url.pathname === `/repos/${REPO}/pulls/12/files`) {
        return jsonResponse([
          {
            filename: "tmp/creator/demo_repo/resource.csv",
            sha: "sha-12",
          },
        ]);
      }
      if (url.pathname === `/repos/${REPO}/git/blobs/sha-12`) {
        return jsonResponse({
          content: base64Utf8(`${CATALOG_CSV_HEADER}\n${CATALOG_ROW}`),
          encoding: "base64",
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const result = await findOpenSubmissionForResourceId(
      "tok-123",
      "demo-id",
      (next) => progress.push(next),
    );

    expect(result).toEqual({
      prNumber: 12,
      prTitle: "PR B",
      mode: "unknown",
    });
    expect(progress[0]).toEqual({ done: 0, total: 2 });
    expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 });
  });
});

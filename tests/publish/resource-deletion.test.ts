import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { saveAccountState } from "../../app/logic/account/store";
import type { CatalogEntry } from "../../app/logic/publish/catalog";
import {
  buildDeletionPullRequestBody,
  buildDeletionPullRequestTitle,
  deleteResourceRepository,
  DELETE_RESOURCE_AND_REPO_CONFIRMATION,
  DELETE_RESOURCE_CONFIRMATION,
  isLegacyItemId,
  requiredDeletionConfirmation,
  ResourceDeletionError,
} from "../../app/logic/publish/resource-deletion";

const ENTRY: CatalogEntry = {
  id: "demo",
  name: "Demo Resource",
  restype: "quick_app",
  repo_owner: "OctoCat",
  repo_name: "AstroBox-Resource-Demo",
  repo_commit_hash: "abcdef1",
  icon: "media/icon.png",
  cover: "media/cover.png",
  tags: "utility;demo",
  device_vendors: "vendor-a",
  devices: "device-a",
  paid_type: "",
};

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubAccount(options: { scopes?: string[]; username?: string } = {}) {
  const store = new Map<string, string>();
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  saveAccountState({
    activeProvider: "github",
    github: {
      avatar: "",
      token: "tok-123",
      username: options.username ?? "OctoCat",
      scopes: options.scopes ?? ["repo", "delete_repo"],
    },
  });
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: Handler) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    calls.push({ url: url.pathname, method: (init?.method ?? "GET").toUpperCase() });
    return await handler(url, init);
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  stubAccount();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resource deletion helpers", () => {
  test("uses the exact typed confirmation for each branch", () => {
    expect(requiredDeletionConfirmation(false)).toBe(
      DELETE_RESOURCE_CONFIRMATION,
    );
    expect(requiredDeletionConfirmation(true)).toBe(
      DELETE_RESOURCE_AND_REPO_CONFIRMATION,
    );
    expect(DELETE_RESOURCE_CONFIRMATION).toBe(
      "我已知悉后果，确认从AstroBox删除此资源。",
    );
    expect(DELETE_RESOURCE_AND_REPO_CONFIRMATION).toBe(
      "我已知悉后果，确认从AstroBox删除此资源索引，并删除资源所在仓库，明白仓库无法恢复。",
    );
  });

  test("writes the confirmation and repository status into the PR body", () => {
    const keep = buildDeletionPullRequestBody({
      entry: ENTRY,
      deleteRepository: false,
      repoDeleted: false,
    });
    expect(keep).toContain(
      "创作者已确认删除此资源，并“已知悉后果，确认从AstroBox删除此资源”",
    );
    expect(keep).toContain("- 仓库处理：保留");

    const remove = buildDeletionPullRequestBody({
      entry: ENTRY,
      deleteRepository: true,
      repoDeleted: true,
    });
    expect(remove).toContain(
      "创作者已确认删除此资源，并“已知悉后果，确认从AstroBox删除此资源索引，并删除资源所在仓库，明白仓库无法恢复。”",
    );
    expect(remove).toContain("- 仓库处理：已删除");
  });

  test("builds the delete PR title and recognizes legacy ids", () => {
    expect(buildDeletionPullRequestTitle(ENTRY)).toBe(
      "[ABCC] Delete resource: Demo Resource",
    );
    expect(isLegacyItemId("LegacyItem108")).toBe(true);
    expect(isLegacyItemId("cn.waijade.2048")).toBe(false);
  });
});

describe("deleteResourceRepository", () => {
  test("deletes an owned repository", async () => {
    const calls = installFetch((url, init) => {
      if (url.pathname === "/repos/OctoCat/AstroBox-Resource-Demo") {
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          full_name: "OctoCat/AstroBox-Resource-Demo",
          owner: { login: "OctoCat" },
          permissions: { admin: true },
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).resolves.toBe("deleted");
    expect(calls.at(-1)).toEqual({
      url: "/repos/OctoCat/AstroBox-Resource-Demo",
      method: "DELETE",
    });
  });

  test("treats a missing repository as already gone", async () => {
    installFetch(() => jsonResponse({ message: "not found" }, 404));
    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).resolves.toBe("already-gone");
  });

  test("refuses a repository owned by another account", async () => {
    installFetch(() =>
      jsonResponse({
        full_name: "SomeoneElse/AstroBox-Resource-Demo",
        owner: { login: "SomeoneElse" },
        permissions: { admin: true },
      }),
    );
    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).rejects.toMatchObject({
      name: "ResourceDeletionError",
      code: "repo-not-owned",
    });
  });

  test("refuses when the token lacks delete_repo", async () => {
    stubAccount({ scopes: ["repo"] });
    installFetch(() => jsonResponse({}, 200));
    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).rejects.toBeInstanceOf(ResourceDeletionError);
    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).rejects.toMatchObject({ code: "scope-missing" });
  });

  test("refuses when the account is not an admin", async () => {
    installFetch(() =>
      jsonResponse({
        full_name: "OctoCat/AstroBox-Resource-Demo",
        owner: { login: "OctoCat" },
        permissions: { admin: false },
      }),
    );
    await expect(
      deleteResourceRepository({ entry: ENTRY }),
    ).rejects.toMatchObject({ code: "repo-no-admin" });
  });
});

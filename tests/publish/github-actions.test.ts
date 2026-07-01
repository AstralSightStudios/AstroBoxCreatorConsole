import { afterEach, describe, expect, test } from "bun:test";
import { ensureMainResourceBranch, type RepoInfo } from "../../app/logic/publish/github-actions";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("ensureMainResourceBranch", () => {
  test("creates main from the GitHub-created default branch when main is missing", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ message: "Not Found" }, 404),
      jsonResponse({ object: { sha: "source-sha" } }),
      jsonResponse({}, 201),
    ];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch call");
      return response;
    }) as typeof fetch;

    const repo: RepoInfo = {
      owner: "octocat",
      name: "astrobox-resource-demo",
      branch: "main",
      sourceBranch: "master",
    };

    await ensureMainResourceBranch(repo, "token-123");

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/octocat/astrobox-resource-demo/git/refs/heads/main",
      "https://api.github.com/repos/octocat/astrobox-resource-demo/git/refs/heads/master",
      "https://api.github.com/repos/octocat/astrobox-resource-demo/git/refs",
    ]);
    expect(calls[2].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      ref: "refs/heads/main",
      sha: "source-sha",
    });
  });

  test("looks up the repository default branch when no source branch is known", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ message: "Not Found" }, 404),
      jsonResponse({ default_branch: "master" }),
      jsonResponse({ object: { sha: "default-sha" } }),
      jsonResponse({}, 201),
    ];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch call");
      return response;
    }) as typeof fetch;

    await ensureMainResourceBranch(
      { owner: "octocat", name: "legacy-resource", branch: "main" },
      "token-123",
    );

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/octocat/legacy-resource/git/refs/heads/main",
      "https://api.github.com/repos/octocat/legacy-resource",
      "https://api.github.com/repos/octocat/legacy-resource/git/refs/heads/master",
      "https://api.github.com/repos/octocat/legacy-resource/git/refs",
    ]);
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      ref: "refs/heads/main",
      sha: "default-sha",
    });
  });

  test("does nothing when the upload branch already exists", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({ object: { sha: "main-sha" } });
    }) as typeof fetch;

    await ensureMainResourceBranch(
      { owner: "octocat", name: "repo", branch: "main", sourceBranch: "master" },
      "token-123",
    );

    expect(calls).toEqual([
      "https://api.github.com/repos/octocat/repo/git/refs/heads/main",
    ]);
  });
});

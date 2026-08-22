import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Import the module BEFORE mocking browser globals: it transitively imports
// github-actions.ts, whose module-level `isWeb` constant snapshots the absence
// of `window` — same environment the other (publish) tests rely on.
const {
  compareVersions,
  fetchLatestRelease,
  getIgnoredTag,
  ignoreTag,
  isIgnored,
  isUpdateCheckDisabled,
  normalizeVersion,
  setUpdateCheckDisabled,
} = await import("../../app/logic/update/update-checker");

// Mock browser globals only for the storage-backed helpers below.
// bun runs all test files in one process, so restore them afterwards to avoid
// leaking into sibling test files.
const store: Record<string, string> = {};
const definedGlobals: Array<{ key: "window" | "localStorage"; had: boolean; value?: unknown }> = [];

function setupBrowserMocks() {
  const target = globalThis as Record<string, unknown>;
  for (const key of ["window", "localStorage"] as const) {
    definedGlobals.push({ key, had: key in target, value: target[key] });
    if (key === "localStorage") {
      Object.defineProperty(target, key, {
        value: {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => {
            store[k] = String(v);
          },
          removeItem: (k: string) => {
            delete store[k];
          },
          clear: () => {
            for (const k in store) {
              delete store[k];
            }
          },
        },
        writable: true,
        configurable: true,
      });
    } else {
      Object.defineProperty(target, key, {
        value: globalThis,
        writable: true,
        configurable: true,
      });
    }
  }
}

function teardownBrowserMocks() {
  const target = globalThis as Record<string, unknown>;
  while (definedGlobals.length) {
    const entry = definedGlobals.pop()!;
    if (entry.had) {
      Object.defineProperty(target, entry.key, {
        value: entry.value,
        writable: true,
        configurable: true,
      });
    } else {
      delete target[entry.key];
    }
  }
}

const hasBrowserMocks = () => definedGlobals.length > 0;

describe("normalizeVersion", () => {
  test("strips leading v prefix and whitespace", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("V0.2.1")).toBe("0.2.1");
    expect(normalizeVersion("  1.0.0 ")).toBe("1.0.0");
    expect(normalizeVersion("")).toBe("");
  });
});

describe("compareVersions", () => {
  test("orders plain semver strings", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  test("ignores v prefix on either side", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.4", "v1.2.3")).toBeGreaterThan(0);
  });

  test("pads missing segments with zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
  });

  test("falls back to string compare for non-numeric segments", () => {
    expect(compareVersions("1.2.3-beta", "1.2.3-beta")).toBe(0);
    expect(compareVersions("1.2.a", "1.2.b")).toBeLessThan(0);
    expect(compareVersions("1.2.b", "1.2.a")).toBeGreaterThan(0);
  });
});

describe("fetchLatestRelease", () => {
  const originalFetch = globalThis.fetch;

  function mockFetchOnce(payload: unknown, status = 200) {
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    return () => called;
  }

  test("maps the latest release payload", async () => {
    const restore = mockFetchOnce({
      tag_name: "v1.2.3",
      name: "Release 1.2.3",
      html_url:
        "https://github.com/AstralSightStudios/AstroBoxCreatorConsole/releases/tag/v1.2.3",
      body: "- fix bugs",
      published_at: "2026-08-13T15:55:25Z",
    });

    const info = await fetchLatestRelease();
    expect(info).toEqual({
      tagName: "v1.2.3",
      name: "Release 1.2.3",
      htmlUrl:
        "https://github.com/AstralSightStudios/AstroBoxCreatorConsole/releases/tag/v1.2.3",
      body: "- fix bugs",
      publishedAt: "2026-08-13T15:55:25Z",
    });
    expect(restore()).toBe(1);

    globalThis.fetch = originalFetch;
  });

  test("returns null when repo has no releases (404)", async () => {
    const restore = mockFetchOnce({ message: "Not Found" }, 404);
    const info = await fetchLatestRelease();
    expect(info).toBeNull();
    globalThis.fetch = originalFetch;
    restore();
  });
});

describe("ignored tag / check-disabled storage", () => {
  beforeEach(() => {
    if (!hasBrowserMocks()) setupBrowserMocks();
    ignoreTag("");
    setUpdateCheckDisabled(false);
  });

  afterEach(teardownBrowserMocks);

  test("ignoreTag round-trips and isIgnored matches only same tag", () => {
    expect(getIgnoredTag()).toBe("");
    ignoreTag("v1.2.3");
    expect(getIgnoredTag()).toBe("v1.2.3");
    expect(isIgnored("v1.2.3")).toBe(true);
    expect(isIgnored("v1.2.4")).toBe(false);
    expect(isIgnored("")).toBe(false);
  });

  test("setUpdateCheckDisabled round-trips", () => {
    expect(isUpdateCheckDisabled()).toBe(false);
    setUpdateCheckDisabled(true);
    expect(isUpdateCheckDisabled()).toBe(true);
    setUpdateCheckDisabled(false);
    expect(isUpdateCheckDisabled()).toBe(false);
  });
});

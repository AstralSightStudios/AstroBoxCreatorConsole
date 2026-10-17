import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Import the module BEFORE mocking browser globals: it transitively imports
// github-actions.ts, whose module-level `isWeb` constant snapshots the absence
// of `window` — same environment the other (publish) tests rely on.
const {
  UPDATE_REPO,
  checkForBetaUpdate,
  compareBetaBuildWithInstalled,
  compareVersions,
  fetchLatestRelease,
  getIgnoredTag,
  ignoreBetaBuild,
  ignoreTag,
  isBetaBuildIgnored,
  isBetaBuildNotified,
  isIgnored,
  isUpdateCheckDisabled,
  markBetaBuildNotified,
  normalizeVersion,
  parseBetaArtifactName,
  selectBetaArtifact,
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

  test("ignoreBetaBuild only matches the same run attempt", () => {
    ignoreBetaBuild({ runId: 170, runAttempt: 2 });
    expect(isBetaBuildIgnored({ runId: 170, runAttempt: 2 })).toBe(true);
    expect(isBetaBuildIgnored({ runId: 170, runAttempt: 1 })).toBe(false);
    expect(isBetaBuildIgnored({ runId: 171, runAttempt: 2 })).toBe(false);
  });

  test("markBetaBuildNotified only matches the same run attempt", () => {
    markBetaBuildNotified({ runId: 171, runAttempt: 1 });
    expect(isBetaBuildNotified({ runId: 171, runAttempt: 1 })).toBe(true);
    expect(isBetaBuildNotified({ runId: 171, runAttempt: 2 })).toBe(false);
  });
});

describe("parseBetaArtifactName", () => {
  test("parses version, run number, attempt and platform", () => {
    expect(
      parseBetaArtifactName(
        "astrobox-creator-console-0.4.0-170.1-windows",
      ),
    ).toEqual({
      version: "0.4.0",
      runNumber: 170,
      attempt: 1,
      platform: "windows",
    });
    expect(
      parseBetaArtifactName(
        "astrobox-creator-console-1.2.3-beta.1-42.12-android",
      ),
    ).toEqual({
      version: "1.2.3-beta.1",
      runNumber: 42,
      attempt: 12,
      platform: "android",
    });
  });

  test("rejects legacy or malformed artifact names", () => {
    expect(parseBetaArtifactName("tauri-build-windows-latest")).toBeNull();
    expect(parseBetaArtifactName("android-apk")).toBeNull();
    expect(
      parseBetaArtifactName("astrobox-creator-console-0.4.0-170-windows"),
    ).toBeNull();
    expect(
      parseBetaArtifactName("astrobox-creator-console--170.1-windows"),
    ).toBeNull();
    expect(
      parseBetaArtifactName("astrobox-creator-console-0.4.0-170.1-ios"),
    ).toBeNull();
  });
});

describe("compareBetaBuildWithInstalled", () => {
  const installed = {
    ciRunNumber: 170,
    ciRunAttempt: 1,
    commitSha: "",
    sourceDirty: false,
  };

  test("treats the same run and attempt as up-to-date", () => {
    expect(
      compareBetaBuildWithInstalled(installed, {
        runNumber: 170,
        runAttempt: 1,
      }),
    ).toBe("up-to-date");
  });

  test("treats a newer run or attempt as an update", () => {
    expect(
      compareBetaBuildWithInstalled(installed, {
        runNumber: 171,
        runAttempt: 1,
      }),
    ).toBe("update");
    expect(
      compareBetaBuildWithInstalled(installed, {
        runNumber: 170,
        runAttempt: 2,
      }),
    ).toBe("update");
  });

  test("treats an older run as up-to-date", () => {
    expect(
      compareBetaBuildWithInstalled(installed, {
        runNumber: 169,
        runAttempt: 3,
      }),
    ).toBe("up-to-date");
  });

  test("returns unknown for dirty or non-CI builds", () => {
    expect(
      compareBetaBuildWithInstalled(
        { ...installed, sourceDirty: true },
        { runNumber: 171, runAttempt: 1 },
      ),
    ).toBe("unknown");
    expect(
      compareBetaBuildWithInstalled(
        {
          ciRunNumber: 0,
          ciRunAttempt: 0,
          commitSha: "",
          sourceDirty: false,
        },
        { runNumber: 171, runAttempt: 1 },
      ),
    ).toBe("unknown");
  });
});

describe("selectBetaArtifact", () => {
  const artifacts = [
    { platform: "windows", name: "win" },
    { platform: "linux", name: "linux" },
  ];

  test("selects the artifact for the current platform", () => {
    expect(selectBetaArtifact({ artifacts }, "windows")?.name).toBe("win");
    expect(selectBetaArtifact({ artifacts }, "linux")?.name).toBe("linux");
    expect(selectBetaArtifact({ artifacts }, "macos")).toBeNull();
  });

  test("only falls back to the sole artifact when platform is unknown", () => {
    expect(selectBetaArtifact({ artifacts }, null)).toBeNull();
    expect(
      selectBetaArtifact({ artifacts: [artifacts[0]] }, null)?.name,
    ).toBe("win");
  });
});

describe("beta update API", () => {
  const originalFetch = globalThis.fetch;
  const sha = "3134571ab0b53ccd140f692f62d8008b5f11acf5";
  const repository = { id: 1101939861, full_name: UPDATE_REPO };

  function makeRun(overrides: Record<string, unknown> = {}) {
    return {
      id: 39046353875,
      run_number: 170,
      run_attempt: 1,
      name: "tauri-ci",
      path: ".github/workflows/main.yml",
      head_branch: "main",
      head_sha: sha,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/AstralSightStudios/AstroBoxCreatorConsole/actions/runs/39046353875",
      created_at: "2026-10-17T15:44:14Z",
      updated_at: "2026-10-17T15:52:38Z",
      repository,
      head_repository: repository,
      ...overrides,
    };
  }

  function makeArtifact(
    name: string,
    run: ReturnType<typeof makeRun>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: 1,
      name,
      size_in_bytes: 1024,
      archive_download_url: `https://api.github.com/repos/${UPDATE_REPO}/actions/artifacts/1/zip`,
      expires_at: "2099-01-01T00:00:00Z",
      expired: false,
      workflow_run: {
        id: run.id,
        repository_id: repository.id,
        head_repository_id: repository.id,
        head_branch: run.head_branch,
        head_sha: sha,
      },
      ...overrides,
    };
  }

  function mockApi(handler: (url: string) => unknown) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const payload = handler(url);
      if (payload === undefined) {
        throw new Error(`unexpected GitHub API request: ${url}`);
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("compares against installed run and ignores untrusted runs", async () => {
    const trusted = makeRun();
    const untrusted = makeRun({ id: 2, run_number: 200, head_branch: "dev" });
    const artifacts = [
      makeArtifact("astrobox-creator-console-0.4.0-170.1-windows", trusted),
      makeArtifact("astrobox-creator-console-0.4.0-170.1-linux", trusted, {
        id: 2,
      }),
    ];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [untrusted, trusted] };
      }
      if (url.includes(`/actions/runs/${trusted.id}/artifacts`)) {
        return { artifacts };
      }
      return undefined;
    });

    const result = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 169,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.prompt.comparison).toBe("update");
    expect(result.prompt.info.runNumber).toBe(170);
    expect(result.prompt.info.runAttempt).toBe(1);
    expect(result.prompt.info.buildLabel).toBe("beta #170.1");
    expect(result.prompt.info.artifacts.map((item) => item.platform)).toEqual([
      "linux",
      "windows",
    ]);
  });

  test("accepts version-tag runs as trusted builds", async () => {
    const tagRun = makeRun({ id: 5, run_number: 172, head_branch: "v0.5.0" });
    const artifacts = [
      makeArtifact("astrobox-creator-console-0.5.0-172.1-windows", tagRun),
    ];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [tagRun] };
      }
      if (url.includes(`/actions/runs/${tagRun.id}/artifacts`)) {
        return { artifacts };
      }
      return undefined;
    });

    const result = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 171,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.prompt.info.runNumber).toBe(172);
    expect(result.prompt.info.version).toBe("0.5.0");
  });

  test("does not report an update when already on the latest run", async () => {
    const trusted = makeRun();
    const artifacts = [
      makeArtifact("astrobox-creator-console-0.4.0-170.1-windows", trusted),
    ];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [trusted] };
      }
      if (url.includes(`/actions/runs/${trusted.id}/artifacts`)) {
        return { artifacts };
      }
      return undefined;
    });

    const result = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 170,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });

    expect(result.status).toBe("up-to-date");
  });

  test("skips expired artifacts and falls back to an older run", async () => {
    const newest = makeRun({ id: 3, run_number: 171 });
    const older = makeRun({ id: 4, run_number: 170 });
    const expired = [
      makeArtifact("astrobox-creator-console-0.4.0-171.1-windows", newest, {
        expires_at: "2020-01-01T00:00:00Z",
      }),
    ];
    const valid = [
      makeArtifact("astrobox-creator-console-0.4.0-170.1-windows", older),
    ];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [newest, older] };
      }
      if (url.includes(`/actions/runs/${newest.id}/artifacts`)) {
        return { artifacts: expired };
      }
      if (url.includes(`/actions/runs/${older.id}/artifacts`)) {
        return { artifacts: valid };
      }
      return undefined;
    });

    const result = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 169,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.prompt.info.runNumber).toBe(170);
  });

  test("uses the latest attempt and rejects attempt numbers from the future", async () => {
    const run = makeRun({ run_attempt: 2 });
    const artifacts = [
      makeArtifact("astrobox-creator-console-0.4.0-170.1-windows", run),
      makeArtifact("astrobox-creator-console-0.4.0-170.2-linux", run, {
        id: 2,
      }),
      makeArtifact("astrobox-creator-console-0.4.0-170.3-macos", run, {
        id: 3,
      }),
    ];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [run] };
      }
      if (url.includes(`/actions/runs/${run.id}/artifacts`)) {
        return { artifacts };
      }
      return undefined;
    });

    const result = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 169,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.prompt.info.runAttempt).toBe(2);
    expect(result.prompt.info.artifacts.map((item) => item.platform)).toEqual([
      "linux",
    ]);
  });

  test("accepts legacy artifact names on the first attempt", async () => {
    const run = makeRun();
    const artifacts = [makeArtifact("tauri-build-windows-latest", run)];

    mockApi((url) => {
      if (url.includes("/actions/workflows/main.yml/runs")) {
        return { workflow_runs: [run] };
      }
      if (url.includes(`/actions/runs/${run.id}/artifacts`)) {
        return { artifacts };
      }
      return undefined;
    });

    const firstAttempt = await checkForBetaUpdate({
      force: true,
      installedBuild: {
        ciRunNumber: 169,
        ciRunAttempt: 1,
        commitSha: "",
        sourceDirty: false,
      },
    });
    expect(firstAttempt.status).toBe("available");
    if (firstAttempt.status === "available") {
      expect(firstAttempt.prompt.info.artifacts[0].platform).toBe("windows");
    }
  });
});

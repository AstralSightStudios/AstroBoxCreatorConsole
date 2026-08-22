import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Import the module BEFORE mocking browser globals (same rationale as the
// update-checker test: avoid perturbing module-level environment snapshots
// that sibling test files rely on).
const {
  BROADCAST_URLS,
  broadcastKey,
  fetchBroadcasts,
  filterUnseen,
  isBroadcastSeen,
  markBroadcastSeen,
} = await import("../../app/logic/announcement/broadcast");

const store: Record<string, string> = {};
const originalGlobals: Array<{ key: string; had: boolean; value?: unknown }> = [];

function setupBrowserMocks() {
  const target = globalThis as Record<string, unknown>;
  for (const key of ["window", "localStorage"]) {
    originalGlobals.push({ key, had: key in target, value: target[key] });
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
            for (const k in store) delete store[k];
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
  while (originalGlobals.length) {
    const entry = originalGlobals.pop()!;
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

const ITEM_A = { title: "温馨提示", content: "hello" };
const ITEM_B = { title: "更新说明", content: "world" };

describe("broadcastKey", () => {
  test("is stable for identical content and differs otherwise", () => {
    expect(broadcastKey(ITEM_A)).toBe(broadcastKey({ ...ITEM_A }));
    expect(broadcastKey(ITEM_A)).not.toBe(broadcastKey(ITEM_B));
    // 内容变化后应视为新公告
    expect(broadcastKey(ITEM_A)).not.toBe(
      broadcastKey({ ...ITEM_A, content: "changed" }),
    );
  });
});

describe("fetchBroadcasts", () => {
  const originalFetch = globalThis.fetch;

  function mockFetch(handlers: Map<string, () => Response>) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const handler = handlers.get(url);
      if (!handler) throw new Error(`unexpected url ${url}`);
      return handler();
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("normalizes entries and drops empty ones", async () => {
    mockFetch(
      new Map([
        [
          BROADCAST_URLS[0],
          () =>
            new Response(
              JSON.stringify([
                { title: "  温馨提示  ", content: " hello " },
                { title: "", content: "" },
                null,
                "junk",
                { title: "", content: "只有正文" },
              ]),
              { status: 200 },
            ),
        ],
      ]),
    );

    const items = await fetchBroadcasts();
    expect(items).toEqual([
      { title: "温馨提示", content: "hello" },
      { title: "公告", content: "只有正文" },
    ]);
  });

  test("returns [] for non-array payloads", async () => {
    mockFetch(
      new Map([
        [BROADCAST_URLS[0], () => new Response(JSON.stringify({}), { status: 200 })],
      ]),
    );
    expect(await fetchBroadcasts()).toEqual([]);
  });

  test("falls back to the next mirror when the primary fails", async () => {
    mockFetch(
      new Map([
        [BROADCAST_URLS[0], () => new Response("", { status: 500 })],
        [
          BROADCAST_URLS[1],
          () =>
            new Response(JSON.stringify([ITEM_B]), { status: 200 }),
        ],
      ]),
    );

    const items = await fetchBroadcasts();
    expect(items).toEqual([ITEM_B]);
  });

  test("throws when every mirror fails", async () => {
    mockFetch(
      new Map([
        [BROADCAST_URLS[0], () => new Response("", { status: 500 })],
        [BROADCAST_URLS[1], () => new Response("", { status: 503 })],
      ]),
    );
    await expect(fetchBroadcasts()).rejects.toThrow("HTTP 503");
  });
});

describe("seen memory", () => {
  beforeEach(() => {
    if (!(globalThis as Record<string, unknown>).window) {
      setupBrowserMocks();
    } else {
      for (const key in store) delete store[key];
    }
  });

  afterEach(teardownBrowserMocks);

  test("markBroadcastSeen + filterUnseen round-trips", () => {
    expect(filterUnseen([ITEM_A, ITEM_B])).toEqual([ITEM_A, ITEM_B]);

    markBroadcastSeen(ITEM_A);
    expect(isBroadcastSeen(ITEM_A)).toBe(true);
    expect(isBroadcastSeen(ITEM_B)).toBe(false);
    expect(filterUnseen([ITEM_A, ITEM_B])).toEqual([ITEM_B]);

    // 内容变化视为未看过
    const edited = { ...ITEM_A, content: "new" };
    expect(isBroadcastSeen(edited)).toBe(false);
  });
});

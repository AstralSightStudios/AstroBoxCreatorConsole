import { afterEach, describe, expect, test } from "bun:test";
import {
  buildDeviceJsonSourceUrls,
  fetchDeviceJsonViaCdn,
} from "../../app/logic/devices/device-json-cdn";

const OWNER = "AstralSightStudios";
const REPO = "AstroBox-Repo";
const REF = "main";
const PATH = "devices_v2.json";

describe("buildDeviceJsonSourceUrls", () => {
  test("orders jsDelivr first, GitHub raw second, proxy mirrors last", () => {
    const urls = buildDeviceJsonSourceUrls(OWNER, REPO, REF, PATH);
    expect(urls).toEqual([
      `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${REF}/${PATH}`,
      `https://fastly.jsdelivr.net/gh/${OWNER}/${REPO}@${REF}/${PATH}`,
      `https://testingcf.jsdelivr.net/gh/${OWNER}/${REPO}@${REF}/${PATH}`,
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
      `https://ghfast.top/https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
      `https://gh-proxy.com/https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
      `https://gh-proxy.org/https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
      `https://gh.ddlc.top/https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
      `https://cors.isteed.cc/https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${PATH}`,
    ]);
  });

  test("encodes path segments but keeps slashes", () => {
    const urls = buildDeviceJsonSourceUrls(OWNER, REPO, REF, "a b/c d.json");
    expect(urls[0]).toBe(
      `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${REF}/a%20b/c%20d.json`,
    );
  });
});

describe("fetchDeviceJsonViaCdn", () => {
  const originalFetch = globalThis.fetch;
  const payload = { vendor: { M2345B1: { id: "xmb9", name: "Xiaomi 15" } } };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockSequence(handlers: Array<(url: string) => Response>) {
    const seenUrls: string[] = [];
    let call = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      const handler = handlers[Math.min(call, handlers.length - 1)];
      call += 1;
      return handler(url);
    }) as typeof fetch;
    return seenUrls;
  }

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }

  test("returns the parsed payload from the first healthy source", async () => {
    const seenUrls = mockSequence([() => jsonResponse(payload)]);
    const result = await fetchDeviceJsonViaCdn(OWNER, REPO, REF);
    expect(result).toEqual(payload);
    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toContain("cdn.jsdelivr.net");
  });

  test("falls back to GitHub raw only after every jsDelivr host fails", async () => {
    const seenUrls = mockSequence([
      () => new Response("boom", { status: 502 }),
      () => Promise.reject(new Error("network down")),
      () => new Response("", { status: 403 }),
      () => jsonResponse(payload),
    ]);
    const result = await fetchDeviceJsonViaCdn(OWNER, REPO, REF);
    expect(result).toEqual(payload);
    expect(seenUrls[0]).toContain("https://cdn.jsdelivr.net/");
    expect(seenUrls[1]).toContain("https://fastly.jsdelivr.net/");
    expect(seenUrls[2]).toContain("https://testingcf.jsdelivr.net/");
    expect(seenUrls[3]).toContain("https://raw.githubusercontent.com/");
  });

  test("skips sources returning invalid JSON bodies", async () => {
    const seenUrls = mockSequence([
      () => new Response("<html>504 Gateway</html>", { status: 200 }),
      () => new Response("not json", { status: 200 }),
      () => jsonResponse(payload),
    ]);
    const result = await fetchDeviceJsonViaCdn(OWNER, REPO, REF);
    expect(result).toEqual(payload);
    expect(seenUrls).toHaveLength(3);
  });

  test("walks every mirror until one succeeds", async () => {
    const urls = buildDeviceJsonSourceUrls(OWNER, REPO, REF, PATH);
    const seenUrls = mockSequence([
      () => new Response("", { status: 404 }),
      () => Promise.reject(new Error("network down")),
      () => new Response("", { status: 403 }),
      () => jsonResponse(payload),
    ]);
    const result = await fetchDeviceJsonViaCdn(OWNER, REPO, REF);
    expect(result).toEqual(payload);
    expect(seenUrls).toEqual(urls.slice(0, 4));
  });

  test("throws the last error after exhausting all sources", async () => {
    const urls = buildDeviceJsonSourceUrls(OWNER, REPO, REF, PATH);
    mockSequence([() => new Response("nope", { status: 404 })]);
    await expect(fetchDeviceJsonViaCdn(OWNER, REPO, REF)).rejects.toThrow(
      `HTTP 404 ${urls[urls.length - 1]}`,
    );
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  updateCatalogEntryOnBranch,
  type CatalogEntry,
} from "../../app/logic/publish/catalog";

const originalFetch = globalThis.fetch;

const CATALOG_HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

const BASE_ENTRY: CatalogEntry = {
  id: "demo",
  name: "Demo Resource",
  restype: "quick_app",
  repo_owner: "octocat",
  repo_name: "astrobox-resource-demo",
  repo_commit_hash: "abcdef1",
  icon: "media/icon.png",
  cover: "media/cover.png",
  tags: "utility;demo",
  device_vendors: "vendor-a;vendor-b",
  devices: "device-a;device-b",
  paid_type: "",
};

const CATALOG_FIELDS = Object.keys(BASE_ENTRY) as Array<keyof CatalogEntry>;
const STRUCTURAL_CHAR_CASES = [
  { label: "comma", value: "bad,value" },
  { label: "line feed", value: "bad\nvalue" },
  { label: "carriage return", value: "bad\rvalue" },
  { label: "NUL", value: "bad\0value" },
];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function installCatalogFetchMock(csv = CATALOG_HEADER) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });

    if (init?.method === "PUT") {
      return jsonResponse({}, 200);
    }

    return jsonResponse({
      content: btoa(csv),
      sha: "catalog-sha",
    });
  }) as typeof fetch;

  return calls;
}

function decodePutCatalogContent(calls: Array<{ init?: RequestInit }>) {
  const putCall = calls.find((call) => call.init?.method === "PUT");
  expect(putCall).toBeDefined();
  const body = JSON.parse(String(putCall?.init?.body));
  return atob(body.content);
}

describe("catalog csv validation", () => {
  test("rejects every catalog field containing CSV structural characters before network calls", async () => {
    for (const field of CATALOG_FIELDS) {
      for (const badCase of STRUCTURAL_CHAR_CASES) {
        const calls = installCatalogFetchMock();
        const entry = { ...BASE_ENTRY, [field]: badCase.value };

        await expect(
          updateCatalogEntryOnBranch({
            token: "token-123",
            owner: "octocat",
            repo: "astrobox-catalog",
            branch: "submit-demo",
            entry,
            intent: { mode: "create" },
          }),
        ).rejects.toThrow(new RegExp(String(field)));

        expect(calls, `${String(field)} with ${badCase.label}`).toHaveLength(0);
      }
    }
  });

  test("serializes free catalog paid type as an empty value", async () => {
    const calls = installCatalogFetchMock();

    await updateCatalogEntryOnBranch({
      token: "token-123",
      owner: "octocat",
      repo: "astrobox-catalog",
      branch: "submit-demo",
      entry: { ...BASE_ENTRY, paid_type: "free" },
      intent: { mode: "create" },
    });

    const updatedCsv = decodePutCatalogContent(calls);

    expect(updatedCsv).toContain(
      "demo,Demo Resource,quick_app,octocat,astrobox-resource-demo,abcdef1,media/icon.png,media/cover.png,utility;demo,vendor-a;vendor-b,device-a;device-b,",
    );
    expect(updatedCsv).not.toContain("device-a;device-b,free");
  });

  test("rejects creating an occupied ID with the resource name", async () => {
    installCatalogFetchMock(
      `${CATALOG_HEADER}\n${Object.values(BASE_ENTRY).join(",")}`,
    );

    await expect(
      updateCatalogEntryOnBranch({
        token: "token-123",
        owner: "octocat",
        repo: "astrobox-catalog",
        branch: "submit-demo",
        entry: BASE_ENTRY,
        intent: { mode: "create" },
      }),
    ).rejects.toThrow("Demo Resource");
  });

  test("renames an existing ID without leaving the old row", async () => {
    const calls = installCatalogFetchMock(
      `${CATALOG_HEADER}\n${Object.values(BASE_ENTRY).join(",")}`,
    );

    await updateCatalogEntryOnBranch({
      token: "token-123",
      owner: "octocat",
      repo: "astrobox-catalog",
      branch: "submit-demo",
      entry: { ...BASE_ENTRY, id: "renamed" },
      intent: { mode: "edit", originalId: BASE_ENTRY.id },
    });

    const updatedCsv = decodePutCatalogContent(calls);
    expect(updatedCsv).toContain("renamed,Demo Resource");
    expect(updatedCsv).not.toContain("\ndemo,Demo Resource");
  });
});

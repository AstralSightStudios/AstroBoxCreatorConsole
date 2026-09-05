import { describe, expect, test } from "bun:test";
import {
  buildClientInfo,
  buildCreateSubmissionRequest,
  buildSubmissionCsv,
  buildSubmissionPath,
  buildSubmissionRequest,
  canonicalCatalogEntryDigest,
  hasSubmissionFiles,
  parseSubmissionCsv,
  parseSubmissionRequestJson,
} from "../../app/logic/publish/submission-protocol";
import type { CatalogEntry } from "../../app/logic/publish/catalog";

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

describe("submission protocol", () => {
  test("builds lower-case safe submission path", () => {
    expect(buildSubmissionPath("Alice", "AstroBox-Resource-Demo")).toBe(
      "tmp/alice/astrobox-resource-demo",
    );
  });

  test("rejects path traversal segments", () => {
    expect(() => buildSubmissionPath("../Alice", "repo")).toThrow();
    expect(() => buildSubmissionPath("alice", "repo/../x")).toThrow();
  });

  test("detects new-flow files in a PR", () => {
    expect(
      hasSubmissionFiles([
        { filename: "index_v2.csv" },
        { filename: "tmp/alice/resource-repo/resource.csv" },
      ]),
    ).toBe(true);
    expect(hasSubmissionFiles([{ filename: "index_v2.csv" }])).toBe(false);
    expect(hasSubmissionFiles([{ filename: "tmp/alice/resource.csv" }])).toBe(false);
  });

  test("parses exact two-row submission CSV", () => {
    const csv = buildSubmissionCsv(ENTRY);
    const parsed = parseSubmissionCsv(csv);
    expect(parsed.id).toBe("demo");
    expect(parsed.repo_owner).toBe("OctoCat");
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv.split("\n")[1].split(",")).toHaveLength(12);
  });

  test("rejects extra submission CSV rows", () => {
    const csv = `${buildSubmissionCsv(ENTRY)}\nother,row`;
    expect(() => parseSubmissionCsv(csv)).toThrow();
  });

  test("parses create and edit request JSON", () => {
    const create = parseSubmissionRequestJson(
      buildSubmissionRequest({
        schema_version: 1,
        mode: "create",
        original_id: null,
        base_entry_digest: null,
        base_catalog_commit: null,
        client: null,
      }),
    );
    expect(create.mode).toBe("create");

    const edit = parseSubmissionRequestJson(
      buildSubmissionRequest({
        schema_version: 1,
        mode: "edit",
        original_id: "old-id",
        base_entry_digest: "digest",
        base_catalog_commit: "commit",
        client: null,
      }),
    );
    expect(edit).toMatchObject({
      mode: "edit",
      original_id: "old-id",
      base_entry_digest: "digest",
      base_catalog_commit: "commit",
    });
  });

  test("preserves client info through build/parse round-trip", () => {
    const client = {
      version: "0.3.0",
      git_commit_hash: "fd3dc67",
      build_time: "2026-09-05T19:03:12+08:00",
      build_user: "root",
    };
    const request = parseSubmissionRequestJson(
      buildSubmissionRequest({
        schema_version: 1,
        mode: "create",
        original_id: null,
        base_entry_digest: null,
        base_catalog_commit: null,
        client,
      }),
    );
    expect(request.client).toEqual(client);
  });

  test("parses legacy request.json without client as null", () => {
    const request = parseSubmissionRequestJson(
      JSON.stringify({
        schema_version: 1,
        mode: "create",
        original_id: null,
        base_entry_digest: null,
        base_catalog_commit: null,
      }),
    );
    expect(request.client).toBeNull();
  });

  test("degrades malformed client to unknown fields instead of throwing", () => {
    const request = parseSubmissionRequestJson(
      JSON.stringify({
        schema_version: 1,
        mode: "create",
        original_id: null,
        base_entry_digest: null,
        base_catalog_commit: null,
        client: { version: 42 },
      }),
    );
    expect(request.client).toEqual({
      version: "unknown",
      git_commit_hash: "unknown",
      build_time: "unknown",
      build_user: "unknown",
    });
  });

  test("builds request with null client outside Tauri runtime", async () => {
    const create = await buildCreateSubmissionRequest("upstream-head");
    expect(create.client).toBeNull();
    expect(create.base_catalog_commit).toBe("upstream-head");

    const edit = await buildCreateSubmissionRequest(null);
    expect(edit.client).toBeNull();
    expect(edit.base_catalog_commit).toBeNull();
  });

  test("buildClientInfo returns null outside Tauri runtime", async () => {
    expect(await buildClientInfo()).toBeNull();
  });

  test("produces deterministic canonical digest", async () => {
    const first = await canonicalCatalogEntryDigest(ENTRY);
    const second = await canonicalCatalogEntryDigest({ ...ENTRY });
    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });
});

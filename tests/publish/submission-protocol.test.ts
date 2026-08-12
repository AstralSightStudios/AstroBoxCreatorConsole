import { describe, expect, test } from "bun:test";
import {
  buildSubmissionCsv,
  buildSubmissionPath,
  buildSubmissionRequest,
  canonicalCatalogEntryDigest,
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

  test("parses exact two-row submission CSV", () => {
    const csv = buildSubmissionCsv(ENTRY);
    const parsed = parseSubmissionCsv(csv);
    expect(parsed.id).toBe("demo");
    expect(parsed.repo_owner).toBe("OctoCat");
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
      }),
    );
    expect(edit).toMatchObject({
      mode: "edit",
      original_id: "old-id",
      base_entry_digest: "digest",
      base_catalog_commit: "commit",
    });
  });

  test("produces deterministic canonical digest", async () => {
    const first = await canonicalCatalogEntryDigest(ENTRY);
    const second = await canonicalCatalogEntryDigest({ ...ENTRY });
    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });
});

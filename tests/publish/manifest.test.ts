import { describe, expect, test } from "bun:test";
import { buildManifest } from "../../app/logic/publish/manifest";

describe("manifest resource types", () => {
  test("keeps canopus and its ordinary resource ID", () => {
    const result = buildManifest({
      itemId: "module.example",
      itemName: "Example module",
      description: "A canopus module",
      resourceType: "canopus",
      previews: [],
      icon: null,
      cover: null,
      usePreviewAsCover: false,
      coverPreviewId: null,
      authors: [],
      links: [],
      downloads: [],
      trialDownloads: [],
      ext: {},
      enableAstroBoxCreatorFeatures: false,
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.item).toMatchObject({
      id: "module.example",
      restype: "canopus",
    });
  });
});

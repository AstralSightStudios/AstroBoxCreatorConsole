import { describe, expect, test } from "bun:test";
import {
  buildManifest,
  normalizeBundledResources,
} from "../../app/logic/publish/manifest";

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

describe("manifest ext.bundledResources", () => {
  const baseInput = {
    itemId: "canopus_bluetoothaudio",
    itemName: "Canopus 蓝牙音频扩展模块",
    description: "A canopus module",
    resourceType: "canopus" as const,
    previews: [],
    icon: null,
    cover: null,
    usePreviewAsCover: false,
    coverPreviewId: null,
    authors: [],
    links: [],
    downloads: [],
    trialDownloads: [],
    enableAstroBoxCreatorFeatures: false,
  };

  test("writes required bundled resources into ext", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [
        { type: "resource", id: "com.canopus.lyraimport" },
        { type: "quick_app", id: "com.example.player" },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.bundledResources).toEqual({
      required: [
        { type: "resource", id: "com.canopus.lyraimport" },
        { type: "quick_app", id: "com.example.player" },
      ],
    });
  });

  test("removes bundledResources when empty, even if present in custom ext", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [],
      ext: {
        bundledResources: {
          required: [{ type: "resource", id: "stale.id" }],
        },
        customField: "keep-me",
      },
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.bundledResources).toBeUndefined();
    expect(manifest.ext.customField).toBe("keep-me");
  });

  test("structured input wins over stale custom ext entries", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [{ type: "resource", id: "fresh.id" }],
      ext: {
        bundledResources: {
          required: [{ type: "resource", id: "stale.id" }],
        },
      },
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.bundledResources).toEqual({
      required: [{ type: "resource", id: "fresh.id" }],
    });
  });

  test("keeps other structured ext fields untouched", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [{ type: "resource", id: "dep" }],
      trialDownloads: [
        {
          platformId: "xmb10p",
          version: "1.0.0",
          path: "downloads/trial/demo.bin",
          file: new File([], "demo.bin"),
        },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.trialDownloads).toEqual({
      xmb10p: { version: "1.0.0", file_name: "downloads/trial/demo.bin" },
    });
    expect(manifest.ext.bundledResources).toEqual({
      required: [{ type: "resource", id: "dep" }],
    });
  });
});

describe("normalizeBundledResources", () => {
  test("parses ext shape with required array", () => {
    expect(
      normalizeBundledResources({
        required: [
          { type: "resource", id: " a.id " },
          { id: "b.id" },
          { type: "", id: "" },
        ],
      }),
    ).toEqual([
      { type: "resource", id: "a.id" },
      { type: "resource", id: "b.id" },
    ]);
  });

  test("accepts a bare array and dedupes ids", () => {
    expect(
      normalizeBundledResources([
        { type: "canopus", id: "dup" },
        { type: "watchface", id: "dup" },
        "garbage",
        null,
      ]),
    ).toEqual([{ type: "canopus", id: "dup" }]);
  });

  test("returns empty for invalid input", () => {
    expect(normalizeBundledResources(undefined)).toEqual([]);
    expect(normalizeBundledResources(null)).toEqual([]);
    expect(normalizeBundledResources({ required: "nope" })).toEqual([]);
  });
});

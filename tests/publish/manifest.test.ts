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

  test("writes required and recommend bundled entries into ext", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [
        { mode: "required", type: "resource", id: "com.canopus.lyraimport" },
        { mode: "required", type: "plugin", id: "Lyra音乐导入器", name: "Lyra音乐导入器" },
        { mode: "recommend", type: "resource", id: "com.example.player" },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.bundledResources).toEqual({
      required: [
        { type: "resource", id: "com.canopus.lyraimport" },
        { type: "plugin", name: "Lyra音乐导入器" },
      ],
      recommend: [{ type: "resource", id: "com.example.player" }],
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
      bundledResources: [{ mode: "recommend", type: "resource", id: "fresh.id" }],
      ext: {
        bundledResources: {
          required: [{ type: "resource", id: "stale.id" }],
        },
      },
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.bundledResources).toEqual({
      recommend: [{ type: "resource", id: "fresh.id" }],
    });
  });

  test("keeps other structured ext fields untouched", () => {
    const result = buildManifest({
      ...baseInput,
      bundledResources: [{ mode: "required", type: "plugin", id: "dep" }],
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
      required: [{ type: "plugin", name: "dep" }],
    });
  });
});

describe("normalizeBundledResources", () => {
  test("parses required and recommend arrays with modes", () => {
    expect(
      normalizeBundledResources({
        required: [
          { type: "resource", id: " a.id " },
          { id: "b.id" },
          { type: "", id: "" },
        ],
        recommend: [{ type: "plugin", name: "Lyra音乐导入器" }],
      }),
    ).toEqual([
      { mode: "required", type: "resource", id: "a.id" },
      { mode: "required", type: "resource", id: "b.id" },
      { mode: "recommend", type: "plugin", id: "Lyra音乐导入器", name: "Lyra音乐导入器" },
    ]);
  });

  test("rejects bare arrays and dedupes ids across groups", () => {
    expect(
      normalizeBundledResources([{ type: "resource", id: "dup" }]),
    ).toEqual([]);
    expect(
      normalizeBundledResources({
        required: [{ id: "dup" }],
        recommend: [{ id: "dup" }],
      }),
    ).toEqual([{ mode: "required", type: "resource", id: "dup" }]);
  });

  test("coerces unknown types to resource", () => {
    expect(
      normalizeBundledResources({ recommend: [{ type: "whatever", id: "x" }] }),
    ).toEqual([{ mode: "recommend", type: "resource", id: "x" }]);
  });

  test("returns empty for invalid input", () => {
    expect(normalizeBundledResources(undefined)).toEqual([]);
    expect(normalizeBundledResources(null)).toEqual([]);
    expect(normalizeBundledResources({ required: "nope" })).toEqual([]);
  });
});

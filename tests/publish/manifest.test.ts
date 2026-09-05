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
          pathOverride: "downloads/trial/demo.bin",
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

describe("manifest downloads updatelogs", () => {
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

  test("writes per-download update logs into manifest.downloads", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        {
          platformId: "m2345b1",
          version: "1.2.0",
          pathOverride: "downloads/lyra.bin",
          file: new File([], "lyra.bin"),
          updatelogs: [
            { version: "1.2.0", content: "修复若干问题\n新增离线解析" },
            { version: "1.1.0", content: "首次发布" },
          ],
        },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.m2345b1).toEqual({
      version: "1.2.0",
      file_name: "downloads/lyra.bin",
      updatelogs: [
        { version: "1.2.0", content: "修复若干问题\n新增离线解析" },
        { version: "1.1.0", content: "首次发布" },
      ],
    });
  });

  test("trims entries and omits updatelogs when empty", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        {
          platformId: "xmb10p",
          version: "1.0.0",
          pathOverride: "downloads/a.bin",
          file: new File([], "a.bin"),
          updatelogs: [
            { version: " ", content: "" },
            { version: "1.0.0", content: "  首个版本  " },
          ],
        },
        {
          platformId: "xmb10",
          version: "1.0.0",
          pathOverride: "downloads/b.bin",
          file: new File([], "b.bin"),
          updatelogs: [],
        },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb10p).toEqual({
      version: "1.0.0",
      file_name: "downloads/a.bin",
      updatelogs: [{ version: "1.0.0", content: "首个版本" }],
    });
    expect(manifest.downloads.xmb10).toEqual({
      version: "1.0.0",
      file_name: "downloads/b.bin",
    });
  });

  test("writes update logs into ext.trialDownloads", () => {
    const result = buildManifest({
      ...baseInput,
      trialDownloads: [
        {
          platformId: "xmb10p",
          version: "0.9.0",
          pathOverride: "downloads/trial/demo.bin",
          file: new File([], "demo.bin"),
          updatelogs: [{ version: "0.9.0", content: "体验版" }],
        },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.ext.trialDownloads).toEqual({
      xmb10p: {
        version: "0.9.0",
        file_name: "downloads/trial/demo.bin",
        updatelogs: [{ version: "0.9.0", content: "体验版" }],
      },
    });
  });

  test("appends platform id before extension for default download paths", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: new File([], "app.rpk") },
        { platformId: "xmws4", version: "1.0.0", file: new File([], "app.rpk") },
      ],
      trialDownloads: [
        { platformId: "xmb9", version: "1.0.0", file: new File([], "app.rpk") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app-xmb9.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app-xmws4.rpk");
    expect(manifest.ext.trialDownloads.xmb9.file_name).toBe(
      "downloads/trial/app-xmb9.rpk",
    );
  });

  test("appends platform id after whole name when file has no extension", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: new File([], "package") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/package-xmb9");
  });

  test("writes numeric versionCode and omits it when invalid", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        {
          platformId: "m2345b1",
          version: "26.1.3",
          pathOverride: "downloads/lyra.bin",
          file: new File([], "lyra.bin"),
          versionCode: 2601003,
        },
        {
          platformId: "xmb10p",
          version: "1.0.0",
          pathOverride: "downloads/a.bin",
          file: new File([], "a.bin"),
          versionCode: 0,
        },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.m2345b1).toEqual({
      version: "26.1.3",
      file_name: "downloads/lyra.bin",
      versionCode: 2601003,
    });
    expect(manifest.downloads.xmb10p).toEqual({
      version: "1.0.0",
      file_name: "downloads/a.bin",
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

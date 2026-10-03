import { describe, expect, test } from "bun:test";
import {
  buildManifest,
  normalizeBundledResources,
} from "../../app/logic/publish/manifest";

/** 构造与发布页一致的上传项：{ name, file }。 */
function uploadInput(name: string, content: string) {
  return { name, file: new File([content], name) };
}

/** 带内容哈希的下载行，用于多台设备共用同一份包体。 */
function hashedRow(platformId: string, content: string) {
  return {
    platformId,
    version: "1.0.0",
    file: uploadInput("app.rpk", content),
    packageHash: `hash-${content}`,
  };
}

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

  test("writes required and recommended bundled entries into ext", () => {
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
    // AstroBox-NG 只认 id（插件名同样写在 id）与 recommended 键。
    expect(manifest.ext.bundledResources).toEqual({
      required: [
        { type: "resource", id: "com.canopus.lyraimport" },
        { type: "plugin", id: "Lyra音乐导入器" },
      ],
      recommended: [{ type: "resource", id: "com.example.player" }],
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
      recommended: [{ type: "resource", id: "fresh.id" }],
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
      required: [{ type: "plugin", id: "dep" }],
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

  test("keeps the first package name and suffixes later same-named packages", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: uploadInput("app.rpk", "a") },
        { platformId: "xmws4", version: "1.0.0", file: uploadInput("app.rpk", "b") },
      ],
      trialDownloads: [
        { platformId: "xmb9", version: "1.0.0", file: uploadInput("app.rpk", "a") },
        { platformId: "xmws4", version: "1.0.0", file: uploadInput("app.rpk", "b") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app-xmws4.rpk");
    expect(manifest.ext.trialDownloads.xmb9.file_name).toBe(
      "downloads/trial/app.rpk",
    );
    expect(manifest.ext.trialDownloads.xmws4.file_name).toBe(
      "downloads/trial/app-xmws4.rpk",
    );
  });

  test("shares one path when devices use the same package hash", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        hashedRow("xmb9", "same"),
        hashedRow("xmws4", "same"),
        hashedRow("m2345b1", "same"),
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.m2345b1.file_name).toBe("downloads/app.rpk");
    // 共用路径不代表跳过：每台设备仍要各自加密并提交密钥。
    expect(
      result.downloadAssets.map((asset) => [asset.platformId, asset.skipUpload]),
    ).toEqual([
      ["xmb9", undefined],
      ["xmws4", undefined],
      ["m2345b1", undefined],
    ]);
  });

  test("shares one path when devices reuse the same uploaded file object", () => {
    // 一键填充把同一个 UploadItem 实例写进所有行，此时没有 packageHash 可用。
    const shared = uploadInput("app.rpk", "same");
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: shared },
        { platformId: "xmws4", version: "1.0.0", file: shared },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app.rpk");
  });

  test("never merges same-named packages that share size and type", () => {
    // 没有哈希也没有同一对象时不得靠元数据猜内容，否则又会错误共用。
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: new File([], "app.rpk") },
        { platformId: "xmws4", version: "1.0.0", file: new File([], "app.rpk") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app-xmws4.rpk");
  });

  test("does not let a new package overwrite a path kept by another row", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        {
          platformId: "xmb9",
          version: "1.0.0",
          pathOverride: "downloads/app.rpk",
          file: uploadInput("app.rpk", "old"),
        },
        { platformId: "xmws4", version: "1.0.0", file: uploadInput("app.rpk", "new") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/app.rpk");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/app-xmws4.rpk");
  });

  test("appends platform id after whole name when file has no extension", () => {
    const result = buildManifest({
      ...baseInput,
      downloads: [
        { platformId: "xmb9", version: "1.0.0", file: uploadInput("package", "a") },
        { platformId: "xmws4", version: "1.0.0", file: uploadInput("package", "b") },
      ],
      ext: {},
    });

    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads.xmb9.file_name).toBe("downloads/package");
    expect(manifest.downloads.xmws4.file_name).toBe("downloads/package-xmws4");
  });

  test("writes numeric versionCode including 0 and omits invalid values", () => {
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
          version: "0.0.0",
          pathOverride: "downloads/a.bin",
          file: new File([], "a.bin"),
          versionCode: 0,
        },
        {
          platformId: "xmb9",
          version: "1.0.0",
          pathOverride: "downloads/b.bin",
          file: new File([], "b.bin"),
          versionCode: -1,
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
      version: "0.0.0",
      file_name: "downloads/a.bin",
      versionCode: 0,
    });
    expect(manifest.downloads.xmb9).toEqual({
      version: "1.0.0",
      file_name: "downloads/b.bin",
    });
  });
});

describe("normalizeBundledResources", () => {
  test("parses required and recommended arrays with modes", () => {
    expect(
      normalizeBundledResources({
        required: [
          { type: "resource", id: " a.id " },
          { id: "b.id" },
          { type: "", id: "" },
        ],
        recommended: [{ type: "plugin", id: "Lyra音乐导入器" }],
      }),
    ).toEqual([
      { mode: "required", type: "resource", id: "a.id" },
      { mode: "required", type: "resource", id: "b.id" },
      { mode: "recommend", type: "plugin", id: "Lyra音乐导入器", name: "Lyra音乐导入器" },
    ]);
  });

  test("falls back to the legacy recommend key and plugin name field", () => {
    expect(
      normalizeBundledResources({
        recommend: [{ type: "plugin", name: "Lyra音乐导入器" }],
      }),
    ).toEqual([
      { mode: "recommend", type: "plugin", id: "Lyra音乐导入器", name: "Lyra音乐导入器" },
    ]);
  });

  test("prefers recommended over the legacy recommend key", () => {
    expect(
      normalizeBundledResources({
        recommended: [{ type: "resource", id: "new.id" }],
        recommend: [{ type: "resource", id: "old.id" }],
      }),
    ).toEqual([{ mode: "recommend", type: "resource", id: "new.id" }]);
  });

  test("rejects bare arrays and dedupes ids across groups", () => {
    expect(
      normalizeBundledResources([{ type: "resource", id: "dup" }]),
    ).toEqual([]);
    expect(
      normalizeBundledResources({
        required: [{ id: "dup" }],
        recommended: [{ id: "dup" }],
      }),
    ).toEqual([{ mode: "required", type: "resource", id: "dup" }]);
  });

  test("coerces unknown types to resource", () => {
    expect(
      normalizeBundledResources({ recommended: [{ type: "whatever", id: "x" }] }),
    ).toEqual([{ mode: "recommend", type: "resource", id: "x" }]);
  });

  test("returns empty for invalid input", () => {
    expect(normalizeBundledResources(undefined)).toEqual([]);
    expect(normalizeBundledResources(null)).toEqual([]);
    expect(normalizeBundledResources({ required: "nope" })).toEqual([]);
  });
});

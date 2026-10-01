import { describe, expect, test } from "bun:test";
import {
  buildDownloadInputsFromManifest,
  extractCustomExt,
  isManifestExtObject,
  parseTagText,
} from "../../app/logic/publish/composer-utils";
import { restoreDownloadInput } from "../../app/logic/publish/draft-codec";

describe("composer utils: parseTagText", () => {
  test("splits on both half and full width separators and trims", () => {
    expect(parseTagText("表盘; 像素, 手表")).toEqual(["表盘", "像素", "手表"]);
    expect(parseTagText("a；b，c;d")).toEqual(["a", "b", "c", "d"]);
  });

  test("drops blank segments and handles empty input", () => {
    expect(parseTagText("  ;  , ;; ")).toEqual([]);
    expect(parseTagText("")).toEqual([]);
    expect(parseTagText("单个")).toEqual(["单个"]);
  });
});

describe("composer utils: extractCustomExt", () => {
  test("strips structured fields owned by dedicated form state", () => {
    expect(
      extractCustomExt({
        enableAstroBoxCreatorFeatures: true,
        trialDownloads: { watch: { version: "1.0", file_name: "a.bin" } },
        bundledResources: { required: [{ type: "resource", id: "x" }] },
        wallpaperGenerator: { configUrl: "https://example.com/w.json" },
        customField: "keep",
        anotherOne: 42,
      }),
    ).toEqual({ customField: "keep", anotherOne: 42 });
  });

  test("returns empty object for undefined and does not mutate input", () => {
    expect(extractCustomExt(undefined)).toEqual({});
    const source = { enableAstroBoxCreatorFeatures: true, keep: "yes" };
    extractCustomExt(source);
    expect(source).toEqual({ enableAstroBoxCreatorFeatures: true, keep: "yes" });
  });
});

describe("composer utils: isManifestExtObject", () => {
  test("accepts plain objects only", () => {
    expect(isManifestExtObject({})).toBe(true);
    expect(isManifestExtObject({ a: 1 })).toBe(true);
    expect(isManifestExtObject(null)).toBe(false);
    expect(isManifestExtObject(undefined)).toBe(false);
    expect(isManifestExtObject([])).toBe(false);
    expect(isManifestExtObject("x")).toBe(false);
  });
});

describe("composer utils: buildDownloadInputsFromManifest", () => {
  const base = { owner: "o", repo: "r", ref: "abc" };

  test("derives version, versionCode and encryption state per device", () => {
    const rows = buildDownloadInputsFromManifest({
      ...base,
      encryptedDeviceSet: new Set(["watch"]),
      downloads: {
        watch: { file_name: "downloads/watch/app.bin", version: "1.2", versionCode: 7 },
        band: { file_name: "downloads/band/app.bin", version: "2.0" },
      },
    });

    expect(rows).toHaveLength(2);
    const watch = rows.find((r) => r.platformId === "watch")!;
    const band = rows.find((r) => r.platformId === "band")!;

    expect(watch.encryptOnUpload).toBe(true);
    expect(watch.version).toBe("1.2");
    expect(watch.versionCode).toBe(7);
    expect(watch.versionLocked).toBe(true);
    expect(watch.versionSource).toBe("existing");
    expect(watch.previousVersion).toBe("1.2");
    expect(watch.previousVersionCode).toBe(7);
    expect(watch.existingFileName).toBe("downloads/watch/app.bin");
    expect(watch.file).not.toBeNull();

    expect(band.encryptOnUpload).toBe(false);
    expect(band.versionCode).toBeUndefined();
  });

  test("normalizes invalid versionCode and normalizes updatelogs", () => {
    const [row] = buildDownloadInputsFromManifest({
      ...base,
      downloads: {
        watch: {
          file_name: "a.bin",
          version: " 1.0 ",
          versionCode: Number.NaN,
          updatelogs: [
            { version: " 1.0 ", content: " fix " },
            { version: "", content: "" },
          ],
        },
      },
    });
    expect(row.versionCode).toBeUndefined();
    expect(row.previousVersionCode).toBeUndefined();
    expect(row.updatelogs).toEqual([{ version: "1.0", content: "fix" }]);
  });

  test("truncates fractional versionCode and tolerates missing entries", () => {
    const rows = buildDownloadInputsFromManifest({
      ...base,
      downloads: {
        watch: { file_name: "a.bin", version: "1", versionCode: 3.9 },
        empty: {},
      },
    });
    expect(rows[0].versionCode).toBe(3);
    const empty = rows.find((r) => r.platformId === "empty")!;
    expect(empty.file).toBeNull();
    expect(empty.existingFileName).toBe("");
    expect(empty.versionLocked).toBe(false);
    expect(empty.updatelogs).toBeUndefined();
  });

  test("returns empty array when downloads is missing", () => {
    expect(buildDownloadInputsFromManifest(base)).toEqual([]);
    expect(
      buildDownloadInputsFromManifest({ ...base, downloads: undefined }),
    ).toEqual([]);
  });
});

describe("draft codec: restoreDownloadInput", () => {
  test("rebuilds a File from stored bytes", () => {
    const restored = restoreDownloadInput({
      uid: "u1",
      platformId: "watch",
      version: "1.0",
      file: {
        id: "f1",
        name: "app.bin",
        type: "application/octet-stream",
        size: 3,
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
    });
    expect(restored.file?.name).toBe("app.bin");
    expect(restored.file?.file.size).toBe(3);
    // 还原的是新上传文件，不应残留仓库文件名
    expect(restored.existingFileName).toBeUndefined();
  });

  test("nulls out file for legacy drafts holding unreadable File objects", () => {
    const restored = restoreDownloadInput({
      uid: "u2",
      platformId: "watch",
      version: "1.0",
      file: null,
    });
    expect(restored.file).toBeNull();
    expect(restored.uid).toBe("u2");
  });

  test("nulls out file when stored bytes are empty", () => {
    const restored = restoreDownloadInput({
      uid: "u3",
      platformId: "watch",
      version: "1.0",
      file: {
        id: "f3",
        name: "app.bin",
        type: "application/octet-stream",
        size: 0,
        bytes: new ArrayBuffer(0),
      },
    });
    expect(restored.file).toBeNull();
  });
});
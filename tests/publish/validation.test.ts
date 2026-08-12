import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  normalizeLinkUrl,
  readRpkPackage,
  validateLink,
  validatePublish,
  validateRpkPackage,
} from "../../app/logic/publish/validation";

const image = { file: new Blob(), width: 100, height: 100 };
const coverImage = { file: new Blob(), width: 150, height: 100 };
const validInput = {
  itemId: "com.example.app",
  itemName: "Example",
  previews: [{ ...coverImage, id: "preview" }],
  icon: image,
  cover: null,
  usePreviewAsCover: true,
  coverPreviewId: "preview",
  downloads: [{ platformId: "device", version: "1.0", file: image }],
  trialDownloads: [],
  links: [],
};

function rpk(entries: Record<string, string>) {
  return new Blob([
    zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))),
  ]);
}

describe("publish validation", () => {
  test("accepts complete input and rejects required fields and rows", () => {
    expect(validatePublish(validInput).errors).toEqual([]);
    const result = validatePublish({
      ...validInput,
      itemId: "",
      itemName: "",
      previews: [],
      icon: { ...image, width: 100, height: 90 },
      downloads: [{ platformId: "", version: "", file: null }],
      trialDownloads: [{ platformId: "device", version: "", file: null }],
    });
    expect(result.errors.join(" ")).toContain("资源名称");
    expect(result.errors.join(" ")).toContain("资源 ID");
    expect(result.errors.join(" ")).toContain("正方形");
    expect(result.errors.join(" ")).toContain("预览图");
    expect(result.errors.join(" ")).toContain("正式下载第 1 行");
    expect(result.errors.join(" ")).toContain("试用下载第 1 行");
  });

  test("rejects cover with wrong aspect ratio or over 1MB", () => {
    const wrongRatioPreview = validatePublish({
      ...validInput,
      previews: [{ ...image, id: "preview" }],
    });
    expect(wrongRatioPreview.errors.join(" ")).toContain("3:2");

    const wrongRatioUpload = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: image,
    });
    expect(wrongRatioUpload.errors.join(" ")).toContain("3:2");

    const oversized = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: { ...coverImage, file: new Blob([new Uint8Array(1024 * 1024 + 1)]) },
    });
    expect(oversized.errors.join(" ")).toContain("1MB");

    const unreadable = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: { file: new Blob() },
    });
    expect(unreadable.errors.join(" ")).toContain("无法读取");
  });

  test("reports invalid links without blocking publishing", () => {
    expect(validateLink({ icon: "", title: "", url: "" })).toBeNull();
    expect(validateLink({ icon: "Link", title: "", url: "" })).toContain("标题、网址");
    expect(validateLink({ icon: "", title: "Site", url: "https://example.com" })).toContain("图标");
    expect(validateLink({ icon: "Link", title: "Site", url: "http://example.com" })).toContain("HTTPS");
    expect(validateLink({ icon: "Link", title: "Site", url: "https://example.com" })).toBeNull();
    expect(validateLink({ icon: "Link", title: "Site", url: "`https://example.com`" })).toBeNull();
    expect(normalizeLinkUrl("`https://example.com`")).toBe("https://example.com");
    const result = validatePublish({
      ...validInput,
      links: [{ icon: "Link", title: "Site", url: "http://example.com" }],
    });
    expect(result.errors).toEqual([]);
    expect(result.linkErrors[0]).toContain("HTTPS");
  });
});

describe("RPK validation", () => {
  test("reads nested manifest package", async () => {
    const file = rpk({ "nested/manifest.json": JSON.stringify({ package: "com.example.app" }) });
    expect(await readRpkPackage(file)).toBe("com.example.app");
    await expect(validateRpkPackage(file, "com.example.app")).resolves.toBeUndefined();
  });

  test("rejects missing manifest", async () => {
    await expect(validateRpkPackage(rpk({ "other.json": "{}" }), "com.example.app")).rejects.toThrow("缺少 manifest.json");
  });

  test("rejects mismatched package", async () => {
    const file = rpk({ "manifest.json": JSON.stringify({ package: "com.other.app" }) });
    await expect(validateRpkPackage(file, "com.example.app")).rejects.toThrow(
      "无法使用自动检查更新",
    );
  });
});

import { describe, expect, test } from "bun:test";
import {
  countIndependentPreviewUrls,
  countIndependentPreviews,
  mediaReuseKey,
  previewReusesCover,
} from "../../app/logic/publish/preview-reuse";

function imageFile(name: string, size = 16, type = "image/png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("preview reuse: uploaded files", () => {
  test("与封面文件名、大小、类型都相同的预览图视为复用封面", () => {
    const cover = { name: "cover.png", file: imageFile("cover.png") };
    const preview = { name: "cover.png", file: imageFile("cover.png") };
    expect(previewReusesCover(preview, cover)).toBe(true);
    expect(countIndependentPreviews([preview], cover)).toEqual({
      count: 0,
      reusedCoverCount: 1,
    });
  });

  test("内容不同（大小不同）的预览图正常计数", () => {
    const cover = { name: "cover.png", file: imageFile("cover.png", 16) };
    const preview = { name: "cover.png", file: imageFile("cover.png", 32) };
    expect(previewReusesCover(preview, cover)).toBe(false);
    expect(countIndependentPreviews([preview], cover)).toEqual({
      count: 1,
      reusedCoverCount: 0,
    });
  });

  test("同一张预览图重复添加只算一张", () => {
    const file = imageFile("shot.png");
    const previews = [
      { name: "shot.png", file },
      { name: "shot.png", file },
    ];
    expect(countIndependentPreviews(previews, null)).toEqual({
      count: 1,
      reusedCoverCount: 0,
    });
  });

  test("无法判定身份的素材不参与去重", () => {
    expect(mediaReuseKey({ file: new Blob() })).toBeNull();
    expect(countIndependentPreviews([{ file: new Blob() }, { file: new Blob() }], null)).toEqual({
      count: 2,
      reusedCoverCount: 0,
    });
  });
});

describe("preview reuse: existing repo files", () => {
  test("编辑模式同路径的预览图复用封面", () => {
    const cover = {
      name: "cover.png",
      file: imageFile("cover.png"),
      pathOverride: "media/cover.png",
      skipUpload: true,
    };
    const preview = {
      name: "cover.png",
      file: imageFile("cover.png"),
      pathOverride: "media/cover.png",
      skipUpload: true,
    };
    expect(previewReusesCover(preview, cover)).toBe(true);
    expect(countIndependentPreviews([preview], cover)).toEqual({
      count: 0,
      reusedCoverCount: 1,
    });
  });

  test("不同仓库路径即使同名也算独立预览图", () => {
    const cover = {
      name: "shot.png",
      pathOverride: "media/cover/shot.png",
      skipUpload: true,
    };
    const preview = {
      name: "shot.png",
      pathOverride: "media/preview/shot.png",
      skipUpload: true,
    };
    expect(previewReusesCover(preview, cover)).toBe(false);
  });
});

describe("preview reuse: manifest urls", () => {
  test("与封面 URL 相同的预览图不计入，空 URL 与重复 URL 也不计入", () => {
    const coverUrl = "https://raw.example.com/media/cover.png";
    const urls = [coverUrl, "", "https://raw.example.com/media/a.png", "https://raw.example.com/media/a.png"];
    expect(countIndependentPreviewUrls(urls, coverUrl)).toEqual({
      count: 1,
      reusedCoverCount: 1,
    });
  });

  test("没有封面时不排除任何有效 URL", () => {
    expect(
      countIndependentPreviewUrls(["a", "b", " "], ""),
    ).toEqual({ count: 2, reusedCoverCount: 0 });
  });
});

import { describe, expect, test } from "bun:test";
import {
  BANNED_IMAGE_EXTENSIONS,
  COVER_COMPRESS_TARGET_BYTES,
  COVER_MAX_BYTES,
  ICON_COMPRESS_TARGET_BYTES,
  ICON_MAX_DIMENSION,
  applyPublishedBaseline,
  checkCoverFileSize,
  checkCoverRatio,
  checkIconDimensions,
  checkImageFormat,
  hasExactCoverRatio,
  isBannedImageName,
  isSvgContent,
  rowHasPackage,
  rowsMissingVersionCode,
  rowsWithIdentityMismatch,
  rowsWithNonIncrementedVersionCode,
} from "../../app/logic/publish/pre-publish-checks";

describe("pre-publish checks: checkIconDimensions", () => {
  test("accepts a square icon within the size limit", () => {
    expect(checkIconDimensions({ width: 256, height: 256 })).toBeNull();
    expect(checkIconDimensions({ width: ICON_MAX_DIMENSION, height: ICON_MAX_DIMENSION })).toBeNull();
  });

  test("rejects non-square icons", () => {
    expect(checkIconDimensions({ width: 100, height: 90 })).toContain("正方形");
    expect(checkIconDimensions({ width: 300, height: 150 })).toContain("正方形");
  });

  test("rejects icons larger than the dimension limit", () => {
    expect(
      checkIconDimensions({ width: ICON_MAX_DIMENSION + 1, height: ICON_MAX_DIMENSION + 1 }),
    ).toContain("过大");
    expect(checkIconDimensions({ width: 600, height: 600 })).toContain("过大");
  });

  test("reports unreadable icons when a dimension is missing", () => {
    expect(checkIconDimensions({ width: undefined, height: undefined })).toContain("无法读取");
    expect(checkIconDimensions({ width: 100, height: undefined })).toContain("无法读取");
    expect(checkIconDimensions({ width: 0, height: 0 })).toContain("无法读取");
  });

  test("reports ratio before size when an icon violates both", () => {
    // 非正方形优先报比例，避免同时命中两条规则时提示含糊
    expect(checkIconDimensions({ width: 800, height: 400 })).toContain("正方形");
    // 正方形但超限，只命中尺寸规则
    expect(checkIconDimensions({ width: 800, height: 800 })).toContain("过大");
  });
});

describe("pre-publish checks: checkCoverRatio", () => {
  test("accepts only exact 3:2", () => {
    expect(checkCoverRatio({ width: 150, height: 100 })).toBeNull();
    expect(checkCoverRatio({ width: 1200, height: 800 })).toBeNull();
    expect(checkCoverRatio({ width: 3000, height: 2000 })).toBeNull();
    // 最小整数解也要成立：判定只看比值，不看绝对尺寸。
    expect(checkCoverRatio({ width: 3, height: 2 })).toBeNull();
  });

  test("rejects off-by-one pixels: the rule has zero tolerance", () => {
    // 这三组在旧的 ±0.02 容差下全部通过，收紧容差后必须被拒。
    expect(checkCoverRatio({ width: 151, height: 100 })).toContain("3:2");
    expect(checkCoverRatio({ width: 149, height: 100 })).toContain("3:2");
    expect(checkCoverRatio({ width: 150, height: 101 })).toContain("3:2");
  });

  test("rejects camera-rounded sizes that merely approximate 3:2", () => {
    // 2560×1707 比值 1.4997，落在旧容差内；相机/导出工具凑整的尺寸一律拒绝。
    expect(checkCoverRatio({ width: 2560, height: 1707 })).toContain("3:2");
    expect(checkCoverRatio({ width: 2048, height: 1365 })).toContain("3:2");
  });

  test("rejects ratios outside 3:2 and reports the actual pixels", () => {
    const err = checkCoverRatio({ width: 100, height: 100 });
    expect(err).toContain("3:2");
    expect(err).toContain("1.00");
    expect(err).toContain("100×100");
    expect(checkCoverRatio({ width: 200, height: 100 })).toContain("2.00");
  });

  test("rejects a square cover and unreadable covers", () => {
    expect(checkCoverRatio({ width: 200, height: 200 })).toContain("3:2");
    expect(checkCoverRatio({ width: undefined, height: 100 })).toContain("无法读取");
  });
});

describe("pre-publish checks: checkCoverFileSize", () => {
  test("accepts files at or below the limit", () => {
    expect(checkCoverFileSize(COVER_MAX_BYTES)).toBeNull();
    expect(checkCoverFileSize(COVER_MAX_BYTES - 1)).toBeNull();
    expect(checkCoverFileSize(0)).toBeNull();
  });

  test("rejects files above the limit", () => {
    const message = checkCoverFileSize(COVER_MAX_BYTES + 1);
    expect(message).toContain("600 KB");
    // 文案里的门槛与当前体积都实算：刚超 1 字节也要能看出比上限大，
    // 不能因为四舍五入把两项显示成同一个数。
    expect(message).toContain("601 KB");
    expect(message).not.toContain("1MB");
  });

  test("reports the real limit and size for oversized covers", () => {
    // 2MB 的封面：门槛仍显示 600KB，当前体积按 MB 显示，不再自称「1MB 以内都行」。
    const message = checkCoverFileSize(2 * 1024 * 1024);
    expect(message).toContain("600 KB");
    expect(message).toContain("2.00 MB");
  });
});

describe("pre-publish checks: constants stay consistent", () => {
  test("cover compression target equals the cover size limit", () => {
    // 封面压缩目标与体积上限必须是同一个值，否则「压缩后仍超标」分支永远不成立
    expect(COVER_COMPRESS_TARGET_BYTES).toBe(COVER_MAX_BYTES);
  });

  test("hasExactCoverRatio never contradicts checkCoverRatio", () => {
    // 发布页实时红框与审核页都走 hasExactCoverRatio；它一旦与提交校验分叉，
    // 就会出现「红框没亮却被拦住」或反之。逐组尺寸钉死这份一致性。
    const samples: Array<[number, number]> = [
      [150, 100],
      [151, 100],
      [149, 100],
      [150, 101],
      [1200, 800],
      [3000, 2000],
      [2560, 1707],
      [2048, 1365],
      [100, 100],
      [200, 100],
    ];
    for (const [width, height] of samples) {
      expect(hasExactCoverRatio(width, height)).toBe(
        checkCoverRatio({ width, height }) === null,
      );
    }
  });

  test("icon compression target is well below the icon dimension budget", () => {
    expect(ICON_COMPRESS_TARGET_BYTES).toBeLessThan(COVER_MAX_BYTES);
    expect(ICON_COMPRESS_TARGET_BYTES).toBeGreaterThan(0);
  });
});

import type { DownloadInput } from "../../app/routes/resource/publish/components/types";

describe("pre-publish checks: SVG 禁用", () => {
  test("SVG 后缀一律命中，大小写与仓库路径都覆盖", () => {
    expect(BANNED_IMAGE_EXTENSIONS).toContain("svg");
    expect(isBannedImageName("icon.svg")).toBe(true);
    expect(isBannedImageName("ICON.SVG")).toBe(true);
    expect(isBannedImageName(" 封面.Svg  ")).toBe(true);
    // 审核侧传进来的是仓库路径，不是裸文件名
    expect(isBannedImageName("media/icon.svg")).toBe(true);
    expect(isBannedImageName("wallpaper/assets\\bg.svg")).toBe(true);
  });

  test("位图与其他资源文件不受影响", () => {
    for (const name of [
      "icon.png",
      "cover.JPEG",
      "preview 1.webp",
      "app.rpk",
      "wallpaper.json",
      "icon",
      "index_v2.csv",
      // 目录带点的路径不能被误判成 .svg
      "v1.2/icon",
      // 隐藏文件/无后缀名不参与判定
      ".svg",
    ]) {
      expect(isBannedImageName(name)).toBe(false);
      expect(checkImageFormat(name)).toBeNull();
    }
  });

  test("checkImageFormat 说明原因并给出替代格式", () => {
    const message = checkImageFormat("media/icon.svg");
    expect(message).toContain("SVG");
    expect(message).toContain("WebKit");
    expect(message).toContain("Chromium");
    expect(message).toContain("PNG");
    expect(message).toContain("JPEG");
  });

  test("内容嗅探识破改扩展名伪装的 SVG", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    // 改名成 .png 的 SVG：后缀判定挡不住，只有内容嗅探能认出来
    const disguised = encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(isBannedImageName("logo.png")).toBe(false);
    expect(isSvgContent(disguised)).toBe(true);

    // 带 BOM、前导空白、XML 声明的真实变体
    expect(isSvgContent(encode('﻿  \n<svg width="10"/>'))).toBe(true);
    expect(
      isSvgContent(encode('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="..."/>')),
    ).toBe(true);

    // 位图不得被误判
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(isSvgContent(PNG)).toBe(false);
    expect(isSvgContent(JPG)).toBe(false);
    // 其他 XML（不是 SVG）不误伤
    expect(isSvgContent(encode('<?xml version="1.0"?><rss><item/></rss>'))).toBe(false);
    // 头部被截断到半个标签时不应判定为 SVG
    expect(isSvgContent(new Uint8Array([0x3c, 0x73]))).toBe(false);
  });
});

function row(partial: Partial<DownloadInput> & { uid: string }): DownloadInput {
  return {
    platformId: "watch",
    version: "1.0",
    file: null,
    ...partial,
  } as DownloadInput;
}

/** 带包体的新上传行 */
function withPackage(partial: Partial<DownloadInput> = {}): DownloadInput {
  return row({
    uid: "u",
    file: { name: "app.bin", file: new File([new Uint8Array([1])], "app.bin") },
    ...partial,
  });
}

describe("pre-publish checks: rowHasPackage", () => {
  test("treats a new file or an existing filename as packaged", () => {
    expect(rowHasPackage(withPackage())).toBe(true);
    expect(rowHasPackage(row({ uid: "u", existingFileName: "a.bin" }))).toBe(true);
    expect(rowHasPackage(row({ uid: "u", file: null }))).toBe(false);
    expect(rowHasPackage(row({ uid: "u", existingFileName: "" }))).toBe(false);
  });
});

describe("pre-publish checks: rowsMissingVersionCode", () => {
  test("flags packaged rows without versionCode", () => {
    const rows = [
      withPackage({ uid: "a" }),
      withPackage({ uid: "b", versionCode: 3 }),
      row({ uid: "c" }),
    ];
    expect(rowsMissingVersionCode(rows).map((r) => r.uid)).toEqual(["a"]);
  });

  test("flags packaged rows referencing existing repository files", () => {
    const rows = [
      row({ uid: "a", existingFileName: "old.bin" }),
      row({ uid: "b", existingFileName: "old.bin", versionCode: 1 }),
    ];
    expect(rowsMissingVersionCode(rows).map((r) => r.uid)).toEqual(["a"]);
  });

  test("treats versionCode 0 as filled, not missing", () => {
    const rows = [withPackage({ uid: "a", versionCode: 0 })];
    expect(rowsMissingVersionCode(rows)).toEqual([]);
  });
});

describe("pre-publish checks: rowsWithIdentityMismatch", () => {
  test("flags package rows whose identity differs from the resource id", () => {
    const rows = [
      row({ uid: "a", packageIdentityKind: "package", packageIdentity: "com.a" }),
      row({ uid: "b", packageIdentityKind: "package", packageIdentity: "com.b" }),
    ];
    expect(rowsWithIdentityMismatch(rows, "com.a").map((r) => r.uid)).toEqual(["b"]);
  });

  test("ignores watchface and dial identity kinds", () => {
    const rows = [
      row({ uid: "a", packageIdentityKind: "watchface-id", packageIdentity: "12345" }),
      row({ uid: "b", packageIdentityKind: "dial-id", packageIdentity: "999" }),
      row({ uid: "c", packageIdentityKind: undefined, packageIdentity: "zzz" }),
    ];
    expect(rowsWithIdentityMismatch(rows, "com.a")).toEqual([]);
  });

  test("returns nothing when resource id is blank", () => {
    const rows = [row({ uid: "a", packageIdentityKind: "package", packageIdentity: "x" })];
    expect(rowsWithIdentityMismatch(rows, "   ")).toEqual([]);
    expect(rowsWithIdentityMismatch(rows, "")).toEqual([]);
  });

  test("trims the resource id before comparing", () => {
    const rows = [row({ uid: "a", packageIdentityKind: "package", packageIdentity: "com.a" })];
    expect(rowsWithIdentityMismatch(rows, "  com.a  ")).toEqual([]);
  });
});

describe("pre-publish checks: rowsWithNonIncrementedVersionCode", () => {
  test("flags rows whose versionCode did not exceed the previous value", () => {
    const rows = [
      withPackage({ uid: "a", versionSource: "package", versionCode: 5, previousVersionCode: 5 }),
      withPackage({ uid: "b", versionSource: "package", versionCode: 4, previousVersionCode: 5 }),
      withPackage({ uid: "c", versionSource: "package", versionCode: 6, previousVersionCode: 5 }),
    ];
    expect(rowsWithNonIncrementedVersionCode(rows).map((r) => r.uid)).toEqual(["a", "b"]);
  });

  test("ignores rows derived from the existing manifest or without baseline", () => {
    const rows = [
      withPackage({ uid: "a", versionSource: "existing", versionCode: 1, previousVersionCode: 9 }),
      withPackage({ uid: "b", versionSource: "package", versionCode: 1 }),
      withPackage({ uid: "c", versionSource: "package", previousVersionCode: 9 }),
    ];
    expect(rowsWithNonIncrementedVersionCode(rows)).toEqual([]);
  });
});

describe("pre-publish checks: applyPublishedBaseline", () => {
  test("以已合入索引的值覆盖 PR 内未合入的基线，重复替换包体不再要求递增", () => {
    // PR 内已经提交过一次 versionCode 100（PR 分支上的值），
    // 但索引里线上仍是 90。这次换包体版本保持 100，必须放行——
    // 这正是修复前被误拦的场景（旧代码会拿 100 当基线，要求 >100）。
    const rows = [
      withPackage({
        uid: "a",
        versionSource: "package",
        versionCode: 100,
        previousVersion: "1.0.100",
        previousVersionCode: 100,
      }),
    ];
    const result = applyPublishedBaseline(rows, {
      watch: { version: "1.0.90", versionCode: 90 },
    });
    expect(result[0].previousVersionCode).toBe(90);
    expect(result[0].previousVersion).toBe("1.0.90");
    expect(rowsWithNonIncrementedVersionCode(result)).toEqual([]);
  });

  test("相对已合入版本回退仍会被拦下", () => {
    const rows = [
      withPackage({
        uid: "a",
        versionSource: "package",
        versionCode: 89,
        previousVersionCode: 100,
      }),
    ];
    const result = applyPublishedBaseline(rows, {
      watch: { version: "1.0.90", versionCode: 90 },
    });
    expect(rowsWithNonIncrementedVersionCode(result).map((r) => r.uid)).toEqual(["a"]);
  });

  test("索引里没有该设备时清空基线，不参与递增判定", () => {
    const rows = [
      withPackage({
        uid: "a",
        versionSource: "package",
        versionCode: 1,
        previousVersion: "1.0.100",
        previousVersionCode: 100,
      }),
    ];
    const result = applyPublishedBaseline(rows, { band: { versionCode: 90 } });
    expect(result[0].previousVersionCode).toBeUndefined();
    expect(result[0].previousVersion).toBeUndefined();
    expect(rowsWithNonIncrementedVersionCode(result)).toEqual([]);
  });

  test("首次发布（无任何已合入数据）时全部清空基线", () => {
    const rows = [
      withPackage({ uid: "a", versionSource: "package", versionCode: 1, previousVersionCode: 5 }),
    ];
    const result = applyPublishedBaseline(rows, undefined);
    expect(result[0].previousVersionCode).toBeUndefined();
    expect(rowsWithNonIncrementedVersionCode(result)).toEqual([]);
  });

  test("已发布条目缺 versionCode 时该行基线一并清空", () => {
    const rows = [
      withPackage({ uid: "a", versionSource: "package", versionCode: 1, previousVersionCode: 5 }),
    ];
    const result = applyPublishedBaseline(rows, { watch: { version: "1.0" } });
    expect(result[0].previousVersion).toBe("1.0");
    expect(result[0].previousVersionCode).toBeUndefined();
  });

  test("归一化小数 versionCode 且不触碰版本码本身与其余字段", () => {
    const rows = [
      withPackage({ uid: "a", versionSource: "package", versionCode: 100 }),
    ];
    const result = applyPublishedBaseline(rows, {
      watch: { version: "1.0.90", versionCode: 90.9 },
    });
    expect(result[0].previousVersionCode).toBe(90);
    expect(result[0].versionCode).toBe(100);
    expect(result[0].versionSource).toBe("package");
    expect(result[0].file).not.toBeNull();
  });
});

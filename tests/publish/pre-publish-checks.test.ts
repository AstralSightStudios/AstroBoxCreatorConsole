import { describe, expect, test } from "bun:test";
import {
  COVER_COMPRESS_TARGET_BYTES,
  COVER_MAX_BYTES,
  ICON_COMPRESS_TARGET_BYTES,
  ICON_MAX_DIMENSION,
  checkCoverFileSize,
  checkCoverRatio,
  checkIconDimensions,
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
  test("accepts 3:2 within tolerance", () => {
    expect(checkCoverRatio({ width: 150, height: 100 })).toBeNull();
    // 容差 ±0.02，即比值需落在 [1.48, 1.52] 附近。
    // 不测 1.52/1.48 这两个端点：浮点除法会让差值略大于 0.02，边界不稳定。
    expect(checkCoverRatio({ width: 151, height: 100 })).toBeNull();
    expect(checkCoverRatio({ width: 149, height: 100 })).toBeNull();
  });

  test("rejects ratios outside tolerance and reports the actual value", () => {
    const err = checkCoverRatio({ width: 100, height: 100 });
    expect(err).toContain("3:2");
    expect(err).toContain("1.00");
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
    expect(checkCoverFileSize(COVER_MAX_BYTES + 1)).toContain("1MB");
  });
});

describe("pre-publish checks: constants stay consistent", () => {
  test("cover compression target equals the cover size limit", () => {
    // 封面压缩目标与体积上限必须是同一个值，否则「压缩后仍超标」分支永远不成立
    expect(COVER_COMPRESS_TARGET_BYTES).toBe(COVER_MAX_BYTES);
  });

  test("icon compression target is well below the icon dimension budget", () => {
    expect(ICON_COMPRESS_TARGET_BYTES).toBeLessThan(COVER_MAX_BYTES);
    expect(ICON_COMPRESS_TARGET_BYTES).toBeGreaterThan(0);
  });
});

import type { DownloadInput } from "../../app/routes/resource/publish/components/types";

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

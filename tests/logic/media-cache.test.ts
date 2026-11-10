import { describe, expect, test } from "bun:test";
import {
  formatMediaCacheSize,
  getMediaCacheLimitMb,
  isImmutableMediaUrl,
} from "../../app/logic/media-cache";

const MB = 1024 * 1024;
const RAW = "https://raw.githubusercontent.com/owner/repo";

describe("isImmutableMediaUrl", () => {
  test("短提交 SHA 可以持久缓存", () => {
    expect(isImmutableMediaUrl(`${RAW}/efdc847/icon.png`)).toBe(true);
  });

  test("完整 40 位提交 SHA 可以持久缓存", () => {
    expect(
      isImmutableMediaUrl(
        `${RAW}/efdc847ccd943dac3a7c4960390c0582d3834f99/cover.png`,
      ),
    ).toBe(true);
  });

  test("分支引用不落盘", () => {
    expect(isImmutableMediaUrl(`${RAW}/main/icon.png`)).toBe(false);
    expect(
      isImmutableMediaUrl(`${RAW}/refs/heads/main/dist/icon.png`),
    ).toBe(false);
  });

  test("非 raw 域名与非 SHA 引用不缓存", () => {
    expect(isImmutableMediaUrl("https://example.com/efdc847/icon.png")).toBe(
      false,
    );
    expect(isImmutableMediaUrl(`${RAW}/v1.0.0/icon.png`)).toBe(false);
    expect(isImmutableMediaUrl("")).toBe(false);
  });
});

describe("formatMediaCacheSize", () => {
  test("按大小选择单位", () => {
    expect(formatMediaCacheSize(0)).toBe("0 MB");
    expect(formatMediaCacheSize(512 * MB)).toBe("512 MB");
    expect(formatMediaCacheSize(1.5 * 1024 * MB)).toBe("1.5 GB");
    expect(formatMediaCacheSize(12 * 1024 * MB)).toBe("12 GB");
  });
});

describe("getMediaCacheLimitMb", () => {
  test("没有存储环境时回退默认 512MB", () => {
    expect(getMediaCacheLimitMb()).toBe(512);
  });
});

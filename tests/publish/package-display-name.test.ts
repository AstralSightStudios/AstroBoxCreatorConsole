import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  displayNamesMatch,
  judgePackageDisplayName,
  readPackageDisplayName,
  summarizeDisplayNameCheck,
} from "../../app/logic/publish/package-display-name";

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** 168 字节表盘头，名称写在 offset 104 的 C 字符串。 */
function watchfaceWithLiteralName(name: string): Uint8Array {
  const bytes = new Uint8Array(168);
  bytes.set([0x5a, 0xa5, 0x34, 0x12], 0);
  bytes.set(new TextEncoder().encode(name), 104);
  return bytes;
}

/**
 * 文件头把名称标成翻译引用，正文放在译文表的 zh_CN。
 * 布局对齐 AstroBox-NG bin_decompiler：表盘头 168 字节，10 张表，译文是第 6 张。
 */
function watchfaceWithZhName(name: string): Uint8Array {
  const text = new TextEncoder().encode(name);
  const dataLen = 12 + text.length;
  const recordAddr = 400;
  const blobAddr = 420;
  const bytes = new Uint8Array(blobAddr + dataLen);
  bytes.set([0x5a, 0xa5, 0x34, 0x12], 0);
  bytes[28] = 1;
  bytes.set(u32(0xffffffff), 104);
  bytes.set(u32(0x06000000), 108);
  bytes.set(u32(1), 224);
  bytes.set(u32(recordAddr), 228);
  bytes.set(u32(0x06000000), recordAddr);
  bytes.set(u32(blobAddr), recordAddr + 8);
  bytes.set(u32(dataLen), recordAddr + 12);
  bytes.set(u32(1 << 1), blobAddr);
  bytes.set(u32(text.length), blobAddr + 8);
  bytes.set(text, blobAddr + 12);
  return bytes;
}

describe("表盘名", () => {
  test("读取文件头里的字面名称", () => {
    const found = readPackageDisplayName(watchfaceWithLiteralName("星海"), "watchface");
    expect(found.name).toBe("星海");
    expect(found.source).toBe("表盘文件头");
  });

  test("翻译引用优先取 zh_CN", () => {
    const found = readPackageDisplayName(watchfaceWithZhName("星海"), "watchface");
    expect(found.name).toBe("星海");
    expect(found.source).toBe("表盘文件头");
  });

  test("mwz 没有可用文件头时读 description.xml 的 name", () => {
    const zip = zipSync({
      "description.xml": strToU8(
        `<?xml version="1.0" encoding="utf-8"?><watch><name>TestFace</name><_id>123456789</_id></watch>`,
      ),
      "123456789.bin": new Uint8Array([1, 2, 3, 4]),
    });
    const found = readPackageDisplayName(zip, "watchface");
    expect(found.name).toBe("TestFace");
    expect(found.source).toBe("description.xml");
  });

  test("内层 bin 有名称时以设备上的文件头为准", () => {
    const zip = zipSync({
      "description.xml": strToU8("<watch><name>工程名</name></watch>"),
      "face.bin": watchfaceWithLiteralName("设备名"),
    });
    const found = readPackageDisplayName(zip, "watchface");
    expect(found.name).toBe("设备名");
    expect(found.source).toBe("表盘文件头");
  });

  test("Vivo 表盘 rpk 读 manifest.json 的 name", () => {
    const zip = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          package: "com.vivo.wf.watch107475",
          name: "简约",
          router: { watchfaces: { watchface: { id: "107475" } } },
        }),
      ),
    });
    const found = readPackageDisplayName(zip, "watchface");
    expect(found.name).toBe("简约");
    expect(found.source).toBe("manifest.json");
  });
});

describe("快应用名", () => {
  test("读取 manifest.json 的字符串 name", () => {
    const zip = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({ package: "com.yyh.vbook", name: "简阅", versionName: "1.1.2" }),
      ),
    });
    const found = readPackageDisplayName(zip, "quick_app");
    expect(found.name).toBe("简阅");
    expect(found.source).toBe("manifest.json");
  });

  test("语言表优先 zh-CN", () => {
    const zip = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          package: "com.example.app",
          name: { "en-US": "Read", "zh-CN": "简阅" },
        }),
      ),
    });
    expect(readPackageDisplayName(zip, "quick_app").name).toBe("简阅");
  });

  test("解析 ${message.appName} 到 i18n/zh-CN.json", () => {
    const zip = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({ package: "com.example.app", name: "${message.appName}" }),
      ),
      "i18n/zh-CN.json": strToU8(JSON.stringify({ message: { appName: "简阅" } })),
      "i18n/en-US.json": strToU8(JSON.stringify({ message: { appName: "Read" } })),
    });
    expect(readPackageDisplayName(zip, "quick_app").name).toBe("简阅");
  });
});

describe("资源包名", () => {
  test("读取 corona.json 的 name", () => {
    const zip = zipSync({
      "corona.json": strToU8(
        JSON.stringify({
          format: "canopus-resource-pack",
          formatVersion: 1,
          themeId: "dark",
          name: "深色",
          mappings: [],
        }),
      ),
    });
    const found = readPackageDisplayName(zip, "res_pack");
    expect(found.name).toBe("深色");
    expect(found.source).toBe("corona.json");
  });
});

describe("与资源名对比", () => {
  test("去掉首尾空白后相同算一致", () => {
    expect(displayNamesMatch("  星海  ", "星海")).toBe(true);
    expect(displayNamesMatch("星海", "星辰")).toBe(false);
  });

  test("不一致只给出 warn", () => {
    const summary = summarizeDisplayNameCheck("星海", [
      {
        fileName: "face.bin",
        status: "mismatch",
        contentName: "星辰",
        source: "表盘文件头",
      },
    ]);
    expect(summary.status).toBe("warn");
    expect(summary.detail).toContain("星海");
    expect(summary.detail).toContain("星辰");
    expect(summary.detail).not.toContain("不通过");
  });

  test("全部一致时通过", () => {
    const summary = summarizeDisplayNameCheck("简阅", [
      { fileName: "app.rpk", status: "match", contentName: "简阅", source: "manifest.json" },
    ]);
    expect(summary.status).toBe("pass");
    expect(summary.detail).toContain("简阅");
  });

  test("加密或过大时跳过读取，汇总仍是警告", () => {
    expect(
      judgePackageDisplayName({
        kind: "quick_app",
        resourceName: "简阅",
        encrypted: true,
        bytes: new Uint8Array([1, 2, 3]),
      }).nameMatch,
    ).toBe("skipped");
    const summary = summarizeDisplayNameCheck("简阅", [
      { fileName: "app.rpk", status: "skipped", note: "包体已加密" },
    ]);
    expect(summary.status).toBe("warn");
    expect(summary.detail).toContain("包体已加密");
  });
});

import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  normalizeWatchfaceIdInput,
  replaceWatchfaceIdInFile,
  replaceWatchfaceIdInPackage,
  validateWatchfaceIdFormat,
} from "../../app/logic/publish/watchface-id";
import { readPackageVersion } from "../../app/logic/publish/package-version";

/** 真实小米表盘（SekaiUI 9pro v1.1.2）前 64 字节：magic + offset4 版本 + offset40 ID。 */
const REAL_XIAOMI_HEADER = new Uint8Array([
  0x5a, 0xa5, 0x34, 0x12, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x06, 0x00, 0x38, 0x0e, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

describe("watchface ID", () => {
  test("validates and normalizes the required format", () => {
    expect(validateWatchfaceIdFormat("979812345678")).toBeNull();
    expect(validateWatchfaceIdFormat("979712345678")).toContain("9798");
    expect(validateWatchfaceIdFormat("97981234")).toContain("12");
    expect(normalizeWatchfaceIdInput("97a98-123456789")).toBe("979812345678");
  });

  test("writes the ID at byte offset 40 without mutating the source", async () => {
    const source = new File([new Uint8Array(64).fill(65)], "face.bin");
    const updated = await replaceWatchfaceIdInFile(source, "979812345678");
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const updatedBytes = new Uint8Array(await updated.arrayBuffer());

    expect(new TextDecoder().decode(updatedBytes.slice(40, 52))).toBe("979812345678");
    expect(sourceBytes[40]).toBe(65);
  });

  test("rejects files too short to contain the ID", async () => {
    await expect(
      replaceWatchfaceIdInFile(new File([new Uint8Array(51)], "short.bin"), "979812345678"),
    ).rejects.toThrow("太小");
  });
});

describe("replaceWatchfaceIdInPackage", () => {
  test(".bin 写 offset 40 且不破坏版本", async () => {
    const source = new File([REAL_XIAOMI_HEADER], "watchface.bin");
    const updated = await replaceWatchfaceIdInPackage(source, "979812345678");
    const info = await readPackageVersion(updated);
    expect(info.identity).toBe("979812345678");
    expect(info.version).toBe("1.1.2");
    expect(info.versionCode).toBe(65794);
  });

  test(".mwz 只改内层 bin，容器其它条目保留", async () => {
    const mwz = zipSync({
      "description.xml": strToU8("<x/>"),
      "resource.bin": REAL_XIAOMI_HEADER,
    });
    const updated = await replaceWatchfaceIdInPackage(
      new File([mwz], "theme.mwz"),
      "979812345678",
    );
    const entries = unzipSync(new Uint8Array(await updated.arrayBuffer()));
    expect(new TextDecoder().decode(entries["description.xml"])).toBe("<x/>");
    expect(
      new TextDecoder().decode(entries["resource.bin"].slice(40, 52)),
    ).toBe("979812345678");
  });

  test("rpk 原样返回，绝不往容器 offset 40 写字节", async () => {
    const rpk = zipSync({
      "manifest.json": strToU8(JSON.stringify({ package: "com.example.app" })),
      "META-INF/CERT": new Uint8Array([1, 2, 3, 4, 5]),
    });
    const source = new File([rpk], "app.rpk");
    const updated = await replaceWatchfaceIdInPackage(source, "979812345678");
    const before = new Uint8Array(await source.arrayBuffer());
    const after = new Uint8Array(await updated.arrayBuffer());
    expect(after).toEqual(before);
  });
});

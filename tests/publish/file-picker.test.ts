import { describe, expect, test } from "bun:test";
import {
  basenameFromPath,
  ensureFileNameExtension,
  mimeFromName,
  sniffExtension,
} from "../../app/logic/publish/file-picker";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const BMP = new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const AVIF = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
]);
const HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const UNKNOWN = new Uint8Array([0x5a, 0xa5, 0x34, 0x12, 0x00]);

describe("basenameFromPath", () => {
  test("Android MediaStore content:// 路径取到数字 ID", () => {
    expect(
      basenameFromPath("content://media/external/images/media/53001"),
    ).toBe("53001");
  });

  test("解码 URL 编码的文件名并剥离查询参数", () => {
    expect(
      basenameFromPath("content://doc/primary%3ADCIM%2Fmy%20pic.png?x=1"),
    ).toBe("my pic.png");
  });
});

describe("sniffExtension", () => {
  test("识别常见图片格式", () => {
    expect(sniffExtension(PNG)).toBe("png");
    expect(sniffExtension(JPG)).toBe("jpg");
    expect(sniffExtension(GIF)).toBe("gif");
    expect(sniffExtension(BMP)).toBe("bmp");
    expect(sniffExtension(WEBP)).toBe("webp");
    expect(sniffExtension(AVIF)).toBe("avif");
    expect(sniffExtension(HEIC)).toBe("heic");
    expect(sniffExtension(SVG)).toBe("svg");
  });

  test("无法识别时返回 null", () => {
    expect(sniffExtension(UNKNOWN)).toBeNull();
    expect(sniffExtension(new Uint8Array([]))).toBeNull();
  });
});

describe("ensureFileNameExtension", () => {
  test("无后缀时按文件头补全", () => {
    expect(ensureFileNameExtension("53001", PNG)).toBe("53001.png");
    expect(ensureFileNameExtension("53000", JPG)).toBe("53000.jpg");
  });

  test("已有后缀时保持不变", () => {
    expect(ensureFileNameExtension("cover.png", JPG)).toBe("cover.png");
    expect(ensureFileNameExtension("EL10THING.bin", UNKNOWN)).toBe(
      "EL10THING.bin",
    );
  });

  test("无法识别且无后缀时原样返回", () => {
    expect(ensureFileNameExtension("53001", UNKNOWN)).toBe("53001");
  });
});

describe("mimeFromName", () => {
  test("根据补全后的后缀推断 MIME", () => {
    expect(mimeFromName("53001.png")).toBe("image/png");
    expect(mimeFromName("53000.heic")).toBe("image/heic");
    expect(mimeFromName("EL10THING.bin")).toBe("application/octet-stream");
  });
});

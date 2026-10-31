import { describe, expect, test } from "bun:test";
import {
  extensionForFormat,
  formatFromMime,
  imageExtension,
  inspectImageBytes,
} from "../../app/logic/publish/image-meta";
import {
  checkAnimatedPreview,
  checkPreviewTotalSize,
  getAnimatedPreviewIssues,
} from "../../app/logic/publish/pre-publish-checks";

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function bytes(...parts: Array<number[] | Uint8Array>): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function u32le(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function pngChunk(type: string, data: number[]): Uint8Array {
  return bytes(
    u32be(data.length),
    ascii(type),
    data,
    [0, 0, 0, 0], // CRC 不参与解析
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function staticPng(): Uint8Array {
  return bytes(
    PNG_SIGNATURE,
    pngChunk("IHDR", Array(13).fill(0)),
    pngChunk("IDAT", [0]),
    pngChunk("IEND", []),
  );
}

function animatedApng(): Uint8Array {
  const fctl = (sequence: number, delayNum: number, delayDen: number) =>
    pngChunk("fcTL", [
      ...u32be(sequence),
      ...u32be(1),
      ...u32be(1),
      ...u32be(0),
      ...u32be(0),
      ...u16be(delayNum),
      ...u16be(delayDen),
      0,
      0,
    ]);
  return bytes(
    PNG_SIGNATURE,
    pngChunk("IHDR", Array(13).fill(0)),
    pngChunk("acTL", [...u32be(2), ...u32be(0)]),
    fctl(0, 1, 20),
    fctl(1, 1, 20),
    pngChunk("IDAT", [0]),
    pngChunk("IEND", []),
  );
}

function webpChunk(fourcc: string, data: number[]): Uint8Array {
  return bytes(
    ascii(fourcc),
    u32le(data.length),
    data,
    data.length % 2 === 1 ? [0] : [],
  );
}

function webpContainer(...chunks: Uint8Array[]): Uint8Array {
  const body = bytes(...chunks);
  return bytes(
    ascii("RIFF"),
    u32le(body.length + 4),
    ascii("WEBP"),
    body,
  );
}

function staticWebp(): Uint8Array {
  return webpContainer(
    webpChunk("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    webpChunk("VP8 ", [0, 0, 0, 0]),
  );
}

function animatedWebp(): Uint8Array {
  return webpContainer(
    webpChunk("VP8X", [0x02, 0, 0, 0, 1, 0, 0, 1, 0, 0]),
    webpChunk("ANIM", [0, 0, 0, 0, 0, 0]),
    webpChunk("ANMF", [
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      ...u24le(7),
      0,
    ]),
    webpChunk("ANMF", [
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      ...u24le(7),
      0,
    ]),
  );
}

function gifImage(delayCs: number): number[] {
  return [
    0x21, 0xf9, 0x04, 0x00, ...u16le(delayCs), 0x00, 0x00,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
    0x02, 0x01, 0x00, 0x00,
  ];
}

function gif(...images: number[][]): Uint8Array {
  return bytes(
    ascii("GIF89a"),
    [1, 0, 1, 0, 0, 0, 0],
    ...images.map((image) => image),
    [0x3b],
  );
}

describe("inspectImageBytes", () => {
  test("识别静态 PNG / APNG", () => {
    expect(inspectImageBytes(staticPng())).toMatchObject({
      format: "png",
      animated: false,
    });

    const apng = inspectImageBytes(animatedApng());
    expect(apng.format).toBe("png");
    expect(apng.animated).toBe(true);
    expect(apng.frames).toBe(2);
    expect(apng.durationMs).toBe(100);
    expect(apng.peakFps).toBe(20);
  });

  test("识别静态 WebP / 动画 WebP", () => {
    expect(inspectImageBytes(staticWebp())).toMatchObject({
      format: "webp",
      animated: false,
    });

    const webp = inspectImageBytes(animatedWebp());
    expect(webp.format).toBe("webp");
    expect(webp.animated).toBe(true);
    expect(webp.frames).toBe(2);
    expect(webp.durationMs).toBe(14);
    expect(webp.peakFps).toBeCloseTo(1000 / 7);
  });

  test("识别静态 GIF / 动画 GIF，并计算帧率", () => {
    expect(inspectImageBytes(gif(gifImage(10)))).toMatchObject({
      format: "gif",
      animated: false,
    });

    const gifMeta = inspectImageBytes(gif(gifImage(10), gifImage(10)));
    expect(gifMeta.format).toBe("gif");
    expect(gifMeta.animated).toBe(true);
    expect(gifMeta.frames).toBe(2);
    expect(gifMeta.durationMs).toBe(200);
    expect(gifMeta.peakFps).toBe(10);
  });

  test("识别 JPEG 与未知格式", () => {
    expect(inspectImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      format: "jpeg",
      animated: false,
    });
    expect(inspectImageBytes(new Uint8Array([1, 2, 3, 4]))).toMatchObject({
      format: "unknown",
      animated: false,
    });
  });
});

describe("image format helpers", () => {
  test("扩展名与 MIME 归一化", () => {
    expect(formatFromMime("image/jpeg")).toBe("jpeg");
    expect(formatFromMime("image/jpg")).toBe("jpeg");
    expect(extensionForFormat("jpeg")).toBe("jpg");
    expect(imageExtension("a/b/preview.WEBP")).toBe("webp");
  });
});

describe("animated preview limits", () => {
  test("2MB 以内、峰值 60fps 通过", () => {
    expect(
      getAnimatedPreviewIssues(
        { format: "webp", animated: true, frames: 180, durationMs: 3000, peakFps: 60 },
        1.5 * 1024 * 1024,
      ),
    ).toHaveLength(0);
  });

  test("超过 2MB 给 warn，超过 4MB 给 fail；144fps 不 fail，150fps fail", () => {
    expect(
      checkAnimatedPreview(
        { format: "webp", animated: true, frames: 180, durationMs: 1250, peakFps: 144 },
        1024 * 1024,
      )?.level,
    ).toBe("warn");

    expect(
      checkAnimatedPreview(
        { format: "webp", animated: true, frames: 180, durationMs: 3000, peakFps: 60 },
        2.5 * 1024 * 1024,
      )?.level,
    ).toBe("warn");

    expect(
      checkAnimatedPreview(
        { format: "webp", animated: true, frames: 700, durationMs: 12000, peakFps: 150 },
        5 * 1024 * 1024,
      )?.level,
    ).toBe("fail");
  });

  test("截断解析不拿不完整的帧率/帧数误判，但体积仍然有效", () => {
    expect(
      getAnimatedPreviewIssues(
        {
          format: "webp",
          animated: true,
          frames: 1000,
          durationMs: 20000,
          peakFps: 200,
          partial: true,
        },
        1024 * 1024,
      ),
    ).toHaveLength(0);

    expect(
      checkAnimatedPreview(
        {
          format: "webp",
          animated: true,
          frames: 1000,
          durationMs: 20000,
          peakFps: 200,
          partial: true,
        },
        5 * 1024 * 1024,
      )?.level,
    ).toBe("fail");
  });

  test("总体积阈值", () => {
    expect(checkPreviewTotalSize(9 * 1024 * 1024)?.level).toBe("warn");
    expect(checkPreviewTotalSize(13 * 1024 * 1024)?.level).toBe("fail");
  });
});

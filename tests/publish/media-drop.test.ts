import { describe, expect, test } from "bun:test";
import {
  dropClientPosition,
  isDroppedImage,
  mediaDropError,
} from "../../app/logic/publish/media-drop";

describe("媒体文件拖入", () => {
  test("识别 macOS 和 Windows 图片路径以及没有 MIME 的浏览器文件", () => {
    expect(isDroppedImage("/Users/creator/图片/封面.PNG")).toBe(true);
    expect(isDroppedImage("C:\\Users\\creator\\Pictures\\cover.JPEG")).toBe(true);
    expect(isDroppedImage("preview.webp", "")).toBe(true);
    expect(isDroppedImage("image", "image/png")).toBe(true);
    expect(isDroppedImage("package.zip", "application/zip")).toBe(false);
    expect(isDroppedImage("/Users/creator/Pictures")).toBe(false);
  });

  test("SVG 仍进入现有上传校验并展示禁用原因", () => {
    expect(isDroppedImage("icon.svg")).toBe(true);
    expect(isDroppedImage("image", "image/svg+xml")).toBe(true);
  });

  test("预览图接收多张而单图区域拒绝歧义的批量拖入", () => {
    expect(mediaDropError("previews", 3)).toBeNull();
    expect(mediaDropError("icon", 1)).toBeNull();
    expect(mediaDropError("cover", 1)).toBeNull();
    expect(mediaDropError("icon", 2)).toContain("一次只能拖入一张");
    expect(mediaDropError("cover", 2)).toContain("一次只能拖入一张");
    expect(mediaDropError("previews", 0)).toContain("请拖入");
  });

  test("Mac Retina 拖到预览图时不能将逻辑坐标减半而误命中图标", () => {
    expect(dropClientPosition({ x: 800, y: 1000 }, 2, "MacIntel")).toEqual({
      x: 800,
      y: 1000,
    });
    expect(dropClientPosition({ x: 800, y: 1000 }, 1, "MacIntel")).toEqual({
      x: 800,
      y: 1000,
    });
  });

  test("Windows 物理坐标按照显示缩放转换为 DOM 坐标", () => {
    expect(dropClientPosition({ x: 600, y: 400 }, 2, "Win32")).toEqual({ x: 300, y: 200 });
    expect(dropClientPosition({ x: 375, y: 250 }, 1.25, "Win32")).toEqual({ x: 300, y: 200 });
    expect(dropClientPosition({ x: 300, y: 200 }, 1, "Win32")).toEqual({ x: 300, y: 200 });
  });

  test("Linux 逻辑坐标也不能重复除以显示缩放", () => {
    expect(dropClientPosition({ x: 800, y: 1000 }, 2, "Linux x86_64")).toEqual({
      x: 800,
      y: 1000,
    });
  });
});

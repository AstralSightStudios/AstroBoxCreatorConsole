import { describe, expect, test } from "bun:test";
import {
  findTextLinks,
  splitTextByLinks,
  textContainsLink,
  textLinkHref,
} from "../../app/logic/publish/description-links";

describe("资源简介链接检测", () => {
  test("识别完整 URL、裸域名、短链接与 IP", () => {
    expect(findTextLinks("详见 https://example.com/download")).toEqual([
      "https://example.com/download",
    ]);
    expect(findTextLinks("官网 example.com 或 t.cn/abc")).toEqual([
      "example.com",
      "t.cn/abc",
    ]);
    expect(findTextLinks("备用 192.168.1.1")).toEqual(["192.168.1.1"]);
    expect(findTextLinks("邮箱 demo@example.com")).toEqual(["example.com"]);
  });

  test("识别 Markdown 链接并去掉末尾标点", () => {
    expect(findTextLinks("[官网](https://example.com)，欢迎访问。")).toEqual([
      "https://example.com",
    ]);
    expect(findTextLinks("下载地址：example.com/download。")).toEqual([
      "example.com/download",
    ]);
  });

  test("普通文本与版本号不误判", () => {
    for (const text of [
      "这是一段普通的资源简介",
      "支持 v1.2.0 与 iOS 17",
      "图标文件名 logo.png，文档 README.md",
      "120fps 高帧率，C++ 编写",
      "e.g. 可以这样用",
      "example.company 不是常见域名",
    ]) {
      expect(textContainsLink(text)).toBe(false);
      expect(findTextLinks(text)).toEqual([]);
    }
  });

  test("切分后普通文本与链接都能还原原文", () => {
    const text = "前文 https://example.com/a?b=1 。中间 www.example.com 结尾";
    const segments = splitTextByLinks(text);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.link).map((segment) => segment.text)).toEqual([
      "https://example.com/a?b=1",
      "www.example.com",
    ]);
  });

  test("链接 href 只放行安全协议", () => {
    expect(textLinkHref("https://example.com")).toBe("https://example.com");
    expect(textLinkHref("www.example.com")).toBe("https://www.example.com");
    expect(textLinkHref("example.com")).toBe("https://example.com");
    expect(textLinkHref("mailto:demo@example.com")).toBe("mailto:demo@example.com");
    expect(textLinkHref("javascript://alert(1)")).toBeNull();
  });

  test("空文本返回空结果", () => {
    expect(splitTextByLinks("")).toEqual([]);
    expect(findTextLinks("")).toEqual([]);
    expect(textContainsLink("")).toBe(false);
  });
});

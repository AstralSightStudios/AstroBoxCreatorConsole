import { describe, expect, test } from "bun:test";
import { parseAuditLookupInput } from "../../app/logic/publish/pr-audit-input";

describe("parseAuditLookupInput", () => {
  test("纯数字默认按 PR 序号处理", () => {
    expect(parseAuditLookupInput(" 1654 ")).toEqual({
      kind: "pr",
      number: 1654,
      source: "number",
    });
  });

  test("支持 #、pr: 与 PR # 前缀", () => {
    expect(parseAuditLookupInput("#42")).toEqual({
      kind: "pr",
      number: 42,
      source: "number",
    });
    expect(parseAuditLookupInput("pr: 42")).toEqual({
      kind: "pr",
      number: 42,
      source: "number",
    });
    expect(parseAuditLookupInput("PR #42")).toEqual({
      kind: "pr",
      number: 42,
      source: "number",
    });
  });

  test("资源 ID 使用 id: 前缀区分纯数字", () => {
    expect(parseAuditLookupInput("id:979821130209")).toEqual({
      kind: "resource",
      resourceId: "979821130209",
    });
    expect(parseAuditLookupInput("ID: com.example.demo")).toEqual({
      kind: "resource",
      resourceId: "com.example.demo",
    });
  });

  test("普通非数字输入按资源 ID 处理", () => {
    expect(parseAuditLookupInput("com.example.demo")).toEqual({
      kind: "resource",
      resourceId: "com.example.demo",
    });
  });

  test("解析当前环境仓库的完整 PR 链接", () => {
    expect(
      parseAuditLookupInput(
        "https://github.com/AstralSightStudios/AstroBox-Repo/pull/1654/files",
      ),
    ).toEqual({ kind: "pr", number: 1654, source: "url" });
  });

  test("缺少 scheme 的 GitHub 链接也能解析", () => {
    expect(
      parseAuditLookupInput(
        "github.com/AstralSightStudios/AstroBox-Repo/pull/1654",
      ),
    ).toEqual({ kind: "pr", number: 1654, source: "url" });
  });

  test("拒绝其他仓库的 PR 链接", () => {
    expect(() =>
      parseAuditLookupInput("https://github.com/AstralSightStudios/Other/pull/1"),
    ).toThrow("仅支持 AstralSightStudios/AstroBox-Repo 的 PR");
  });

  test("拒绝非 PR 或路径不规范的 GitHub 链接", () => {
    expect(() =>
      parseAuditLookupInput(
        "https://github.com/AstralSightStudios/AstroBox-Repo/issues/1",
      ),
    ).toThrow("不是 GitHub PR 地址");
    expect(() =>
      parseAuditLookupInput(
        "https://github.com/AstralSightStudios/AstroBox-Repo/extra/pull/1",
      ),
    ).toThrow("不是 GitHub PR 地址");
  });

  test("拒绝空输入与非法序号", () => {
    expect(() => parseAuditLookupInput("   ")).toThrow("请输入");
    expect(() => parseAuditLookupInput("id:")).toThrow("资源 ID 不能为空");
    expect(() => parseAuditLookupInput("pr:abc")).toThrow("必须是正整数");
    expect(() => parseAuditLookupInput("pr:0")).toThrow("必须是正整数");
  });

  test("拒绝无法识别的协议链接，避免误当资源 ID", () => {
    expect(() => parseAuditLookupInput("gitlab://example/demo")).toThrow(
      "只能输入 GitHub PR 链接或资源 ID",
    );
  });
});

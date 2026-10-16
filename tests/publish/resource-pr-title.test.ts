import { describe, expect, test } from "bun:test";
import { buildResourcePrTitle } from "../../app/logic/publish/resources";

describe("resource pr title", () => {
  test("资源标题变更后保留 Update resource 前缀并刷新名称", () => {
    expect(
      buildResourcePrTitle({
        currentTitle: "[ABCC] Update resource: 旧标题",
        itemName: "新标题",
        itemId: "id-1",
      }),
    ).toBe("[ABCC] Update resource: 新标题");
  });

  test("未发布资源的 Add new resource PR 保留 Add 前缀", () => {
    expect(
      buildResourcePrTitle({
        currentTitle: "[ABCC] Add new resource: 旧标题",
        itemName: "新标题",
        itemId: "id-1",
      }),
    ).toBe("[ABCC] Add new resource: 新标题");
  });

  test("旧标题缺失或非 ABCC 格式时退回 Update resource 格式", () => {
    expect(
      buildResourcePrTitle({ itemName: "标题", itemId: "id-1" }),
    ).toBe("[ABCC] Update resource: 标题");
    expect(
      buildResourcePrTitle({
        currentTitle: "fix: some custom title",
        itemName: "标题",
        itemId: "id-1",
      }),
    ).toBe("[ABCC] Update resource: 标题");
  });

  test("资源名称为空时回退到资源 ID", () => {
    expect(
      buildResourcePrTitle({
        currentTitle: "[ABCC] Update resource: 名称",
        itemName: "  ",
        itemId: "id-1",
      }),
    ).toBe("[ABCC] Update resource: id-1");
  });
});

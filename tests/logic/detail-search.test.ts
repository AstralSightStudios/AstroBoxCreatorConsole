import { describe, expect, test } from "bun:test";
import {
  countLabel,
  filterItems,
  matchKeyword,
  safeSearchText,
  type DetailSearchContext,
} from "../../app/logic/catalog/detail-search";

function buildContext(
  keyword: string,
  users: Record<string, string> = {},
  devices: Record<string, string> = {},
): DetailSearchContext {
  return {
    keyword,
    userName: (userId) => (userId ? (users[userId] ?? "") : ""),
    deviceLabel: (deviceId) =>
      deviceId ? (devices[deviceId] ?? deviceId) : "",
  };
}

describe("详情页关键字过滤", () => {
  test("关键字为空时全部命中", () => {
    expect(matchKeyword(buildContext(""), { status: "pending_binding" })).toBe(
      true,
    );
  });

  test("命中原始字段，大小写不敏感", () => {
    const context = buildContext("PENDING");
    expect(matchKeyword(context, { status: "pending_binding" })).toBe(true);
    expect(matchKeyword(context, { status: "granted" })).toBe(false);
  });

  test("嵌套对象字段走 JSON，不会变成 [object Object]", () => {
    expect(safeSearchText({ a: { b: "内层" } })).toContain("内层");
    expect(
      matchKeyword(buildContext("内层"), { meta: { payload: { b: "内层" } } }),
    ).toBe(true);
  });

  test("命中已翻译的可读文本（中文标签 / 账号名 / 设备名）", () => {
    const context = buildContext(
      "爱发电",
      { "user-1": "张三" },
      { xmb9: "小米手环 9（xmb9）" },
    );
    expect(
      matchKeyword(
        context,
        { platform: "afd", sellerUserId: "user-1", deviceId: "xmb9" },
        "爱发电",
        context.userName("user-1"),
        context.deviceLabel("xmb9"),
      ),
    ).toBe(true);
    expect(
      matchKeyword(context, { platform: "cdk" }, "CDK 兑换"),
    ).toBe(false);
  });

  test("关键字命中账号昵称时也能过滤出来", () => {
    const context = buildContext("李四", { "user-2": "李四" });
    const items = [
      { id: "order-1", buyerUserId: "user-2" },
      { id: "order-2", buyerUserId: "user-3" },
    ];
    const visible = filterItems(items, context, (item) => [
      context.userName(item.buyerUserId),
    ]);
    expect(visible.map((item) => item.id)).toEqual(["order-1"]);
  });

  test("无关键字时返回新数组并保持原顺序", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const visible = filterItems(items, buildContext(""), () => []);
    expect(visible).toEqual(items);
    expect(visible).not.toBe(items);
  });

  test("计数文案：搜索收窄时显示命中数", () => {
    expect(countLabel(3, 3, buildContext(""))).toBe("3");
    expect(countLabel(3, 3, buildContext("abc"))).toBe("3");
    expect(countLabel(1, 3, buildContext("abc"))).toBe("命中 1 / 共 3");
  });
});

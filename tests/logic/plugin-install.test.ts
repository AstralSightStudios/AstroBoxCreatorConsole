import { describe, expect, test } from "bun:test";
import {
  PLUGIN_INSTALL_DATA_MAX_BYTES,
  checkPluginInstallMarket,
  describePluginInstallMarketIssue,
  inspectPluginInstall,
  isValidPluginName,
  parsePluginInstallData,
  readPluginInstall,
  writePluginInstall,
} from "../../app/logic/publish/plugin-install";

describe("isValidPluginName", () => {
  test("与客户端校验插件目录名的规则一致", () => {
    for (const name of ["my-plugin", "com.example.plugin", "中文插件", "a b"]) {
      expect(isValidPluginName(name)).toBe(true);
    }
    for (const name of ["", " pad", "pad ", ".", "..", "a/b", "a\\b", "a:b", "a\nb", "trailing.", "x".repeat(129)]) {
      expect(isValidPluginName(name)).toBe(false);
    }
    expect(isValidPluginName("x".repeat(128))).toBe(true);
  });
});

describe("inspectPluginInstall", () => {
  test("没有 pluginInstall 键：不存在、没有问题", () => {
    expect(inspectPluginInstall({})).toMatchObject({ present: false, problems: [] });
    expect(inspectPluginInstall(undefined).present).toBe(false);
  });

  test("合法声明没有问题", () => {
    const result = inspectPluginInstall({ pluginInstall: { plugin: "my-plugin", data: { sku: "a" }, fallback: "download" } });
    expect(result).toMatchObject({ present: true, plugin: "my-plugin", fallback: "download", problems: [] });
    expect(result.dataBytes).toBe('{"sku":"a"}'.length);
  });

  test("只写插件名也合法，兜底默认阻止", () => {
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p" } })).toMatchObject({ fallback: "block", dataBytes: 0, problems: [] });
  });

  test("不是对象、没写插件名、插件名不合法都会提示", () => {
    expect(inspectPluginInstall({ pluginInstall: "my-plugin" }).problems.join()).toContain("对象");
    expect(inspectPluginInstall({ pluginInstall: [] }).problems.join()).toContain("对象");
    expect(inspectPluginInstall({ pluginInstall: {} }).problems.join()).toContain("必须填写插件名");
    expect(inspectPluginInstall({ pluginInstall: { plugin: 3 } }).problems.join()).toContain("必须填写插件名");
    expect(inspectPluginInstall({ pluginInstall: { plugin: "a/b" } }).problems.join()).toContain("插件名不合法");
    expect(inspectPluginInstall({ pluginInstall: { plugin: " p " } }).problems.join()).toContain("空格");
  });

  test("fallback 写错会提示", () => {
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p", fallback: "retry" } }).problems.join()).toContain("fallback");
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p", fallback: 1 } }).problems.join()).toContain("fallback");
  });

  test("data 按 UTF-8 字节数限制 16 KiB", () => {
    const fits = "a".repeat(PLUGIN_INSTALL_DATA_MAX_BYTES - 2);
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p", data: fits } }).problems).toEqual([]);
    const over = "a".repeat(PLUGIN_INSTALL_DATA_MAX_BYTES);
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p", data: over } }).problems.join()).toContain("上限");
    // 汉字每个 3 字节：字符数没到上限，字节数超了
    const cjk = "汉".repeat(PLUGIN_INSTALL_DATA_MAX_BYTES / 3);
    expect(inspectPluginInstall({ pluginInstall: { plugin: "p", data: cjk } }).problems.join()).toContain("上限");
  });
});

describe("read / write pluginInstall", () => {
  test("读出表单值，data 美化成可编辑文本", () => {
    const extRaw = JSON.stringify({ pluginInstall: { plugin: "p", fallback: "download", data: { a: 1 } } });
    expect(readPluginInstall(extRaw)).toEqual({ plugin: "p", fallback: "download", dataText: '{\n  "a": 1\n}' });
    expect(readPluginInstall("{}")).toBeNull();
    expect(readPluginInstall("not json")).toBeNull();
    expect(readPluginInstall('{"pluginInstall": 3}')).toBeNull();
  });

  test("写入保留其它键，默认兜底不写，data 留空不写", () => {
    const written = writePluginInstall('{"other": true}', { plugin: " p ", fallback: "block", dataText: "" });
    expect(JSON.parse(written)).toEqual({ other: true, pluginInstall: { plugin: "p" } });

    const withData = writePluginInstall("{}", { plugin: "p", fallback: "download", dataText: '{"sku":"a"}' });
    expect(JSON.parse(withData)).toEqual({ pluginInstall: { plugin: "p", fallback: "download", data: { sku: "a" } } });
  });

  test("data 草稿不是合法 JSON 时保留原来的 data，不写半截内容", () => {
    const before = writePluginInstall("{}", { plugin: "p", fallback: "block", dataText: '{"sku":"a"}' });
    const after = writePluginInstall(before, { plugin: "p2", fallback: "block", dataText: '{"sku":' });
    expect(JSON.parse(after).pluginInstall).toEqual({ plugin: "p2", data: { sku: "a" } });
  });

  test("删除只去掉这一项；ext 本身不合法时原样返回", () => {
    expect(writePluginInstall('{"pluginInstall":{"plugin":"p"}}', null)).toBe("{}");
    expect(JSON.parse(writePluginInstall('{"pluginInstall":{"plugin":"p"},"x":1}', null))).toEqual({ x: 1 });
    expect(writePluginInstall("{broken", { plugin: "p", fallback: "block", dataText: "" })).toBe("{broken");
  });

  test("写出来的结果能被检查通过，也能再读回同样的值", () => {
    const value = { plugin: "my-plugin", fallback: "download" as const, dataText: JSON.stringify({ n: [1, 2] }, null, 2) };
    const written = writePluginInstall("{}", value);
    expect(inspectPluginInstall(JSON.parse(written)).problems).toEqual([]);
    expect(readPluginInstall(written)).toEqual(value);
  });
});

describe("parsePluginInstallData", () => {
  test("留空、合法、非法", () => {
    expect(parsePluginInstallData("  ")).toEqual({ ok: true, empty: true });
    expect(parsePluginInstallData('{"a":1}')).toEqual({ ok: true, empty: false, value: { a: 1 } });
    expect(parsePluginInstallData('"text"')).toEqual({ ok: true, empty: false, value: "text" });
    expect(parsePluginInstallData("{").ok).toBe(false);
  });
});

describe("checkPluginInstallMarket", () => {
  const index = [
    { manifest: { name: "new-plugin", api_level: 4 } },
    { manifest: { name: "old-plugin", api_level: 3 } },
    { manifest: { name: "no-level" } },
    { manifest: null },
    {},
  ];

  test("索引没加载到时不下结论", () => {
    expect(checkPluginInstallMarket("new-plugin", null)).toEqual({ state: "unknown" });
    expect(checkPluginInstallMarket("new-plugin", undefined)).toEqual({ state: "unknown" });
  });

  test("Level 4 以上的市场插件通过", () => {
    expect(checkPluginInstallMarket("new-plugin", index)).toEqual({ state: "ok", apiLevel: 4 });
    expect(checkPluginInstallMarket("new-plugin", [{ manifest: { name: "new-plugin", api_level: 5 } }])).toEqual({ state: "ok", apiLevel: 5 });
  });

  test("不在市场、名字对不上、空名字都算 missing", () => {
    expect(checkPluginInstallMarket("ghost", index)).toEqual({ state: "missing" });
    expect(checkPluginInstallMarket("New-Plugin", index)).toEqual({ state: "missing" });
    expect(checkPluginInstallMarket("", index)).toEqual({ state: "missing" });
    expect(checkPluginInstallMarket("  ", index)).toEqual({ state: "missing" });
  });

  test("Level 低于 4 或没写 api_level 都是 outdated", () => {
    expect(checkPluginInstallMarket("old-plugin", index)).toEqual({ state: "outdated", apiLevel: 3 });
    expect(checkPluginInstallMarket("no-level", index)).toEqual({ state: "outdated", apiLevel: 0 });
  });

  test("只有 missing / outdated 才有提示语", () => {
    expect(describePluginInstallMarketIssue("p", { state: "ok", apiLevel: 4 })).toBeNull();
    expect(describePluginInstallMarketIssue("p", { state: "unknown" })).toBeNull();
    expect(describePluginInstallMarketIssue("p", { state: "missing" })).toContain("找不到");
    expect(describePluginInstallMarketIssue("p", { state: "outdated", apiLevel: 3 })).toContain("Level 3");
  });
});

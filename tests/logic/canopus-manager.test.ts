import { describe, expect, test } from "bun:test";
import {
  formatCanopusManagerVersion,
  inspectCanopusManager,
  parseCanopusManagerVersion,
  readCanopusManagerMinVersion,
  writeCanopusManagerMinVersion,
} from "../../app/logic/publish/canopus-manager";

describe("parseCanopusManagerVersion（与客户端同一套规则）", () => {
  test("x.y.z 编码为 主<<16 | 次<<8 | 补丁，补丁号可省略，容忍前缀 v 与空白", () => {
    expect(parseCanopusManagerVersion("2.0.3")).toBe(0x020003);
    expect(parseCanopusManagerVersion("1.2")).toBe(0x010200);
    expect(parseCanopusManagerVersion(" v2.0.3 ")).toBe(0x020003);
    expect(parseCanopusManagerVersion("0.1.0")).toBe(0x000100);
    expect(parseCanopusManagerVersion("255.255.255")).toBe(255 * 0x10000 + 0xffff);
  });

  test("整数按表盘 versionCode 原样使用，必须是大于 0 的安全整数", () => {
    expect(parseCanopusManagerVersion(131072)).toBe(131072);
    expect(parseCanopusManagerVersion(0)).toBeUndefined();
    expect(parseCanopusManagerVersion(-1)).toBeUndefined();
    expect(parseCanopusManagerVersion(1.5)).toBeUndefined();
    expect(parseCanopusManagerVersion(Number.MAX_SAFE_INTEGER + 2)).toBeUndefined();
  });

  test("写错的值一律不认", () => {
    for (const bad of ["", "2", "2.", ".1", "a.b.c", "1.2.3.4", "1.256.0", "1.0.256", "0.0.0", "0.0", "1000.0.0", "2.0.3-beta", null, undefined, {}, []]) {
      expect(parseCanopusManagerVersion(bad as unknown)).toBeUndefined();
    }
  });

  test("format 与 parse 互为逆运算", () => {
    expect(formatCanopusManagerVersion(0x020003)).toBe("2.0.3");
    expect(formatCanopusManagerVersion(parseCanopusManagerVersion("12.34.56")!)).toBe("12.34.56");
  });
});

describe("inspectCanopusManager", () => {
  test("没有声明：不存在也没有问题", () => {
    expect(inspectCanopusManager({}, "canopus")).toMatchObject({ present: false, problems: [], warnings: [] });
    expect(inspectCanopusManager(undefined, "canopus").present).toBe(false);
  });

  test("合法声明没有问题并给出编码", () => {
    const result = inspectCanopusManager({ canopusManager: { minVersion: "2.0.3" } }, "canopus");
    expect(result).toMatchObject({ present: true, code: 0x020003, problems: [], warnings: [] });
    expect(inspectCanopusManager({ canopusManager: { minVersion: 131072 } }, "canopus").code).toBe(131072);
  });

  test("结构不对、没填 minVersion、格式不对都是问题（客户端会静默忽略）", () => {
    expect(inspectCanopusManager({ canopusManager: "2.0.3" }, "canopus").problems.join()).toContain("需要是一个对象");
    expect(inspectCanopusManager({ canopusManager: [] }, "canopus").problems.join()).toContain("需要是一个对象");
    expect(inspectCanopusManager({ canopusManager: {} }, "canopus").problems.join()).toContain("没有填写 minVersion");
    expect(inspectCanopusManager({ canopusManager: { minVersion: "" } }, "canopus").problems.join()).toContain("没有填写 minVersion");
    const bad = inspectCanopusManager({ canopusManager: { minVersion: "2" } }, "canopus");
    expect(bad.code).toBeUndefined();
    expect(bad.problems.join()).toContain("格式不对");
    expect(inspectCanopusManager({ canopusManager: { minVersion: "1.256.0" } }, "canopus").problems).toHaveLength(1);
  });

  test("不是模块类资源时只警告：声明不会生效，但不拦截", () => {
    const result = inspectCanopusManager({ canopusManager: { minVersion: "2.0.3" } }, "watchface");
    expect(result.problems).toEqual([]);
    expect(result.warnings.join()).toContain("只对「模块」类资源生效");
    // 没传资源类型（例如审核里拿不到）时不判断
    expect(inspectCanopusManager({ canopusManager: { minVersion: "2.0.3" } }).warnings).toEqual([]);
  });
});

describe("readCanopusManagerMinVersion / writeCanopusManagerMinVersion", () => {
  test("写入保留其它 ext 键与 canopusManager 里的其它键", () => {
    const base = JSON.stringify({ forceUpdate: { version: "1.0", strategy: "prompt" }, canopusManager: { note: "keep" } });
    const written = JSON.parse(writeCanopusManagerMinVersion(base, " 2.0.3 "));
    expect(written).toEqual({
      forceUpdate: { version: "1.0", strategy: "prompt" },
      canopusManager: { note: "keep", minVersion: "2.0.3" },
    });
    expect(readCanopusManagerMinVersion(JSON.stringify(written))).toBe("2.0.3");
  });

  test("输入清空：删除 minVersion，canopusManager 空了整个删掉，ext 空了写回 {}", () => {
    const withValue = writeCanopusManagerMinVersion("{}", "2.0.3");
    expect(writeCanopusManagerMinVersion(withValue, "")).toBe("{}");
    expect(writeCanopusManagerMinVersion(withValue, "   ")).toBe("{}");
    const keep = JSON.stringify({ a: 1, canopusManager: { minVersion: "1.0", note: "x" } });
    expect(JSON.parse(writeCanopusManagerMinVersion(keep, ""))).toEqual({ a: 1, canopusManager: { note: "x" } });
  });

  test("没写完的输入也原样写入，由校验拦截发布，输入框回读一致", () => {
    const typing = writeCanopusManagerMinVersion("{}", "2.");
    expect(readCanopusManagerMinVersion(typing)).toBe("2.");
    expect(inspectCanopusManager(JSON.parse(typing), "canopus").problems).toHaveLength(1);
  });

  test("已有的整数 versionCode 在输入框里显示成 x.y.z", () => {
    expect(readCanopusManagerMinVersion('{"canopusManager":{"minVersion":131075}}')).toBe("2.0.3");
  });

  test("ext 不是合法 JSON 对象时不动它，读出空串", () => {
    expect(writeCanopusManagerMinVersion("{oops", "2.0.3")).toBe("{oops");
    expect(writeCanopusManagerMinVersion("[1]", "")).toBe("[1]");
    expect(readCanopusManagerMinVersion("{oops")).toBe("");
    expect(readCanopusManagerMinVersion("")).toBe("");
    expect(readCanopusManagerMinVersion('{"canopusManager":"x"}')).toBe("");
  });
});

import { describe, expect, test } from "bun:test";
import {
  FORCE_UPDATE_REASON_MAX,
  collectDownloadVersions,
  inspectForceUpdate,
  readForceUpdate,
  writeForceUpdate,
} from "../../app/logic/publish/force-update";

const downloads = [
  { version: "1.2.0", versionCode: 12 },
  { version: "1.1.0", versionCode: 11 },
];

describe("inspectForceUpdate", () => {
  test("没有 forceUpdate 键：不存在、没有问题", () => {
    expect(inspectForceUpdate({}, downloads)).toMatchObject({ present: false, problems: [] });
    expect(inspectForceUpdate(undefined, downloads).present).toBe(false);
  });

  test("合法声明没有问题", () => {
    const result = inspectForceUpdate(
      { forceUpdate: { version: "1.2.0", strategy: "prompt", reason: "修复闪退" } },
      downloads,
    );
    expect(result).toMatchObject({ present: true, strategy: "prompt", version: "1.2.0", reason: "修复闪退", problems: [] });
  });

  test("策略大小写和空白与客户端一样容错", () => {
    expect(inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: " Silent " } }, downloads).strategy).toBe("silent");
  });

  test("策略非法、没绑版本都会提示", () => {
    const badStrategy = inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "force" } }, downloads);
    expect(badStrategy.strategy).toBeNull();
    expect(badStrategy.problems.join()).toContain("strategy");

    const noVersion = inspectForceUpdate({ forceUpdate: { strategy: "prompt" } }, downloads);
    expect(noVersion.problems.join()).toContain("必须填写 version");
  });

  test("绑定的版本不在本次下载项里：只警告不拦截（老资源发新版后的正常残留）", () => {
    const stale = inspectForceUpdate({ forceUpdate: { version: "1.0.0", strategy: "silent" } }, downloads);
    expect(stale.problems).toEqual([]);
    expect(stale.warnings.join()).toContain("对不上");

    const byCode = inspectForceUpdate({ forceUpdate: { versionCode: 99, strategy: "silent" } }, downloads);
    expect(byCode.problems).toEqual([]);
    expect(byCode.warnings.join()).toContain("versionCode 99");

    const matched = inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "silent" } }, downloads);
    expect(matched.warnings).toEqual([]);
  });

  test("下载项还没填版本时不误报对不上", () => {
    const result = inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "prompt" } }, []);
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("结构不对：非对象、versionCode 非整数、reason 非字符串或过长", () => {
    expect(inspectForceUpdate({ forceUpdate: "silent" }, downloads).problems).toEqual(["forceUpdate 需要是一个对象"]);
    expect(inspectForceUpdate({ forceUpdate: [] }, downloads).problems).toEqual(["forceUpdate 需要是一个对象"]);
    expect(
      inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "prompt", versionCode: 1.5 } }, downloads).problems.join(),
    ).toContain("versionCode 需要是整数");
    expect(
      inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "prompt", reason: 5 } }, downloads).problems.join(),
    ).toContain("reason 需要是字符串");
    const long = "😀".repeat(FORCE_UPDATE_REASON_MAX + 1);
    expect(
      inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "prompt", reason: long } }, downloads).problems.join(),
    ).toContain("超过");
    // 恰好上限（按码点）不报
    expect(
      inspectForceUpdate({ forceUpdate: { version: "1.2.0", strategy: "prompt", reason: "😀".repeat(FORCE_UPDATE_REASON_MAX) } }, downloads)
        .problems,
    ).toEqual([]);
  });
});

describe("readForceUpdate / writeForceUpdate", () => {
  test("写入保留其它 ext 键", () => {
    const base = JSON.stringify({ enableAstroBoxCreatorFeatures: true, canopusManager: { minVersion: "1.0.0" } });
    const written = writeForceUpdate(base, { version: " 1.2.0 ", strategy: "prompt", reason: " 修复闪退 " });
    expect(JSON.parse(written)).toEqual({
      enableAstroBoxCreatorFeatures: true,
      canopusManager: { minVersion: "1.0.0" },
      forceUpdate: { version: "1.2.0", strategy: "prompt", reason: "修复闪退" },
    });
    expect(readForceUpdate(written)).toEqual({ version: "1.2.0", strategy: "prompt", reason: "修复闪退" });
  });

  test("静默策略不写理由；空理由不写 reason 键", () => {
    const silent = JSON.parse(writeForceUpdate("{}", { version: "1.2.0", strategy: "silent", reason: "不会显示" }));
    expect(silent.forceUpdate).toEqual({ version: "1.2.0", strategy: "silent" });
    const emptyReason = JSON.parse(writeForceUpdate("{}", { version: "1.2.0", strategy: "prompt", reason: "   " }));
    expect(emptyReason.forceUpdate).toEqual({ version: "1.2.0", strategy: "prompt" });
  });

  test("传 null 删除；删到只剩空对象时写回 {}", () => {
    const base = writeForceUpdate("{}", { version: "1.2.0", strategy: "prompt", reason: "" });
    expect(writeForceUpdate(base, null)).toBe("{}");
    expect(JSON.parse(writeForceUpdate('{"a":1,"forceUpdate":{"version":"1"}}', null))).toEqual({ a: 1 });
  });

  test("ext 不是合法 JSON 对象时不动它", () => {
    expect(writeForceUpdate("{oops", { version: "1", strategy: "prompt", reason: "" })).toBe("{oops");
    expect(writeForceUpdate("[1]", null)).toBe("[1]");
    expect(readForceUpdate("{oops")).toBeNull();
    expect(readForceUpdate("{}")).toBeNull();
    expect(readForceUpdate("")).toBeNull();
  });

  test("读取时非法策略退回 prompt，供表单展示", () => {
    expect(readForceUpdate('{"forceUpdate":{"version":"1","strategy":"x"}}')?.strategy).toBe("prompt");
  });
});

describe("collectDownloadVersions", () => {
  test("去重、去空、保持顺序", () => {
    expect(
      collectDownloadVersions([{ version: "1.2.0" }, { version: " 1.2.0 " }, { version: "" }, { version: 3 }, { version: "1.1.0" }]),
    ).toEqual(["1.2.0", "1.1.0"]);
  });
});

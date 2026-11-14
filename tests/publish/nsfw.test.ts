import { describe, expect, test } from "bun:test";
import {
  NSFW_REASON_MAX,
  NSFW_TAG,
  hasNsfwTag,
  inspectNsfw,
  readNsfwReason,
  setNsfwTag,
  visibleTags,
  writeNsfwReason,
} from "../../app/logic/publish/nsfw";

describe("敏感内容标记（目录 tags）", () => {
  test("标记写作 <__NSFW__>，与普通标签一起存在 tags 里", () => {
    expect(NSFW_TAG).toBe("<__NSFW__>");
    expect(hasNsfwTag(["恐怖", "<__NSFW__>"])).toBe(true);
    expect(hasNsfwTag(["恐怖", " <__NSFW__> "])).toBe(true);
    expect(hasNsfwTag(["恐怖", "NSFW", "<__nsfw__>"])).toBe(false);
    expect(hasNsfwTag([])).toBe(false);
  });

  test("标记不当作标签展示", () => {
    expect(visibleTags(["恐怖", "<__NSFW__>", "游戏"])).toEqual(["恐怖", "游戏"]);
  });

  test("打开时标记放在最后，关闭时去掉，其他标签顺序不变", () => {
    expect(setNsfwTag(["恐怖", "游戏"], true)).toEqual(["恐怖", "游戏", "<__NSFW__>"]);
    // 已经有了不重复加，位置归到最后
    expect(setNsfwTag(["<__NSFW__>", "恐怖", "游戏"], true)).toEqual(["恐怖", "游戏", "<__NSFW__>"]);
    expect(setNsfwTag(["恐怖", "<__NSFW__>", "游戏"], false)).toEqual(["恐怖", "游戏"]);
    expect(setNsfwTag(["恐怖"], false)).toEqual(["恐怖"]);
  });

  test("标记不含目录 CSV 与标签输入用到的分隔符", () => {
    // 目录行按逗号分列、分号分标签；表单还把全角逗号分号当分隔符
    expect(/[,;，；]/.test(NSFW_TAG)).toBe(false);
  });
});

describe("敏感内容原因（manifest ext.nsfw.reason）", () => {
  test("读写原因时保留 ext 里的其他键", () => {
    const ext = JSON.stringify({ enableAstroBoxCreatorFeatures: true, forceUpdate: { version: "1.0" } });
    const next = writeNsfwReason(ext, "含血腥画面");
    expect(JSON.parse(next)).toEqual({
      enableAstroBoxCreatorFeatures: true,
      forceUpdate: { version: "1.0" },
      nsfw: { reason: "含血腥画面" },
    });
    expect(readNsfwReason(next)).toBe("含血腥画面");
  });

  test("关闭时整个 nsfw 键删掉", () => {
    const ext = JSON.stringify({ nsfw: { reason: "恐怖元素" }, other: 1 });
    expect(JSON.parse(writeNsfwReason(ext, null))).toEqual({ other: 1 });
    expect(writeNsfwReason(JSON.stringify({ nsfw: { reason: "恐怖元素" } }), null)).toBe("{}");
  });

  test("空的或不合法的 ext 文本", () => {
    expect(readNsfwReason("")).toBe("");
    expect(readNsfwReason("{ 不是 json")).toBe("");
    expect(readNsfwReason("[]")).toBe("");
    expect(JSON.parse(writeNsfwReason("", "恐怖元素"))).toEqual({ nsfw: { reason: "恐怖元素" } });
    // 写坏了的 JSON 不动它，交给表单自己的报错
    expect(writeNsfwReason("{ 不是 json", "恐怖元素")).toBe("{ 不是 json");
  });

  test("刚打开开关时原因为空串，也要落进 ext（与标记成对）", () => {
    expect(JSON.parse(writeNsfwReason("{}", ""))).toEqual({ nsfw: { reason: "" } });
  });

  test("原因按码点截断到上限", () => {
    const long = "😱".repeat(NSFW_REASON_MAX + 30);
    const stored = readNsfwReason(writeNsfwReason("{}", long));
    expect(Array.from(stored)).toHaveLength(NSFW_REASON_MAX);
    // 没有把代理对切成两半
    expect(stored.endsWith("😱")).toBe(true);
  });
});

describe("敏感内容声明核对", () => {
  test("没声明就没有问题", () => {
    expect(inspectNsfw(["a", "b"], {})).toEqual({ tagged: false, reason: "", problems: [] });
    expect(inspectNsfw(["a", "b"], undefined).problems).toEqual([]);
  });

  test("标记与原因成对才算完整", () => {
    expect(inspectNsfw(["a", "<__NSFW__>"], { nsfw: { reason: " 含血腥画面 " } })).toEqual({
      tagged: true,
      reason: "含血腥画面",
      problems: [],
    });
  });

  test("只有标记没有原因", () => {
    for (const ext of [{}, undefined, { nsfw: {} }, { nsfw: { reason: "  " } }]) {
      const result = inspectNsfw(["<__NSFW__>"], ext);
      expect(result.tagged).toBe(true);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("没有填写原因");
    }
  });

  test("只有原因没有标记", () => {
    const result = inspectNsfw(["a"], { nsfw: { reason: "含血腥画面" } });
    expect(result.tagged).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("<__NSFW__>");
  });

  test("写法不对的 ext.nsfw", () => {
    expect(inspectNsfw(["<__NSFW__>"], { nsfw: "血腥" }).problems[0]).toContain("需要是一个对象");
    expect(inspectNsfw(["<__NSFW__>"], { nsfw: { reason: 1 } }).problems[0]).toContain("需要是字符串");
  });

  test("手写 manifest 时原因超长", () => {
    const result = inspectNsfw(["<__NSFW__>"], { nsfw: { reason: "长".repeat(NSFW_REASON_MAX + 1) } });
    expect(result.problems.some((problem) => problem.includes("超过"))).toBe(true);
  });
});

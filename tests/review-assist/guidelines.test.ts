import { describe, expect, test } from "bun:test";
import {
  appendToDraft,
  composeReviewReply,
  formatCitation,
  guidelineLabel,
  guidelineQuote,
  indexGuidelines,
  resolveGuidelineRefs,
  searchGuidelines,
  type GuidelineNode,
  type ReviewGuidelines,
} from "../../app/logic/review-assist/guidelines";
import {
  composePresetReply,
  groupReviewPresets,
  presetCitationMode,
  validatePresetDraft,
  type ReviewPreset,
} from "../../app/logic/review-assist/presets";

const CONTENT = "https://abox.run/docs/creator-tools/resource-std/content";
const INFO = "https://abox.run/docs/creator-tools/resource-std/info";

const node = (
  ref: string,
  number: string | null,
  title: string,
  text: string,
  url: string,
  children: GuidelineNode[] = [],
): GuidelineNode => ({ ref, number, title, text, url, children });

// 与服务端 guidelines-parse.ts 产出的结构一致
const guidelines: ReviewGuidelines = {
  revision: "a".repeat(40),
  fetchedAt: "2026-11-14T00:00:00.000Z",
  stale: false,
  documents: [
    {
      id: "content",
      title: "资源内容规范",
      description: "",
      url: CONTENT,
      root: node("content", null, "资源内容规范", "导语", CONTENT, [
        node("content#自动检查项", null, "自动检查项", "未通过的项目会被要求修改：\n\n| 检查项 | 要求 |\n| --- | --- |\n| 封面 | 严格为 3:2 |\n\n通过了全部自动检查，并不代表一定能过审。", `${CONTENT}#自动检查项`),
        node("2", "2", "性能", "", `${CONTENT}#2-性能`, [
          node("2.6", "2.6", "打包要求", "", `${CONTENT}#26-打包要求`, [
            node("2.6.2", "2.6.2", "打包要求", "快应用不接收 Debug 包体。请使用正式发布命令（`aiot release`）打包。", `${CONTENT}#26-打包要求`),
            node("2.6.3", "2.6.3", "打包要求", "快应用包体内的包名必须与资源 ID 一致。", `${CONTENT}#26-打包要求`),
          ]),
        ]),
        node("4", "4", "设计", "我们认为，用户看重简单、精致的资源。", `${CONTENT}#4-设计`, [
          node("4.5", "4.5", "设计质量", "视觉质量是审核的一部分。\n\n如果你对封面设计缺乏经验，可以先阅读封面小指南。", `${CONTENT}#45-设计质量`),
        ]),
      ]),
    },
    {
      id: "info",
      title: "资源基本信息规范",
      description: "",
      url: INFO,
      root: node("info", null, "资源基本信息规范", "以下是必要规范：", INFO, [
        node("info#封面", null, "封面", "封面是资源在列表对外展示的第一要素。", `${INFO}#封面`, [
          node("info#硬性要求", null, "硬性要求", "封面的硬性要求是比例必须为`3:2`，推荐尺寸为`1200 x 800`。", `${INFO}#硬性要求`),
        ]),
      ]),
    },
    {
      id: "rate",
      title: "资源比例要求",
      description: "",
      url: "https://abox.run/docs/creator-tools/resource-std/rate",
      root: node("rate", null, "资源比例要求", "免费资源数量必须是付费资源的 2 倍以上。", "https://abox.run/docs/creator-tools/resource-std/rate"),
    },
  ],
};
const index = indexGuidelines(guidelines);
const entry = (ref: string) => index.get(ref)!;

describe("guideline index", () => {
  test("every node is reachable by its reference key", () => {
    expect([...index.keys()]).toEqual([
      "content",
      "content#自动检查项",
      "2",
      "2.6",
      "2.6.2",
      "2.6.3",
      "4",
      "4.5",
      "info",
      "info#封面",
      "info#硬性要求",
      "rate",
    ]);
    expect(entry("2.6.2").ancestors.map((item) => item.ref)).toEqual(["2", "2.6"]);
    expect(entry("info#封面").ancestors).toEqual([]);
    expect(indexGuidelines(null).size).toBe(0);
  });

  test("labels read the way reviewers cite them", () => {
    expect(guidelineLabel(entry("2.6.2"))).toBe("准则 2.6.2（打包要求）");
    expect(guidelineLabel(entry("2.6"))).toBe("准则 2.6 打包要求");
    expect(guidelineLabel(entry("4.5"))).toBe("准则 4.5 设计质量");
    expect(guidelineLabel(entry("content#自动检查项"))).toBe("《资源内容规范》· 自动检查项");
    expect(guidelineLabel(entry("info#硬性要求"))).toBe("《资源基本信息规范》· 封面 · 硬性要求");
    expect(guidelineLabel(entry("rate"))).toBe("《资源比例要求》");
  });

  test("unknown and duplicate references are reported, not dropped silently", () => {
    const resolved = resolveGuidelineRefs(index, ["2.6.2", " 2.6.2 ", "9.9.9", "", "rate"]);
    expect(resolved.entries.map((item) => item.node.ref)).toEqual(["2.6.2", "rate"]);
    expect(resolved.missing).toEqual(["9.9.9"]);
  });
});

describe("citations", () => {
  test("a numbered rule is quoted in full with its number", () => {
    expect(formatCitation(entry("2.6.2"), "violation")).toBe(
      `不符合[准则 2.6.2（打包要求）](${CONTENT}#26-打包要求)：\n\n` +
        "> **2.6.2** 快应用不接收 Debug 包体。请使用正式发布命令（`aiot release`）打包。",
    );
  });

  test("reference mode only changes the lead-in", () => {
    expect(formatCitation(entry("4.5"), "reference")).toBe(
      `请参考[准则 4.5 设计质量](${CONTENT}#45-设计质量)：\n\n` +
        "> 视觉质量是审核的一部分。\n>\n> 如果你对封面设计缺乏经验，可以先阅读封面小指南。",
    );
  });

  test("a section made only of numbered rules quotes those rules", () => {
    expect(guidelineQuote(entry("2.6"))).toBe(
      "**2.6.2** 快应用不接收 Debug 包体。请使用正式发布命令（`aiot release`）打包。\n\n" +
        "**2.6.3** 快应用包体内的包名必须与资源 ID 一致。",
    );
  });

  test("tables are left to the link instead of being squeezed into a quote", () => {
    const quote = guidelineQuote(entry("content#自动检查项"));
    expect(quote).toBe(
      "未通过的项目会被要求修改：\n\n通过了全部自动检查，并不代表一定能过审。\n\n……",
    );
  });

  test("long sections are cut at a paragraph boundary", () => {
    const long = indexGuidelines({
      documents: [
        {
          id: "cover-guide",
          title: "资源封面指南",
          description: "",
          url: "https://abox.run/blog/resource-cover-guide",
          root: node(
            "cover-guide",
            null,
            "资源封面指南",
            ["第一段。".repeat(80), "第二段。".repeat(80), "第三段。"].join("\n\n"),
            "https://abox.run/blog/resource-cover-guide",
          ),
        },
      ],
    }).get("cover-guide")!;
    const quote = guidelineQuote(long);
    expect(quote.startsWith("第一段。")).toBe(true);
    expect(quote.includes("第二段。")).toBe(false);
    expect(quote.endsWith("……")).toBe(true);
  });

  test("a node without any text is cited by link alone", () => {
    expect(formatCitation(entry("2"), "violation")).toBe(`不符合[准则 2 性能](${CONTENT}#2-性能)。`);
  });

  test("a reply lists the cited rules first, then the reviewer's own words", () => {
    const reply = composeReviewReply({
      entries: [entry("2.6.2"), entry("info#硬性要求")],
      mode: "violation",
      body: "  你上传的是 debug 包，封面也不是 3:2。  ",
    });
    expect(reply.split("\n\n")).toEqual([
      `不符合[准则 2.6.2（打包要求）](${CONTENT}#26-打包要求)：`,
      "> **2.6.2** 快应用不接收 Debug 包体。请使用正式发布命令（`aiot release`）打包。",
      `不符合[《资源基本信息规范》· 封面 · 硬性要求](${INFO}#硬性要求)：`,
      "> 封面的硬性要求是比例必须为`3:2`，推荐尺寸为`1200 x 800`。",
      "你上传的是 debug 包，封面也不是 3:2。",
    ]);
    expect(composeReviewReply({ entries: [], mode: "violation", body: "只有正文" })).toBe("只有正文");
    expect(composeReviewReply({ entries: [], mode: "violation" })).toBe("");
  });
});

describe("guideline search", () => {
  const refs = (query: string) => searchGuidelines(index, query).map((item) => item.node.ref);

  test("a number matches that clause and everything under it", () => {
    expect(refs("2.6")).toEqual(["2.6", "2.6.2", "2.6.3"]);
    expect(refs("2.6.")).toEqual(["2.6", "2.6.2", "2.6.3"]);
    expect(refs("2.6.3")).toEqual(["2.6.3"]);
    // 「2」不能把 4.5 里出现的数字也算进来
    expect(refs("4")).toEqual(["4", "4.5"]);
  });

  test("words match titles and text, all of them", () => {
    expect(refs("debug")).toEqual(["2.6.2"]);
    expect(refs("封面 比例")).toEqual(["info#硬性要求"]);
    expect(refs("不存在的词")).toEqual([]);
    expect(refs("  ")).toHaveLength(index.size);
  });
});

describe("draft editing", () => {
  test("inserted text is separated from what is already there", () => {
    expect(appendToDraft("", "  新内容  ")).toBe("新内容");
    expect(appendToDraft("已有内容\n\n", "新内容")).toBe("已有内容\n\n新内容");
    expect(appendToDraft("已有内容", "   ")).toBe("已有内容");
  });
});

describe("reply presets", () => {
  const preset = (over: Partial<ReviewPreset>): ReviewPreset => ({
    id: "p",
    title: "标题",
    category: "",
    body: "",
    rules: [],
    action: "needfix",
    sort: 0,
    updatedBy: "u",
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...over,
  });

  test("a preset expands its rules against the current docs", () => {
    const { text, missing } = composePresetReply(
      preset({ rules: ["2.6.2", "8.8.8"], body: "AstroBox 不接受 debug 包。" }),
      index,
    );
    expect(text).toBe(
      `不符合[准则 2.6.2（打包要求）](${CONTENT}#26-打包要求)：\n\n` +
        "> **2.6.2** 快应用不接收 Debug 包体。请使用正式发布命令（`aiot release`）打包。\n\n" +
        "AstroBox 不接受 debug 包。",
    );
    // 文档里已经没有的条款要让审核员知道
    expect(missing).toEqual(["8.8.8"]);
  });

  test("plain comments cite rules as references", () => {
    expect(presetCitationMode("comment")).toBe("reference");
    expect(presetCitationMode("needfix")).toBe("violation");
    expect(presetCitationMode("close")).toBe("violation");
    expect(presetCitationMode("refuse")).toBe("violation");
    expect(composePresetReply(preset({ rules: ["rate"], action: "comment" }), index).text.startsWith("请参考[《资源比例要求》]")).toBe(true);
  });

  test("presets are grouped by category in their saved order", () => {
    const groups = groupReviewPresets([
      preset({ id: "c", title: "关闭", category: "流程", action: "close", sort: 30 }),
      preset({ id: "a", title: "封面比例", category: "封面", sort: 10 }),
      preset({ id: "b", title: "封面质量", category: "封面", sort: 20 }),
      preset({ id: "d", title: "没分组的", category: "  ", sort: 40 }),
    ]);
    expect(groups.map((group) => [group.category, group.items.map((item) => item.id)])).toEqual([
      ["封面", ["a", "b"]],
      ["流程", ["c"]],
      ["未分组", ["d"]],
    ]);
  });

  test("searching looks at titles, bodies and cited rules", () => {
    const presets = [
      preset({ id: "a", title: "上传了 debug 包", category: "包体", rules: ["2.6.2"] }),
      preset({ id: "b", title: "封面质量过低", category: "封面", body: "建议使用 Figma 重新制作", rules: ["4.5"] }),
    ];
    const ids = (query: string) =>
      groupReviewPresets(presets, { query }).flatMap((group) => group.items.map((item) => item.id));
    expect(ids("DEBUG")).toEqual(["a"]);
    expect(ids("figma 封面")).toEqual(["b"]);
    expect(ids("4.5")).toEqual(["b"]);
    expect(ids("没有")).toEqual([]);
  });

  test("the close and refuse dialogs see their own presets first", () => {
    const groups = groupReviewPresets(
      [
        preset({ id: "a", title: "封面比例", category: "封面", sort: 10 }),
        preset({ id: "b", title: "功能单一", category: "内容", action: "refuse", sort: 20 }),
        preset({ id: "c", title: "界面质量", category: "内容", sort: 15 }),
        preset({ id: "d", title: "未回复关闭", category: "流程", action: "close", sort: 30 }),
      ],
      { preferred: ["refuse"] },
    );
    expect(groups.map((group) => [group.category, group.items.map((item) => item.id)])).toEqual([
      ["内容", ["b", "c"]],
      ["封面", ["a"]],
      ["流程", ["d"]],
    ]);
  });

  test("an empty preset cannot be saved", () => {
    const draft = { title: "标题", category: "", body: "", rules: [], action: "needfix" as const };
    expect(validatePresetDraft({ ...draft, title: " " })).toBe("请填写标题。");
    expect(validatePresetDraft(draft)).toBe("正文和引用的准则至少要有一项。");
    expect(validatePresetDraft({ ...draft, rules: ["4.5"] })).toBeNull();
    expect(validatePresetDraft({ ...draft, body: "正文" })).toBeNull();
  });
});

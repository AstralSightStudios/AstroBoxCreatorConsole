import { describe, expect, test } from "bun:test";
import {
  duplicateUpdateLogVersions,
  moveToSlot,
  nextUpdateLogVersion,
  reorderById,
  reorderDropTargetId,
} from "../../app/logic/publish/update-log-draft";

const entry = (id: string, version: string) => ({ id, version, content: "" });

describe("duplicateUpdateLogVersions", () => {
  test("去掉空白后相同的版本算重复", () => {
    const dupes = duplicateUpdateLogVersions([
      { version: "1.2.0" },
      { version: " 1.2.0 " },
      { version: "1.1.0" },
    ]);
    expect(dupes).toEqual(new Set(["1.2.0"]));
  });

  test("空版本号重复也会被找出来", () => {
    expect(
      duplicateUpdateLogVersions([{ version: "" }, { version: "  " }]),
    ).toEqual(new Set([""]));
  });

  test("版本各不相同则没有重复", () => {
    expect(
      duplicateUpdateLogVersions([{ version: "1.0.0" }, { version: "1.1.0" }])
        .size,
    ).toBe(0);
  });
});

describe("nextUpdateLogVersion", () => {
  test("默认使用当前导入包的版本号", () => {
    expect(nextUpdateLogVersion([{ version: "1.0.0" }], " 1.2.0 ")).toBe(
      "1.2.0",
    );
  });

  test("当前包版本已存在时留空，仍可继续添加", () => {
    expect(nextUpdateLogVersion([{ version: "1.2.0" }], "1.2.0")).toBe("");
  });

  test("空白差异也视为当前包版本已存在", () => {
    expect(nextUpdateLogVersion([{ version: " 1.2.0 " }], "1.2.0")).toBe("");
  });

  test("没有包版本时新条目版本号留空", () => {
    expect(nextUpdateLogVersion([{ version: "" }], "")).toBe("");
    expect(nextUpdateLogVersion([], "  ")).toBe("");
  });
});

describe("reorderById", () => {
  const rows = [entry("a", "1"), entry("b", "2"), entry("c", "3")];

  test("下移与相邻项交换", () => {
    expect(reorderById(rows, "a", "b").map((row) => row.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("上移与相邻项交换", () => {
    expect(reorderById(rows, "b", "a").map((row) => row.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("拖到最后一项时排到末尾", () => {
    expect(reorderById(rows, "a", "c").map((row) => row.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("拖到第一项时排到开头", () => {
    expect(reorderById(rows, "c", "a").map((row) => row.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("目标就是自己时保持原顺序", () => {
    expect(reorderById(rows, "b", "b")).toBe(rows);
  });
});

describe("moveToSlot", () => {
  const rows = ["a", "b", "c", "d"];

  test("放回原缝时顺序不变", () => {
    expect(moveToSlot(rows, 1, 1)).toBe(rows);
    expect(moveToSlot(rows, 0, 0)).toBe(rows);
    expect(moveToSlot(rows, 3, 3)).toBe(rows);
  });

  test("可以落到最前面，此时原来的第一条在它下面", () => {
    expect(moveToSlot(rows, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  test("可以落到最后面，此时原来的最后一条在它上面", () => {
    expect(moveToSlot(rows, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  test("落到两条中间", () => {
    expect(moveToSlot(rows, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("reorderDropTargetId", () => {
  test("插入位置夹在现有条目之间", () => {
    expect(reorderDropTargetId(["a", "b", "c"], 0)).toBe("a");
    expect(reorderDropTargetId(["a", "b", "c"], 2)).toBe("c");
  });

  test("越过最后一条时落在最后一条", () => {
    expect(reorderDropTargetId(["a", "b", "c"], 3)).toBe("c");
    expect(reorderDropTargetId(["a", "b", "c"], 99)).toBe("c");
  });

  test("空列表没有落点", () => {
    expect(reorderDropTargetId([], 0)).toBeNull();
  });
});

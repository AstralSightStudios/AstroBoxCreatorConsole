import { describe, expect, test } from "bun:test";
import {
  evaluateRatio,
  isPaidEntry,
  mergeIncomingResource,
  pickRatioAuthorName,
  type AuthorResourceInfo,
} from "../../app/routes/resreview/utils/paid-ratio";
import { deriveOriginalId } from "../../app/routes/resreview/utils";
import type { CatalogEntry } from "../../app/logic/publish/catalog";

function res(
  id: string,
  paidKind: AuthorResourceInfo["paidKind"],
  name = id,
): AuthorResourceInfo {
  return { id, name, paidKind };
}

describe("isPaidEntry", () => {
  test("paid 与 force_paid 视为付费", () => {
    expect(isPaidEntry("paid")).toBe(true);
    expect(isPaidEntry("force_paid")).toBe(true);
    expect(isPaidEntry("PAID")).toBe(true);
    expect(isPaidEntry(" force_paid ")).toBe(true);
  });

  test("空串、free、未知值均视为免费", () => {
    expect(isPaidEntry("")).toBe(false);
    expect(isPaidEntry("free")).toBe(false);
    expect(isPaidEntry(undefined)).toBe(false);
    expect(isPaidEntry("whatever")).toBe(false);
  });
});

describe("evaluateRatio", () => {
  test("2 免费 + 1 付费 合规", () => {
    const r = evaluateRatio([res("a", "paid"), res("b", "free"), res("c", "free")]);
    expect(r.compliant).toBe(true);
    expect(r.freeCount).toBe(2);
    expect(r.paidCount).toBe(1);
  });

  test("1 免费 + 1 付费 不合规", () => {
    const r = evaluateRatio([res("a", "free"), res("b", "paid")]);
    expect(r.compliant).toBe(false);
    if (r.compliant) throw new Error("unreachable");
    expect(r.freeCount).toBe(1);
    expect(r.paidCount).toBe(1);
    expect(r.reason).toContain("至少配 2 个免费资源");
  });

  test("判定与目录行序无关：付费行排在最前也按总量算", () => {
    // 旧实现按行序做前缀不变量，付费行在第一位就会直接判不合规。
    const rows = [res("paid_first", "paid"), res("free_b", "free"), res("free_c", "free")];
    const r = evaluateRatio(rows);
    expect(r.compliant).toBe(true);
    expect(r.freeCount).toBe(2);
    expect(r.paidCount).toBe(1);
  });

  test("2 免费 + 2 付费 不合规", () => {
    const r = evaluateRatio([
      res("f1", "free"),
      res("f2", "free"),
      res("p1", "paid"),
      res("p2", "paid"),
    ]);
    expect(r.compliant).toBe(false);
    if (r.compliant) throw new Error("unreachable");
    expect(r.reason).toContain("至少配 4 个免费资源");
  });

  test("0 付费 0 免费 合规", () => {
    const r = evaluateRatio([]);
    expect(r.compliant).toBe(true);
    expect(r.paidCount).toBe(0);
  });
});

describe("pickRatioAuthorName", () => {
  test("只取第一位声明绑定 AstroBox 的作者", () => {
    expect(
      pickRatioAuthorName([
        { name: " 第一作者 ", bindABAccount: true },
        { name: "联名者", bindABAccount: true },
      ]),
    ).toBe("第一作者");
  });

  test("跳过未声明绑定的作者", () => {
    expect(
      pickRatioAuthorName([
        { name: "路人甲" },
        { name: " 真作者 ", bindABAccount: true },
      ]),
    ).toBe("真作者");
  });

  test("没有绑定作者或输入非法时返回空串", () => {
    expect(pickRatioAuthorName([{ name: "路人甲" }])).toBe("");
    expect(pickRatioAuthorName([])).toBe("");
    expect(pickRatioAuthorName(undefined)).toBe("");
    expect(pickRatioAuthorName([{ name: "  ", bindABAccount: true }])).toBe("");
  });
});

describe("mergeIncomingResource", () => {
  test("新增付费资源：追加到末尾并计入", () => {
    const merged = mergeIncomingResource([res("f1", "free"), res("f2", "free")], {
      id: "new_paid",
      isPaid: true,
    });
    expect(merged.map((r) => r.id)).toEqual(["f1", "f2", "new_paid"]);
    expect(evaluateRatio(merged).compliant).toBe(true);
  });

  test("原位编辑免费转付费：原行被顶替，不重复计数", () => {
    const merged = mergeIncomingResource(
      [res("f1", "free"), res("f2", "free"), res("f3", "free")],
      { id: "f3", originalId: "f3", isPaid: true },
    );
    expect(merged.map((r) => r.id)).toEqual(["f1", "f2", "f3"]);
    expect(merged.filter((r) => r.paidKind === "paid")).toHaveLength(1);
    expect(evaluateRatio(merged).compliant).toBe(true);
  });

  test("编辑改 ID：旧行被摘掉，同一资源不会既算免费又算付费", () => {
    // 旧实现只按新 ID 匹配，认不出改名，旧行会作为免费残留。
    const merged = mergeIncomingResource(
      [res("f1", "free"), res("old_id", "free"), res("f3", "free")],
      { id: "new_id", originalId: "old_id", isPaid: true },
    );
    expect(merged.map((r) => r.id)).toEqual(["f1", "f3", "new_id"]);
    expect(merged.some((r) => r.id === "old_id")).toBe(false);
    const ratio = evaluateRatio(merged);
    expect(ratio.compliant).toBe(true);
    expect(ratio.freeCount).toBe(2);
    expect(ratio.paidCount).toBe(1);
  });

  test("编辑改 ID 且免费转付费：免费 -1 付费 +1，比例随之收紧", () => {
    const merged = mergeIncomingResource([res("f1", "free"), res("old_id", "free")], {
      id: "new_id",
      originalId: "old_id",
      isPaid: true,
    });
    const ratio = evaluateRatio(merged);
    expect(ratio.compliant).toBe(false);
    if (ratio.compliant) throw new Error("unreachable");
    expect(ratio.freeCount).toBe(1);
    expect(ratio.paidCount).toBe(1);
  });

  test("免费编辑顶替原付费行：付费 -1", () => {
    const merged = mergeIncomingResource(
      [res("f1", "free"), res("f2", "free"), res("p1", "paid")],
      { id: "p1", originalId: "p1", isPaid: false },
    );
    const ratio = evaluateRatio(merged);
    expect(ratio.compliant).toBe(true);
    expect(ratio.paidCount).toBe(0);
    expect(ratio.freeCount).toBe(3);
  });

  test("缺少 ID 时占位为待提交", () => {
    const merged = mergeIncomingResource([], { isPaid: true });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("(待提交)");
    expect(merged[0].pending).toBe(true);
  });
});

describe("deriveOriginalId", () => {
  function catalogRow(id: string): CatalogEntry {
    return {
      id,
      name: id,
      restype: "watchface",
      repo_owner: "o",
      repo_name: "r",
      repo_commit_hash: "abc1234",
      icon: "",
      cover: "",
      tags: "",
      device_vendors: "",
      devices: "",
      paid_type: "",
    };
  }

  test("同 ID 的删除行即原位编辑", () => {
    expect(deriveOriginalId(catalogRow("same"), [catalogRow("same")])).toBe("same");
  });

  test("整个 diff 只删一行时认定改 ID 编辑", () => {
    expect(deriveOriginalId(catalogRow("new_id"), [catalogRow("old_id")])).toBe("old_id");
  });

  test("多条删除行且无法关联时放弃推断", () => {
    expect(
      deriveOriginalId(catalogRow("new_id"), [catalogRow("old_a"), catalogRow("old_b")]),
    ).toBeUndefined();
  });

  test("没有删除行说明是新增资源", () => {
    expect(deriveOriginalId(catalogRow("new_id"), [])).toBeUndefined();
  });
});

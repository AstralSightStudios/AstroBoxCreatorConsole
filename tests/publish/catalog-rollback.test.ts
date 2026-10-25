import { describe, expect, test } from "bun:test";
import {
  buildRollbackTargets,
  planCatalogRollback,
  selectRollbackTargets,
  validateRollbackCatalog,
} from "../../app/logic/publish/catalog-rollback";
import {
  parseCatalogCsv,
  serializeCatalogEntry,
  type CatalogEntry,
} from "../../app/logic/publish/catalog";

const HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "demo",
    name: "Demo",
    restype: "watchface",
    repo_owner: "octocat",
    repo_name: "astrobox-resource-demo",
    repo_commit_hash: "old1111",
    icon: "media/icon.png",
    cover: "media/cover.png",
    tags: "old",
    device_vendors: "xiaomi",
    devices: "xmrw6",
    paid_type: "",
    ...overrides,
  };
}

function csv(entries: CatalogEntry[]) {
  return `${[HEADER, ...entries.map(serializeCatalogEntry)].join("\n")}\n`;
}

function ids(value: string) {
  return parseCatalogCsv(value).map((item) => item.id);
}

describe("planCatalogRollback", () => {
  const anchorA = entry({
    id: "anchor-a",
    name: "Anchor A",
    repo_name: "astrobox-resource-anchor-a",
  });
  const anchorC = entry({
    id: "anchor-c",
    name: "Anchor C",
    repo_name: "astrobox-resource-anchor-c",
  });

  test("新增资源回退时删除当前行", () => {
    const fresh = entry({
      id: "fresh",
      name: "Fresh",
      repo_name: "astrobox-resource-fresh",
    });
    const baseline = csv([anchorA, anchorC]);
    const current = csv([anchorA, anchorC, fresh]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [{ currentId: fresh.id, name: fresh.name, expected: fresh }],
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.changes).toEqual([
      { kind: "remove", id: "fresh", previousId: undefined, name: "Fresh" },
    ]);
    expect(ids(plan.nextCsv)).toEqual(["anchor-a", "anchor-c"]);
  });

  test("更新资源恢复旧行、旧字段与旧位置", () => {
    const oldRow = entry({ id: "demo", repo_commit_hash: "old1111", tags: "old" });
    const newRow = entry({ id: "demo", repo_commit_hash: "new2222", tags: "new" });
    const baseline = csv([anchorA, oldRow, anchorC]);
    const current = csv([anchorA, newRow, anchorC]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [
        {
          currentId: "demo",
          previousId: "demo",
          name: "Demo",
          expected: newRow,
        },
      ],
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.changes[0]?.kind).toBe("restore");
    const restored = parseCatalogCsv(plan.nextCsv);
    expect(restored.map((item) => item.id)).toEqual([
      "anchor-a",
      "demo",
      "anchor-c",
    ]);
    expect(restored[1].repo_commit_hash).toBe("old1111");
    expect(restored[1].tags).toBe("old");
  });

  test("编辑改 ID 时恢复旧 ID", () => {
    const oldRow = entry({
      id: "legacy",
      repo_name: "astrobox-resource-legacy",
    });
    const newRow = entry({
      id: "renamed",
      repo_name: "astrobox-resource-renamed",
      repo_commit_hash: "new2222",
    });
    const baseline = csv([anchorA, oldRow, anchorC]);
    const current = csv([anchorA, newRow, anchorC]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [
        {
          currentId: "renamed",
          previousId: "legacy",
          name: "Renamed",
          expected: newRow,
        },
      ],
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(ids(plan.nextCsv)).toEqual(["anchor-a", "legacy", "anchor-c"]);
  });

  test("当前行在合入后又被修改时整批报冲突", () => {
    const oldRow = entry({ id: "demo", repo_commit_hash: "old1111" });
    const newRow = entry({ id: "demo", repo_commit_hash: "new2222" });
    const laterRow = entry({
      id: "demo",
      repo_commit_hash: "later333",
      tags: "later",
    });
    const baseline = csv([anchorA, oldRow, anchorC]);
    const current = csv([anchorA, laterRow, anchorC]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [
        {
          currentId: "demo",
          previousId: "demo",
          name: "Demo",
          expected: newRow,
        },
      ],
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.reason).toContain("又被修改过");
  });

  test("当前行已经是回退状态时跳过写入", () => {
    const oldRow = entry({ id: "demo", repo_commit_hash: "old1111" });
    const newRow = entry({ id: "demo", repo_commit_hash: "new2222" });
    const baseline = csv([anchorA, oldRow, anchorC]);
    const current = csv([anchorA, oldRow, anchorC]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [
        {
          currentId: "demo",
          previousId: "demo",
          name: "Demo",
          expected: newRow,
        },
      ],
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.unchanged[0]?.reason).toContain("回退后的状态");
  });

  test("legacy diff 丢失旧 ID 时按资源仓库恢复基线行", () => {
    const oldRow = entry({
      id: "legacy",
      repo_name: "astrobox-resource-legacy",
      repo_commit_hash: "old1111",
    });
    const newRow = entry({
      id: "renamed",
      repo_name: "astrobox-resource-legacy",
      repo_commit_hash: "new2222",
    });
    const baseline = csv([anchorA, oldRow, anchorC]);
    const current = csv([anchorA, newRow, anchorC]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [
        {
          currentId: "renamed",
          name: "Renamed",
          expected: newRow,
          matchByRepo: true,
        },
      ],
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(ids(plan.nextCsv)).toEqual(["anchor-a", "legacy", "anchor-c"]);
  });

  test("基线为空时中止回退，避免把所有行误判成新增", () => {
    const fresh = entry({ id: "fresh" });
    expect(() =>
      planCatalogRollback({
        currentCsv: csv([fresh]),
        baselineCsv: "",
        targets: [{ currentId: "fresh", name: "Fresh", expected: fresh }],
      }),
    ).toThrow("合入前的目录文件为空");
  });

  test("当前目录存在无法解析的数据行时中止回退", () => {
    const fresh = entry({ id: "fresh", name: "Fresh" });
    const malformed = `${HEADER}\n${serializeCatalogEntry(fresh)}\nbroken,row\n`;
    expect(() =>
      planCatalogRollback({
        currentCsv: malformed,
        baselineCsv: csv([]),
        targets: [{ currentId: "fresh", name: "Fresh", expected: fresh }],
      }),
    ).toThrow("当前目录存在无法解析的数据行");
  });

  test("新增行已被后续修改时拒绝删除", () => {
    const fresh = entry({
      id: "fresh",
      repo_name: "astrobox-resource-fresh",
    });
    const later = { ...fresh, tags: "later" };
    const baseline = csv([anchorA, anchorC]);
    const current = csv([anchorA, anchorC, later]);

    const plan = planCatalogRollback({
      currentCsv: current,
      baselineCsv: baseline,
      targets: [{ currentId: "fresh", name: "Fresh", expected: fresh }],
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
  });
});

describe("buildRollbackTargets / selectRollbackTargets", () => {
  const createEntry = entry({
    id: "new-id",
    name: "New",
    repo_name: "astrobox-resource-new",
  });
  const editEntry = entry({
    id: "new-id-2",
    name: "Edited",
    repo_name: "astrobox-resource-edit",
  });

  test("staging 请求生成新增与编辑目标", () => {
    const targets = buildRollbackTargets([
      {
        entry: createEntry,
        request: { mode: "create", original_id: null },
      },
      {
        entry: editEntry,
        request: { mode: "edit", original_id: "old-id-2" },
      },
    ]);

    expect(targets).toHaveLength(2);
    expect(targets[0].previousId).toBeUndefined();
    expect(targets[1].previousId).toBe("old-id-2");
  });

  test("legacy 缺少旧 ID 时启用仓库兜底，staging 不启用", () => {
    const legacyTargets = buildRollbackTargets([
      { entry: createEntry, originalId: undefined },
    ]);
    const stagingTargets = buildRollbackTargets([
      {
        entry: createEntry,
        request: { mode: "create", original_id: null },
      },
    ]);

    expect(legacyTargets[0]?.matchByRepo).toBe(true);
    expect(stagingTargets[0]?.matchByRepo).toBe(false);
  });

  test("按资源 ID 只保留目标行，兼容旧 ID", () => {
    const targets = buildRollbackTargets([
      {
        entry: createEntry,
        request: { mode: "create", original_id: null },
      },
      {
        entry: editEntry,
        request: { mode: "edit", original_id: "old-id-2" },
      },
    ]);

    expect(selectRollbackTargets(targets, "new-id")).toHaveLength(1);
    expect(selectRollbackTargets(targets, "OLD-ID-2")[0]?.currentId).toBe(
      "new-id-2",
    );
    expect(selectRollbackTargets(targets, "missing")).toHaveLength(0);
    expect(selectRollbackTargets(targets)).toHaveLength(2);
  });
});

describe("validateRollbackCatalog", () => {
  test("拒绝重复资源 ID", () => {
    const duplicated = csv([
      entry({ id: "demo" }),
      entry({ id: "demo", repo_name: "astrobox-resource-demo-2" }),
    ]);
    expect(() => validateRollbackCatalog(duplicated)).toThrow("重复资源 ID");
  });

  test("拒绝重复资源仓库", () => {
    const duplicated = csv([
      entry({ id: "demo", repo_name: "astrobox-resource-demo" }),
      entry({ id: "demo-2", repo_name: "astrobox-resource-demo" }),
    ]);
    expect(() => validateRollbackCatalog(duplicated)).toThrow(
      "重复资源仓库",
    );
  });
});

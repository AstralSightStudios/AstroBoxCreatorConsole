import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();

(globalThis as any).window = globalThis;
(globalThis as any).localStorage = {
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

const {
  addCcNoticeFailures,
  clearCcNoticeFailures,
  loadCcNoticeFailures,
  removeCcNoticeFailure,
} = await import("../../app/logic/inbox/batch-failures");

function makeFailure(prNumber: number, title = `PR ${prNumber}`) {
  return {
    subtype: "review-closed" as const,
    prNumber,
    title,
    error: "发送失败",
    payload: {
      subtype: "review-closed" as const,
      prNumber,
      prUrl: "",
      userIds: ["u1"],
      title: "t",
      body: "b",
    },
    failedAt: "2026-10-17T00:00:00.000Z",
  };
}

describe("批量关闭通知失败台账", () => {
  beforeEach(() => {
    storage.clear();
  });

  test("新增后可读取", () => {
    addCcNoticeFailures([makeFailure(1), makeFailure(2)]);
    const items = loadCcNoticeFailures();
    expect(items.map((item) => item.prNumber).sort()).toEqual([1, 2]);
  });

  test("同一 PR 重复失败时覆盖而非堆叠", () => {
    addCcNoticeFailures([makeFailure(1, "first")]);
    addCcNoticeFailures([makeFailure(1, "second")]);
    const items = loadCcNoticeFailures();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("second");
  });

  test("忽略单条只移除该 PR", () => {
    addCcNoticeFailures([makeFailure(1), makeFailure(2)]);
    removeCcNoticeFailure({ subtype: "review-closed", prNumber: 1 });
    expect(loadCcNoticeFailures().map((item) => item.prNumber)).toEqual([2]);
  });

  test("全部忽略清空台账", () => {
    addCcNoticeFailures([makeFailure(1), makeFailure(2)]);
    clearCcNoticeFailures();
    expect(loadCcNoticeFailures()).toEqual([]);
  });

  test("空数组写入不产生副作用", () => {
    addCcNoticeFailures([makeFailure(1)]);
    addCcNoticeFailures([]);
    expect(loadCcNoticeFailures()).toHaveLength(1);
  });
});

import { describe, expect, test } from "bun:test";
import { clampPage, pageWindow, paginate } from "../../app/logic/pagination";

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe("paginate", () => {
  test("按页大小切片并给出显示区间", () => {
    const first = paginate(range(45), 1, 20);
    expect(first.items).toEqual(range(20));
    expect([first.page, first.pageCount, first.total, first.from, first.to]).toEqual([1, 3, 45, 1, 20]);

    const last = paginate(range(45), 3, 20);
    expect(last.items).toEqual([41, 42, 43, 44, 45]);
    expect([last.from, last.to]).toEqual([41, 45]);
  });

  test("空列表恒为第 1 页，区间为 0", () => {
    const empty = paginate([], 5, 20);
    expect(empty.items).toEqual([]);
    expect([empty.page, empty.pageCount, empty.total, empty.from, empty.to]).toEqual([1, 1, 0, 0, 0]);
  });

  test("页码越界时夹回合法范围（数据变少后不会停在空页）", () => {
    expect(paginate(range(5), 9, 20).page).toBe(1);
    expect(paginate(range(45), 9, 20).items).toEqual([41, 42, 43, 44, 45]);
    expect(paginate(range(45), 0, 20).page).toBe(1);
    expect(paginate(range(45), -3, 20).page).toBe(1);
    expect(paginate(range(45), Number.NaN, 20).page).toBe(1);
  });

  test("恰好整除时不多出空页", () => {
    const slice = paginate(range(40), 2, 20);
    expect(slice.pageCount).toBe(2);
    expect(slice.items).toEqual(range(40).slice(20));
  });

  test("非法页大小按 1 处理，不会除零", () => {
    expect(paginate(range(3), 1, 0).pageCount).toBe(3);
    expect(paginate(range(3), 1, Number.NaN).pageSize).toBe(1);
  });
});

describe("clampPage", () => {
  test("小数向下取整并夹到范围内", () => {
    expect(clampPage(2.9, 5)).toBe(2);
    expect(clampPage(99, 5)).toBe(5);
    expect(clampPage(1, 0)).toBe(1);
  });
});

describe("pageWindow", () => {
  test("页数不多时全部列出", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual(range(7));
  });

  test("页数多时首尾常驻、两侧折叠，且长度固定", () => {
    expect(pageWindow(1, 25)).toEqual([1, 2, 3, 4, 5, "gap", 25]);
    expect(pageWindow(4, 25)).toEqual([1, 2, 3, 4, 5, "gap", 25]);
    expect(pageWindow(5, 25)).toEqual([1, "gap", 4, 5, 6, "gap", 25]);
    expect(pageWindow(13, 25)).toEqual([1, "gap", 12, 13, 14, "gap", 25]);
    expect(pageWindow(21, 25)).toEqual([1, "gap", 20, 21, 22, "gap", 25]);
    expect(pageWindow(22, 25)).toEqual([1, "gap", 21, 22, 23, 24, 25]);
    expect(pageWindow(25, 25)).toEqual([1, "gap", 21, 22, 23, 24, 25]);

    for (let page = 1; page <= 25; page += 1) {
      expect(pageWindow(page, 25)).toHaveLength(7);
    }
  });

  test("当前页一定在窗口里，且页码单调不重复", () => {
    for (const count of [8, 9, 20, 100]) {
      for (let page = 1; page <= count; page += 1) {
        const numbers = pageWindow(page, count).filter((item): item is number => item !== "gap");
        expect(numbers).toContain(page);
        expect(numbers[0]).toBe(1);
        expect(numbers[numbers.length - 1]).toBe(count);
        expect(new Set(numbers).size).toBe(numbers.length);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      }
    }
  });

  test("省略位只替代至少一页，不会出现「1 … 2」这种无意义省略", () => {
    for (let page = 1; page <= 25; page += 1) {
      const items = pageWindow(page, 25);
      items.forEach((item, index) => {
        if (item !== "gap") return;
        const before = items[index - 1] as number;
        const after = items[index + 1] as number;
        expect(after - before).toBeGreaterThan(1);
      });
    }
  });

  test("页码越界时按夹取后的页处理", () => {
    expect(pageWindow(99, 25)).toEqual(pageWindow(25, 25));
    expect(pageWindow(0, 25)).toEqual(pageWindow(1, 25));
  });
});

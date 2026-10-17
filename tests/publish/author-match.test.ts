import { describe, expect, test } from "bun:test";
import {
  authorNameFromSearchResult,
  collectBoundAuthorNames,
  collectUnboundAuthorNames,
  hasBoundAuthor,
  normalizeAuthorList,
  normalizeAuthorName,
  unboundAuthorNotice,
  withBoundFirstAuthor,
} from "../../app/logic/publish/author-match";

describe("作者绑定口径", () => {
  test("只有声明关联账号且名称非空的署名算已关联", () => {
    const authors = [
      { name: "Alice", bindABAccount: true },
      { name: "Bob", bindABAccount: false },
      { name: "   ", bindABAccount: true },
    ];
    expect(collectBoundAuthorNames(authors)).toEqual(["Alice"]);
    expect(collectUnboundAuthorNames(authors)).toEqual(["Bob"]);
    expect(hasBoundAuthor(authors)).toBe(true);
  });

  test("一个都没关联时 hasBoundAuthor 为 false", () => {
    expect(hasBoundAuthor([{ name: "Bob", bindABAccount: false }])).toBe(false);
    expect(hasBoundAuthor([])).toBe(false);
    expect(hasBoundAuthor(undefined)).toBe(false);
    // 名称为空的绑定声明不算：buildManifest 会把空名作者过滤掉，等于什么都没关联。
    expect(hasBoundAuthor([{ name: " ", bindABAccount: true }])).toBe(false);
  });

  test("容忍脏数据：非数组、null 条目、缺字段", () => {
    expect(normalizeAuthorList(undefined)).toEqual([]);
    expect(normalizeAuthorList([null, { name: 1 }, { name: "ok" }])).toEqual([
      { name: "ok" },
    ]);
    expect(collectBoundAuthorNames(null)).toEqual([]);
    expect(normalizeAuthorName("  AlIce ")).toBe("alice");
  });

  test("同名重复只报一次", () => {
    const authors = [
      { name: " Alice ", bindABAccount: true },
      { name: "Alice", bindABAccount: true },
    ];
    expect(collectBoundAuthorNames(authors)).toEqual(["Alice"]);
  });
});

describe("withBoundFirstAuthor", () => {
  test("第一个作者未绑定时补齐，其余原样保留", () => {
    // 历史 manifest 没写 bindABAccount，回填出来是 false。
    expect(
      withBoundFirstAuthor([
        { name: "Alice", bindABAccount: false },
        { name: "Bob", bindABAccount: false },
      ]),
    ).toEqual([
      { name: "Alice", bindABAccount: true },
      { name: "Bob", bindABAccount: false },
    ]);
  });

  test("删掉第一个作者后，原第二个上升并被补齐", () => {
    const remaining = [
      { name: "Bob", bindABAccount: false },
      { name: "Carol", bindABAccount: true },
    ];
    expect(withBoundFirstAuthor(remaining)[0].bindABAccount).toBe(true);
    expect(withBoundFirstAuthor(remaining)[1].bindABAccount).toBe(true);
  });

  test("已经是 true 时原样返回，不产生新引用", () => {
    const authors = [{ name: "Alice", bindABAccount: true }];
    expect(withBoundFirstAuthor(authors)).toBe(authors);
  });

  test("空列表保持为空", () => {
    expect(withBoundFirstAuthor([])).toEqual([]);
  });

  test("补齐后一定满足硬性要求", () => {
    expect(
      hasBoundAuthor(
        withBoundFirstAuthor([
          { name: "Alice", bindABAccount: false },
          { name: "Bob", bindABAccount: false },
        ]),
      ),
    ).toBe(true);
  });
});

describe("作者提醒文案", () => {
  test("有关联作者时不提醒", () => {
    expect(
      unboundAuthorNotice([{ name: "Alice", bindABAccount: true }]),
    ).toBeNull();
  });

  test("全部未关联时提醒并点名作者", () => {
    const notice = unboundAuthorNotice([
      { name: "Alice", bindABAccount: false },
      { name: "Bob", bindABAccount: false },
    ]);
    expect(notice).toContain("Alice");
    expect(notice).toContain("Bob");
    expect(notice).toContain("Creator Pro");
  });

  test("完全没有作者时也提醒", () => {
    expect(unboundAuthorNotice([])).toContain("没有关联 AstroBox 账号的作者");
  });
});

describe("从搜索结果取署名", () => {
  test("始终取 username，不用 displayName", () => {
    expect(
      authorNameFromSearchResult({ displayName: "星空", username: "star" }),
    ).toBe("star");
  });

  test("去掉首尾空白", () => {
    expect(authorNameFromSearchResult({ username: "  star  " })).toBe("star");
  });

  test("username 缺失或为空时得到空串", () => {
    expect(authorNameFromSearchResult({ displayName: "星空" })).toBe("");
    expect(authorNameFromSearchResult({ username: "   " })).toBe("");
    expect(authorNameFromSearchResult({})).toBe("");
  });
});
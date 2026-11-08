import { describe, expect, test } from "bun:test";
import {
  MAX_GITHUB_READERS,
  normalizeGithubReaders,
  type GithubReaderAccount,
} from "../../app/logic/account/store";

function reader(
  username: string,
  overrides: Partial<GithubReaderAccount> = {},
): GithubReaderAccount {
  return {
    avatar: `https://example.com/${username}.png`,
    username,
    token: `token-${username}`,
    scopes: ["read:user"],
    authType: "oauth",
    addedAt: 1,
    ...overrides,
  };
}

describe("normalizeGithubReaders", () => {
  test("保留合法条目并补齐名称", () => {
    const result = normalizeGithubReaders([reader("bob")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      username: "bob",
      name: "bob",
      token: "token-bob",
      authType: "oauth",
    });
  });

  test("按 username 去重且不区分大小写", () => {
    const result = normalizeGithubReaders([
      reader("Bob"),
      reader("bob", { token: "newer-token" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("Bob");
    expect(result[0].token).toBe("token-Bob");
  });

  test("剔除与主账号同名的条目", () => {
    const result = normalizeGithubReaders(
      [reader("alice"), reader("bob")],
      "Alice",
    );
    expect(result.map((item) => item.username)).toEqual(["bob"]);
  });

  test("丢弃缺少 token 或 username 的条目", () => {
    const result = normalizeGithubReaders([
      reader("bob", { token: "" }),
      reader("", { username: "   " }),
      { username: "carol" },
      null,
      "invalid",
    ]);
    expect(result).toEqual([]);
  });

  test("PAT 类型与过期日期可被保留", () => {
    const result = normalizeGithubReaders([
      reader("bob", {
        authType: "pat",
        expiresAt: "2027-01-01",
        name: "  Bob  ",
      }),
    ]);
    expect(result[0]).toMatchObject({
      username: "bob",
      name: "Bob",
      authType: "pat",
      expiresAt: "2027-01-01",
    });
  });

  test("限制读取账号数量", () => {
    const input = Array.from({ length: MAX_GITHUB_READERS + 3 }, (_, index) =>
      reader(`reader-${index}`),
    );
    expect(normalizeGithubReaders(input)).toHaveLength(MAX_GITHUB_READERS);
  });

  test("非数组输入返回空数组", () => {
    expect(normalizeGithubReaders(undefined)).toEqual([]);
    expect(normalizeGithubReaders(null)).toEqual([]);
    expect(normalizeGithubReaders({})).toEqual([]);
  });
});

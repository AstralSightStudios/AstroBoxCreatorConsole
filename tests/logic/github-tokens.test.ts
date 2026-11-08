import { beforeEach, describe, expect, test } from "bun:test";
import {
  applyGithubRateLimitHeaders,
  applyGithubRateLimitPayload,
  clearGithubQuotas,
  getGithubQuota,
  resolveGithubAuthPurpose,
  selectGithubReadIdentity,
  type GithubAccountQuota,
  type GithubAccountRole,
  type GithubRequestIdentity,
} from "../../app/logic/account/github-tokens";

function identity(
  login: string,
  role: GithubAccountRole,
): GithubRequestIdentity {
  return {
    token: `token-${login}`,
    login,
    role,
    account: {
      avatar: "",
      username: login,
      token: `token-${login}`,
      scopes: [],
      authType: "pat",
      addedAt: 1,
    },
  };
}

function coreQuota(
  login: string,
  remaining: number,
  overrides: Partial<GithubAccountQuota> = {},
): [string, GithubAccountQuota] {
  return [
    login.toLowerCase(),
    {
      login,
      role: "reader",
      updatedAt: 1,
      core: { limit: 5000, remaining, resetAt: 10_000, used: 5000 - remaining },
      ...overrides,
    },
  ];
}

describe("resolveGithubAuthPurpose", () => {
  test("公开读请求按调用方要求走读取账号", () => {
    expect(
      resolveGithubAuthPurpose(
        "https://api.github.com/repos/o/r/pulls",
        "GET",
        "read",
      ),
    ).toBe("read");
    expect(
      resolveGithubAuthPurpose(
        "https://api.github.com/contents/a.png",
        "GET",
        "read",
      ),
    ).toBe("read");
    expect(
      resolveGithubAuthPurpose(
        "https://api.github.com/users/someone",
        "GET",
        "read",
      ),
    ).toBe("read");
  });

  test("写请求永远走主账号", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        resolveGithubAuthPurpose(
          "https://api.github.com/repos/o/r/pulls/1/merge",
          method,
          "read",
        ),
      ).toBe("primary");
    }
  });

  test("身份相关端点永远走主账号", () => {
    const urls = [
      "https://api.github.com/user",
      "https://api.github.com/user/emails",
      "https://api.github.com/repos/o/r/collaborators/alice/permission",
      "https://api.github.com/orgs/o/members?per_page=100",
      "https://api.github.com/notifications",
    ];
    for (const url of urls) {
      expect(resolveGithubAuthPurpose(url, "GET", "read")).toBe("primary");
    }
  });

  test("默认走主账号", () => {
    expect(
      resolveGithubAuthPurpose(
        "https://api.github.com/repos/o/r/pulls",
        "GET",
      ),
    ).toBe("primary");
  });
});

describe("selectGithubReadIdentity", () => {
  const primary = identity("alice", "primary");

  test("没有主账号时不使用读取账号", () => {
    expect(
      selectGithubReadIdentity({
        primary: null,
        readers: [identity("bob", "reader")],
        quotas: new Map(),
      }),
    ).toBeNull();
  });

  test("优先选择剩余额度最多的读取账号", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [identity("bob", "reader"), identity("carol", "reader")],
      quotas: new Map([
        coreQuota("bob", 3000),
        coreQuota("carol", 4200),
      ]),
    });
    expect(selected?.login).toBe("carol");
  });

  test("跳过已耗尽或失效的读取账号", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [identity("bob", "reader"), identity("carol", "reader")],
      quotas: new Map([
        coreQuota("bob", 0, { coreExhaustedUntil: 20_000 }),
        coreQuota("carol", 1000, { invalid: true }),
      ]),
      now: 15_000,
    });
    // 两个读取账号都不可用，回退到主账号。
    expect(selected?.role).toBe("primary");
  });

  test("跳过 exclude 中的读取账号", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [identity("bob", "reader"), identity("carol", "reader")],
      quotas: new Map([
        coreQuota("bob", 3000),
        coreQuota("carol", 4000),
      ]),
      exclude: new Set(["carol"]),
    });
    expect(selected?.login).toBe("bob");
  });

  test("读取账号全部耗尽时回退主账号", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [identity("bob", "reader")],
      quotas: new Map([
        coreQuota("bob", 0, { coreExhaustedUntil: 20_000 }),
        coreQuota("alice", 3000),
      ]),
      now: 15_000,
    });
    expect(selected?.login).toBe("alice");
    expect(selected?.role).toBe("primary");
  });

  test("主账号低于保留额度时不再回退", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [],
      quotas: new Map([coreQuota("alice", 100)]),
      primaryReadReserve: 200,
    });
    expect(selected).toBeNull();
  });

  test("允许关闭主账号回退", () => {
    const selected = selectGithubReadIdentity({
      primary,
      readers: [],
      quotas: new Map([coreQuota("alice", 3000)]),
      allowPrimaryFallback: false,
    });
    expect(selected).toBeNull();
  });
});

describe("applyGithubRateLimitHeaders", () => {
  beforeEach(() => {
    clearGithubQuotas();
  });

  test("写入 core 额度并记录耗尽时间", () => {
    const quota = applyGithubRateLimitHeaders(
      "bob",
      "reader",
      new Headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "100",
        "x-ratelimit-used": "5000",
        "x-ratelimit-resource": "core",
      }),
    );

    expect(quota?.core).toEqual({
      limit: 5000,
      remaining: 0,
      resetAt: 100_000,
      used: 5000,
    });
    expect(getGithubQuota("bob")?.coreExhaustedUntil).toBe(100_000);
  });

  test("search 资源只更新 search 桶", () => {
    applyGithubRateLimitHeaders(
      "bob",
      "reader",
      new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "12",
        "x-ratelimit-reset": "100",
        "x-ratelimit-resource": "search",
      }),
    );

    const quota = getGithubQuota("bob");
    expect(quota?.search?.remaining).toBe(12);
    expect(quota?.core).toBeUndefined();
  });

  test("缺少额度头时忽略", () => {
    expect(
      applyGithubRateLimitHeaders("bob", "reader", new Headers()),
    ).toBeNull();
  });
});

describe("applyGithubRateLimitPayload", () => {
  beforeEach(() => {
    clearGithubQuotas();
  });

  test("解析 core / search / graphql 并忽略未知桶", () => {
    applyGithubRateLimitPayload("bob", "reader", {
      resources: {
        core: { limit: 5000, remaining: 4000, reset: 100, used: 1000 },
        search: { limit: 30, remaining: 20, reset: 200, used: 10 },
        graphql: { limit: 5000, remaining: 4500, reset: 300, used: 500 },
        integration_manifest: {
          limit: 5000,
          remaining: 0,
          reset: 400,
          used: 5000,
        },
      },
    });

    const quota = getGithubQuota("bob");
    expect(quota?.core?.remaining).toBe(4000);
    expect(quota?.search?.remaining).toBe(20);
    expect(quota?.graphql?.remaining).toBe(4500);
    expect(quota?.coreExhaustedUntil).toBeUndefined();
  });
});

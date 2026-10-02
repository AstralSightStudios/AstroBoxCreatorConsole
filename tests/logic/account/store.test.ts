import { describe, expect, test, beforeEach } from "bun:test";

const STORAGE_KEY = "ACCOUNT_STATE_V2";
const store: Record<string, string> = {};

function setupBrowserMocks() {
    Object.defineProperty(globalThis, "localStorage", {
        value: {
            getItem: (key: string) => (key in store ? store[key] : null),
            setItem: (key: string, value: string) => {
                store[key] = String(value);
            },
            removeItem: (key: string) => {
                delete store[key];
            },
            clear: () => {
                for (const key in store) {
                    delete store[key];
                }
            },
        },
        writable: true,
        configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
        value: globalThis,
        writable: true,
        configurable: true,
    });
}

setupBrowserMocks();

import type { AstroboxAccount, GithubAccount } from "../../../app/logic/account/store";

// 浏览器存储模拟完成后加载账号模块。
const {
    loadAccountState,
    saveAccountState,
    getAstroboxRefreshToken,
    getAstroboxToken,
    setAstroboxTokens,
    setAstroboxAccount,
    setGithubAccount,
    hasRequiredAccounts,
    logoutAccount,
} = await import("../../../app/logic/account/store");

function clearStorage() {
    localStorage.clear();
    saveAccountState({});
}

function makeAccount(overrides?: Partial<AstroboxAccount>): AstroboxAccount {
    return {
        avatar: "",
        name: "Astro",
        username: "astro",
        plan: "pro",
        email: "astro@example.com",
        token: "access-token",
        refreshToken: "refresh-token",
        roles: [],
        activeSocialBan: null,
        ...overrides,
    };
}

describe("astrobox account storage", () => {
    beforeEach(() => {
        clearStorage();
    });

    test("stores and reads refresh token", () => {
        setAstroboxAccount(makeAccount({ refreshToken: "rt-42" }));

        expect(getAstroboxRefreshToken()).toBe("rt-42");
        expect(getAstroboxToken()).toBe("access-token");
    });

    test("normalizes legacy account missing refresh token", () => {
        saveAccountState({
            activeProvider: "astrobox",
            astrobox: {
                avatar: "",
                name: "Astro",
                plan: "pro",
                email: "astro@example.com",
                token: "legacy-token",
                roles: [],
            } as unknown as AstroboxAccount,
        });

        const state = loadAccountState();
        expect(state.astrobox?.token).toBe("legacy-token");
        expect(state.astrobox?.refreshToken).toBe("");
        expect(getAstroboxRefreshToken()).toBeUndefined();
    });

    test("setAstroboxTokens rotates token pair", () => {
        setAstroboxAccount(makeAccount({ token: "old-access", refreshToken: "old-refresh" }));

        const ok = setAstroboxTokens("new-access", "new-refresh");

        expect(ok).toBe(true);
        expect(getAstroboxToken()).toBe("new-access");
        expect(getAstroboxRefreshToken()).toBe("new-refresh");
    });

    test("setAstroboxTokens is a no-op when not logged in", () => {
        saveAccountState({});

        const ok = setAstroboxTokens("access", "refresh");

        expect(ok).toBe(false);
        expect(getAstroboxToken()).toBeUndefined();
        expect(getAstroboxRefreshToken()).toBeUndefined();
    });

    test("persists refresh token across reloads", () => {
        setAstroboxAccount(makeAccount({ refreshToken: "persisted-rt" }));

        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = JSON.parse(raw!);
        expect(parsed.astrobox.refreshToken).toBe("persisted-rt");
    });
});

describe("控制台必需账号", () => {
    const github: GithubAccount = {
        avatar: "",
        username: "creator",
        token: "github-token",
        scopes: [],
    };

    beforeEach(clearStorage);

    test("未登录或仅登录一个必需账号时不能进入", () => {
        expect(hasRequiredAccounts({})).toBe(false);
        expect(hasRequiredAccounts({ astrobox: makeAccount() })).toBe(false);
        expect(hasRequiredAccounts({ github })).toBe(false);
    });

    test("两个必需账号均登录后即可进入，无需爱发电账号", () => {
        setGithubAccount(github);
        expect(hasRequiredAccounts(loadAccountState())).toBe(false);

        setAstroboxAccount(makeAccount());
        expect(hasRequiredAccounts(loadAccountState())).toBe(true);
    });

    test("空令牌不能视为已登录", () => {
        expect(hasRequiredAccounts({ astrobox: makeAccount({ token: " " }), github })).toBe(false);
        expect(hasRequiredAccounts({ astrobox: makeAccount(), github: { ...github, token: "" } })).toBe(false);
    });

    test.each(["astrobox", "github"] as const)("退出 %s 后需重新完成登录", (provider) => {
        setAstroboxAccount(makeAccount());
        setGithubAccount(github);
        logoutAccount(provider);

        expect(hasRequiredAccounts(loadAccountState())).toBe(false);
    });
});

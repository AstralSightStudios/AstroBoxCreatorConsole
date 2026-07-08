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

import type { AstroboxAccount } from "../../../app/logic/account/store";

// Import the store module only after browser globals are mocked so that
// isBrowser() evaluates to true and localStorage-backed helpers work.
const {
    loadAccountState,
    saveAccountState,
    getAstroboxRefreshToken,
    getAstroboxToken,
    setAstroboxTokens,
    setAstroboxAccount,
} = await import("../../../app/logic/account/store");

function clearStorage() {
    localStorage.clear();
    saveAccountState({});
}

function makeAccount(overrides?: Partial<AstroboxAccount>): AstroboxAccount {
    return {
        avatar: "",
        name: "Astro",
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

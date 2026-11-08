import { useSyncExternalStore } from "react";

export type AccountProvider = "astrobox" | "github";

export interface AstroboxAccount {
    avatar: string;
    name: string;
    username: string;
    plan: string;
    email: string;
    token: string;
    refreshToken: string;
    roles: string[];
    activeSocialBan?: {
        id: string;
        reason: string;
        expiresAt: string | null;
    } | null;
}

export interface GithubAccount {
    avatar: string;
    username: string;
    name?: string;
    email?: string;
    token: string;
    scopes: string[];
    profileUrl?: string;
}

export type GithubReaderAuthType = "oauth" | "pat";

/**
 * 内容读取账号：只用于公开内容的读取请求，永远不参与写操作。
 * 独立于主账号 `github`，主账号仍负责审核、合并、评论和发布。
 */
export interface GithubReaderAccount {
    avatar: string;
    username: string;
    name?: string;
    token: string;
    scopes: string[];
    authType: GithubReaderAuthType;
    profileUrl?: string;
    addedAt: number;
    /** PAT 的提醒日期（ISO 日期）；OAuth 为空。GitHub API 不返回 PAT 过期时间。 */
    expiresAt?: string;
}

export const MAX_GITHUB_READERS = 10;

export interface AccountState {
    activeProvider?: AccountProvider;
    astrobox?: AstroboxAccount;
    github?: GithubAccount;
    /** 审核者专用的 GitHub 内容读取账号，仅用于分摊公开内容浏览的 API 额度。 */
    githubReaders?: GithubReaderAccount[];
}

export interface DisplayAccount {
    provider?: AccountProvider;
    name?: string;
    email?: string;
    plan?: string;
    avatar?: string;
    avatarFallback?: string;
    hasAstrobox: boolean;
    hasGithub: boolean;
}

const STORAGE_KEY = "ACCOUNT_STATE_V2";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedState: AccountState | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notifySubscribers() {
    subscribers.forEach((listener) => {
        listener();
    });
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;

    const handler = (event: StorageEvent) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedState = readStateFromStorage();
            notifySubscribers();
        }
    };

    window.addEventListener("storage", handler);
    storageListenerAttached = true;
}

function parseState(raw: string | null): AccountState | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        return normalizeState(parsed);
    } catch {
        return undefined;
    }
}

function normalizeGithubReader(input: unknown): GithubReaderAccount | null {
    if (!input || typeof input !== "object") return null;
    const raw = input as Partial<GithubReaderAccount>;
    const token = typeof raw.token === "string" ? raw.token : "";
    const username = typeof raw.username === "string" ? raw.username.trim() : "";
    if (!token || !username) return null;

    const avatar = typeof raw.avatar === "string" ? raw.avatar.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const profileUrl =
        typeof raw.profileUrl === "string" && raw.profileUrl.trim()
            ? raw.profileUrl.trim()
            : undefined;
    const authType: GithubReaderAuthType = raw.authType === "pat" ? "pat" : "oauth";
    const scopes = Array.isArray(raw.scopes)
        ? raw.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
    const addedAt =
        typeof raw.addedAt === "number" && Number.isFinite(raw.addedAt)
            ? raw.addedAt
            : Date.now();
    const expiresAt =
        typeof raw.expiresAt === "string" && raw.expiresAt.trim()
            ? raw.expiresAt.trim()
            : undefined;

    return {
        avatar,
        username,
        name: name || username,
        token,
        scopes,
        authType,
        profileUrl,
        addedAt,
        expiresAt,
    };
}

/** 纯函数：去重、剔除与主账号同名的条目，并限制数量。 */
export function normalizeGithubReaders(
    readers: unknown,
    primaryUsername?: string,
): GithubReaderAccount[] {
    if (!Array.isArray(readers)) return [];
    const primaryKey = primaryUsername?.trim().toLowerCase() ?? "";
    const seen = new Set<string>();
    const normalized: GithubReaderAccount[] = [];

    for (const item of readers) {
        const reader = normalizeGithubReader(item);
        if (!reader) continue;
        const key = reader.username.toLowerCase();
        if (key === primaryKey || seen.has(key)) continue;
        seen.add(key);
        normalized.push(reader);
        if (normalized.length >= MAX_GITHUB_READERS) break;
    }

    return normalized;
}

function normalizeState(state: AccountState | undefined): AccountState {
    if (!state) return {};

    const astrobox = state.astrobox
        ? {
              avatar: state.astrobox.avatar?.trim() || "",
              name: state.astrobox.name?.trim() || "",
              username: state.astrobox.username?.trim() || "",
              plan: state.astrobox.plan?.trim() || "",
              email: state.astrobox.email?.trim() || "",
              token: state.astrobox.token || "",
              refreshToken: state.astrobox.refreshToken || "",
              roles: Array.isArray(state.astrobox.roles)
                  ? state.astrobox.roles.filter((role): role is string => typeof role === "string")
                  : [],
              activeSocialBan: state.astrobox.activeSocialBan ?? null,
          }
        : undefined;

    const github = state.github
        ? {
              avatar: state.github.avatar?.trim() || "",
              username: state.github.username?.trim() || "",
              name: state.github.name?.trim() || state.github.username,
              email: state.github.email?.trim(),
              token: state.github.token || "",
              scopes: state.github.scopes || [],
              profileUrl: state.github.profileUrl,
          }
        : undefined;

    const githubReaders = normalizeGithubReaders(
        state.githubReaders,
        github?.username,
    );

    const activeProvider =
        state.activeProvider ??
        (astrobox ? "astrobox" : github ? "github" : undefined);

    return {
        activeProvider,
        astrobox,
        github,
        githubReaders,
    };
}

function readStateFromStorage(): AccountState {
    if (!isBrowser()) return {};

    const stored = parseState(localStorage.getItem(STORAGE_KEY));
    return stored || {};
}

export function loadAccountState(): AccountState {
    if (!cachedState) {
        cachedState = readStateFromStorage();
    }
    return cachedState;
}

export function saveAccountState(state: AccountState) {
    if (!isBrowser()) return;
    const normalized = normalizeState(state);
    cachedState = normalized;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    notifySubscribers();
}

export function setAstroboxAccount(account: AstroboxAccount): AccountState {
    const state = loadAccountState();
    const next: AccountState = {
        ...state,
        activeProvider: "astrobox",
        astrobox: account,
    };
    saveAccountState(next);
    return next;
}

export function setGithubAccount(account: GithubAccount): AccountState {
    const state = loadAccountState();
    const next: AccountState = {
        ...state,
        activeProvider: "github",
        github: account,
    };
    saveAccountState(next);
    return next;
}

/** 添加读取账号；同 username 会更新 token，不会重复添加。 */
export function addGithubReader(account: GithubReaderAccount): AccountState {
    const state = loadAccountState();
    const normalized = normalizeGithubReader(account);
    if (!normalized) {
        throw new Error("读取账号信息不完整。");
    }

    const primaryLogin = state.github?.username?.trim().toLowerCase() ?? "";
    if (normalized.username.toLowerCase() === primaryLogin) {
        throw new Error("不能把主账号添加为读取账号。");
    }

    const readers = state.githubReaders ?? [];
    const index = readers.findIndex(
        (reader) => reader.username.toLowerCase() === normalized.username.toLowerCase(),
    );
    const nextReaders =
        index >= 0
            ? readers.map((reader, readerIndex) =>
                  readerIndex === index
                      ? { ...normalized, addedAt: reader.addedAt }
                      : reader,
              )
            : [...readers, normalized].slice(0, MAX_GITHUB_READERS);

    const next: AccountState = { ...state, githubReaders: nextReaders };
    saveAccountState(next);
    return next;
}

export function removeGithubReader(username: string): AccountState {
    const state = loadAccountState();
    const key = username.trim().toLowerCase();
    const next: AccountState = {
        ...state,
        githubReaders: (state.githubReaders ?? []).filter(
            (reader) => reader.username.toLowerCase() !== key,
        ),
    };
    saveAccountState(next);
    return next;
}

export function updateGithubReaderToken(
    username: string,
    token: string,
    expiresAt?: string,
): AccountState {
    const state = loadAccountState();
    const key = username.trim().toLowerCase();
    const next: AccountState = {
        ...state,
        githubReaders: (state.githubReaders ?? []).map((reader) =>
            reader.username.toLowerCase() === key
                ? { ...reader, token, expiresAt: expiresAt ?? reader.expiresAt }
                : reader,
        ),
    };
    saveAccountState(next);
    return next;
}

export function logoutAccount(provider: AccountProvider) {
    const state = loadAccountState();

    const next: AccountState = {
        ...state,
        [provider]: undefined,
        ...(provider === "github" ? { githubReaders: [] } : {}),
    };

    const remainingProvider =
        provider === "astrobox" ? next.github : next.astrobox;
    next.activeProvider = remainingProvider
        ? provider === "astrobox"
            ? "github"
            : "astrobox"
        : undefined;

    saveAccountState(next);
}

export function getDisplayAccount(
    state: AccountState = loadAccountState(),
): DisplayAccount {
    const provider =
        state.activeProvider ??
        (state.astrobox ? "astrobox" : state.github ? "github" : undefined);
    const astroAvatar = state.astrobox?.avatar?.trim();
    const githubAvatar = state.github?.avatar?.trim();

    const displayName =
        provider === "astrobox"
            ? state.astrobox?.name ||
              state.github?.name ||
              state.github?.username ||
              ""
            : provider === "github"
              ? state.github?.name || state.github?.username || state.astrobox?.name
              : "";

    const email = state.astrobox?.email || state.github?.email || "";
    const plan = state.astrobox?.plan || "";

    const avatarPrimary = astroAvatar || githubAvatar || "";
    const avatarFallback =
        astroAvatar && githubAvatar && astroAvatar !== githubAvatar
            ? githubAvatar
            : "";

    return {
        provider,
        name: displayName,
        email,
        plan,
        avatar: avatarPrimary,
        avatarFallback,
        hasAstrobox: Boolean(state.astrobox),
        hasGithub: Boolean(state.github),
    };
}

export function getAstroboxToken(): string | undefined {
    return loadAccountState().astrobox?.token || undefined;
}

export function hasRequiredAccounts(state: AccountState): boolean {
    return Boolean(state.astrobox?.token?.trim() && state.github?.token?.trim());
}

export function getAstroboxRefreshToken(): string | undefined {
    return loadAccountState().astrobox?.refreshToken || undefined;
}

export function setAstroboxTokens(token: string, refreshToken: string): boolean {
    const state = loadAccountState();
    if (!state.astrobox) return false;

    const next: AccountState = {
        ...state,
        astrobox: {
            ...state.astrobox,
            token,
            refreshToken,
        },
    };
    saveAccountState(next);
    return true;
}

export function useAccountState(): AccountState {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadAccountState,
        () => ({}),
    );
}

export function useDisplayAccount(): DisplayAccount {
    const state = useAccountState();
    return getDisplayAccount(state);
}

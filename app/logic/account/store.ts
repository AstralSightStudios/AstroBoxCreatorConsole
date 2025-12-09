import { useSyncExternalStore } from "react";

export type AccountProvider = "astrobox" | "github";

export interface AstroboxAccount {
    avatar: string;
    name: string;
    plan: string;
    email: string;
    token: string;
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

export interface AccountState {
    activeProvider?: AccountProvider;
    astrobox?: AstroboxAccount;
    github?: GithubAccount;
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

function normalizeState(state: AccountState | undefined): AccountState {
    if (!state) return {};

    const astrobox = state.astrobox
        ? {
              avatar: state.astrobox.avatar?.trim() || "",
              name: state.astrobox.name?.trim() || "",
              plan: state.astrobox.plan?.trim() || "",
              email: state.astrobox.email?.trim() || "",
              token: state.astrobox.token || "",
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

    const activeProvider =
        state.activeProvider ??
        (astrobox ? "astrobox" : github ? "github" : undefined);

    return {
        activeProvider,
        astrobox,
        github,
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

export function logoutAccount(provider: AccountProvider) {
    const state = loadAccountState();

    const next: AccountState = {
        ...state,
        [provider]: undefined,
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

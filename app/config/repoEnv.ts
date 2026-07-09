import { useSyncExternalStore } from "react";

export type RepoEnvId = "testenv" | "official";

export interface RepoEnvDefinition {
    id: RepoEnvId;
    label: string;
    description: string;
    owner: string;
    repoName: string;
    defaultBranch: string;
    exploreFilePath: string;
}

export const REPO_ENVS: Record<RepoEnvId, RepoEnvDefinition> = {
    official: {
        id: "official",
        label: "AstroBox-Repo",
        description: "正式环境",
        owner: "AstralSightStudios",
        repoName: "AstroBox-Repo",
        defaultBranch: "main",
        exploreFilePath: "explore_v2.json",
    },
    testenv: {
        id: "testenv",
        label: "TestEnv",
        description: "测试环境",
        owner: "AstralSightStudios",
        repoName: "ABRepo-TestEnv",
        defaultBranch: "main",
        exploreFilePath: "explore_v2.json",
    },
};

const STORAGE_KEY = "ABCC_REPO_ENV_V1";
const DEFAULT_ENV: RepoEnvId = "official";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
let storageListenerAttached = false;
let cachedEnvId: RepoEnvId | undefined;

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readEnvFromStorage(): RepoEnvId {
    if (!isBrowser()) return DEFAULT_ENV;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "testenv" || raw === "official") return raw;
    return DEFAULT_ENV;
}

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function attachStorageListener() {
    if (!isBrowser() || storageListenerAttached) return;
    window.addEventListener("storage", (event) => {
        if (!event.key || event.key === STORAGE_KEY) {
            cachedEnvId = readEnvFromStorage();
            notifySubscribers();
        }
    });
    storageListenerAttached = true;
}

export function loadRepoEnvId(): RepoEnvId {
    if (!cachedEnvId) cachedEnvId = readEnvFromStorage();
    return cachedEnvId;
}

export function loadRepoEnv(): RepoEnvDefinition {
    return REPO_ENVS[loadRepoEnvId()];
}

export function saveRepoEnvId(id: RepoEnvId) {
    cachedEnvId = id;
    if (isBrowser()) localStorage.setItem(STORAGE_KEY, id);
    notifySubscribers();
}

export function useRepoEnvId(): RepoEnvId {
    attachStorageListener();
    return useSyncExternalStore(
        (listener) => {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        loadRepoEnvId,
        () => DEFAULT_ENV,
    );
}

export function useRepoEnv(): RepoEnvDefinition {
    return REPO_ENVS[useRepoEnvId()];
}



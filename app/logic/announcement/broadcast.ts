import { useSyncExternalStore } from "react";

/**
 * CreatorConsole 专属公告数据源（与 AstroBox-NG 的 boardcasts_v2cbt.json 完全隔离，
 * AstroBox 本体的公告不会出现在这里）。运营直接改 AstroBoxWebsite 仓库中的
 * public/boardcasts_abcc.json 并发布上线即可。
 */
export const BROADCAST_URLS = [
    "https://astrobox.online/boardcasts_abcc.json",
    "https://abox.run/boardcasts_abcc.json",
];

const FETCH_TIMEOUT_MS = 10_000;
const KEY_SEEN = "ABCC_BROADCAST_SEEN_V1";
const MAX_SEEN_ENTRIES = 50;

export interface BroadcastItem {
    title: string;
    content: string;
}

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** 稳定的轻量字符串哈希（FNV-1a 32 位），用于标识公告内容是否看过。 */
export function broadcastKey(item: BroadcastItem): string {
    const input = `${item.title}\u0000${item.content}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

function normalizeItems(raw: unknown): BroadcastItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((entry): BroadcastItem | null => {
            if (!entry || typeof entry !== "object") return null;
            const record = entry as Record<string, unknown>;
            const title =
                typeof record.title === "string" ? record.title.trim() : "";
            const content =
                typeof record.content === "string" ? record.content.trim() : "";
            if (!title && !content) return null;
            return { title: title || "公告", content };
        })
        .filter((entry): entry is BroadcastItem => entry !== null);
}

/** 依次尝试多个镜像源拉取公告列表；全部失败时抛出最后一个错误。 */
export async function fetchBroadcasts(): Promise<BroadcastItem[]> {
    let lastError: unknown;
    for (const url of BROADCAST_URLS) {
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            FETCH_TIMEOUT_MS,
        );
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return normalizeItems(await response.json());
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError ?? new Error("公告拉取失败。");
}

// --- 已看过的公告记忆（localStorage 持久化，避免每次启动重复弹窗） ---

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function readSeenKeys(): string[] {
    if (!isBrowser()) return [];
    try {
        const raw = localStorage.getItem(KEY_SEEN);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(parsed)
            ? parsed.filter((key): key is string => typeof key === "string")
            : [];
    } catch {
        return [];
    }
}

function writeSeenKeys(keys: string[]) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(KEY_SEEN, JSON.stringify(keys));
    } catch {
        // 存储不可用时静默忽略
    }
    notifySubscribers();
}

export function getSeenKeys(): string[] {
    return readSeenKeys();
}

export function isBroadcastSeen(item: BroadcastItem): boolean {
    return readSeenKeys().includes(broadcastKey(item));
}

export function markBroadcastSeen(item: BroadcastItem) {
    const key = broadcastKey(item);
    const seen = readSeenKeys();
    if (seen.includes(key)) return;
    seen.push(key);
    // 只保留最近的若干条，避免无限增长
    writeSeenKeys(seen.slice(-MAX_SEEN_ENTRIES));
}

export function filterUnseen(
    items: BroadcastItem[],
): BroadcastItem[] {
    const seen = new Set(readSeenKeys());
    return items.filter((item) => !seen.has(broadcastKey(item)));
}

function subscribe(listener: Subscriber) {
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
}

/** 响应式读取已看公告 key 列表（当前仅调试/扩展用）。 */
export function useBroadcastSeenKeys(): string[] {
    return useSyncExternalStore(subscribe, getSeenKeys, () => []);
}

import { useSyncExternalStore } from "react";
import { githubFetch, isGithubStatus } from "~/logic/publish/github-actions";

export const UPDATE_REPO = "AstralSightStudios/AstroBoxCreatorConsole";

const KEY_IGNORED_TAG = "ABCC_UPDATE_IGNORED_TAG_V1";
const KEY_CHECK_DISABLED = "ABCC_UPDATE_CHECK_DISABLED_V1";

export interface UpdateInfo {
    tagName: string;
    name: string;
    htmlUrl: string;
    body: string;
    publishedAt: string;
}

interface LatestReleaseResponse {
    tag_name?: unknown;
    name?: unknown;
    html_url?: unknown;
    body?: unknown;
    published_at?: unknown;
}

// --- Beta update (GitHub Actions artifacts) ---

export interface BetaArtifactInfo {
    runId: number;
    runNumber: number;
    workflowName: string;
    artifactName: string;
    artifactUrl: string;
    artifactSize: number;
    createdAt: string;
    updatedAt: string;
    htmlUrl: string;
}

interface WorkflowRunResponse {
    id?: unknown;
    run_number?: unknown;
    name?: unknown;
    html_url?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    conclusion?: unknown;
}

interface ArtifactsResponse {
    artifacts?: Array<{
        id?: unknown;
        name?: unknown;
        size_in_bytes?: unknown;
        archive_download_url?: unknown;
        created_at?: unknown;
        updated_at?: unknown;
    }>;
}

function isBrowser() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** 是否运行在 Tauri 桌面/移动端壳内（浏览器直开时更新检测不可用）。 */
export function isTauriRuntime(): boolean {
    return (
        isBrowser() &&
        !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    );
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** 去掉版本号开头的 v/V 前缀。 */
export function normalizeVersion(version: string): string {
    return (version || "").trim().replace(/^[vV]/, "");
}

/**
 * 比较两个点分数字版本号（如 "1.2.10" 与 "v1.3"）。
 * 返回负数表示 a < b，正数表示 a > b，0 表示相等；缺失段按 0 补齐。
 */
export function compareVersions(a: string, b: string): number {
    const pa = normalizeVersion(a).split(".");
    const pb = normalizeVersion(b).split(".");
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const sa = pa[i] ?? "0";
        const sb = pb[i] ?? "0";
        const na = Number(sa);
        const nb = Number(sb);
        if (Number.isFinite(na) && Number.isFinite(nb)) {
            if (na !== nb) return na < nb ? -1 : 1;
            continue;
        }
        // 非纯数字段（如预发布后缀）退化为字符串比较
        if (sa !== sb) return sa < sb ? -1 : 1;
    }
    return 0;
}

/**
 * 拉取仓库最新正式 release（/releases/latest 天然排除 draft 与 prerelease）。
 * 仓库尚无 release 时返回 null，网络错误向上抛出。
 */
export async function fetchLatestRelease(): Promise<UpdateInfo | null> {
    try {
        const raw = await githubFetch<LatestReleaseResponse>(
            `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
            { headers: {} },
            // 后台静默检查：不重试、短超时，失败即放弃
            { retries: 0, timeoutMs: 15_000 },
        );
        const tagName = readString(raw?.tag_name);
        if (!tagName) return null;
        return {
            tagName,
            name: readString(raw?.name) || tagName,
            htmlUrl:
                readString(raw?.html_url) ||
                `https://github.com/${UPDATE_REPO}/releases/tag/${encodeURIComponent(tagName)}`,
            body: readString(raw?.body),
            publishedAt: readString(raw?.published_at),
        };
    } catch (error) {
        if (isGithubStatus(error, 404)) return null;
        throw error;
    }
}

/** 若 latest 比当前版本新则返回 UpdateInfo，否则 null。 */
export async function checkForUpdate(
    currentVersion: string,
): Promise<UpdateInfo | null> {
    const latest = await fetchLatestRelease();
    if (!latest) return null;
    return compareVersions(latest.tagName, currentVersion) > 0 ? latest : null;
}

// --- Beta update (GitHub Actions artifacts) ---

// 结果缓存：避免启动自动检查与设置页手动检查在短时间内重复打 GitHub API。
const ARTIFACT_CACHE_TTL_MS = 5 * 60_000;
let artifactCache: { at: number; value: BetaArtifactInfo | null } | null = null;
let artifactInflight: Promise<BetaArtifactInfo | null> | null = null;

async function requestLatestArtifact(): Promise<BetaArtifactInfo | null> {
    try {
        // 获取最近的工作流运行（按创建时间倒序）
        const runs = await githubFetch<{ workflow_runs?: WorkflowRunResponse[] }>(
            `https://api.github.com/repos/${UPDATE_REPO}/actions/runs?per_page=10&status=completed`,
            { headers: {} },
            // 后台静默检查：不重试、短超时，失败即放弃
            { retries: 0, timeoutMs: 15_000 },
        );

        const runsList = runs?.workflow_runs ?? [];
        // 找到最近一次成功的运行
        const successRun = runsList.find(
            (run) => readString(run.conclusion) === "success",
        );
        if (!successRun) return null;

        const runId = Number(successRun.id);
        const runNumber = Number(successRun.run_number);
        const workflowName = readString(successRun.name);
        const htmlUrl = readString(successRun.html_url);
        const createdAt = readString(successRun.created_at);
        const updatedAt = readString(successRun.updated_at);

        if (!Number.isFinite(runId) || runId <= 0) return null;

        // 获取该运行的 artifacts
        const artifacts = await githubFetch<ArtifactsResponse>(
            `https://api.github.com/repos/${UPDATE_REPO}/actions/runs/${runId}/artifacts`,
            { headers: {} },
            { retries: 0, timeoutMs: 15_000 },
        );

        const artifactList = artifacts?.artifacts ?? [];
        // 优先选择可下载的产物
        const artifact = artifactList.find((item) => {
            const url = readString(item.archive_download_url);
            return Boolean(url);
        });
        if (!artifact) return null;

        const artifactName = readString(artifact.name);
        const artifactUrl = readString(artifact.archive_download_url);
        const artifactSize = Number(artifact.size_in_bytes) || 0;

        if (!artifactName || !artifactUrl) return null;

        return {
            runId,
            runNumber: Number.isFinite(runNumber) ? runNumber : 0,
            workflowName: workflowName || "CI Build",
            artifactName,
            artifactUrl,
            artifactSize,
            createdAt,
            updatedAt,
            htmlUrl:
                htmlUrl ||
                `https://github.com/${UPDATE_REPO}/actions/runs/${runId}`,
        };
    } catch (error) {
        if (isGithubStatus(error, 404)) return null;
        throw error;
    }
}

/**
 * 获取最新的成功工作流运行及其 artifacts。
 * 默认命中 5 分钟缓存；传入 `{ force: true }` 绕过缓存（手动检查）。
 */
export async function fetchLatestArtifact(options?: {
    force?: boolean;
}): Promise<BetaArtifactInfo | null> {
    if (
        !options?.force &&
        artifactCache &&
        Date.now() - artifactCache.at < ARTIFACT_CACHE_TTL_MS
    ) {
        return artifactCache.value;
    }
    // 并发去重：同一时刻只发一轮请求
    if (artifactInflight) return artifactInflight;

    artifactInflight = requestLatestArtifact();
    try {
        const value = await artifactInflight;
        artifactCache = { at: Date.now(), value };
        return value;
    } finally {
        artifactInflight = null;
    }
}

// --- 忽略的 beta run / 本地存储 ---

const KEY_BETA_IGNORED_RUN = "ABCC_BETA_UPDATE_IGNORED_RUN_V1";

export function getIgnoredBetaRun(): number {
    const stored = readStorage(KEY_BETA_IGNORED_RUN);
    return stored ? Number(stored) : 0;
}

export function ignoreBetaRun(runId: number) {
    writeStorage(KEY_BETA_IGNORED_RUN, String(runId));
    notifySubscribers();
}

export function isBetaRunIgnored(runId: number): boolean {
    return runId > 0 && getIgnoredBetaRun() === runId;
}

// --- 忽略的版本 tag / 自动检查开关（localStorage 持久化） ---

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notifySubscribers() {
    subscribers.forEach((listener) => listener());
}

function readStorage(key: string): string {
    if (!isBrowser()) return "";
    try {
        return localStorage.getItem(key) ?? "";
    } catch {
        return "";
    }
}

function writeStorage(key: string, value: string) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(key, value);
    } catch {
        // 存储不可用（隐私模式等）时静默忽略
    }
}

export function getIgnoredTag(): string {
    return readStorage(KEY_IGNORED_TAG);
}

export function ignoreTag(tagName: string) {
    writeStorage(KEY_IGNORED_TAG, tagName);
    notifySubscribers();
}

export function isIgnored(tagName: string): boolean {
    return !!tagName && getIgnoredTag() === tagName;
}

export function isUpdateCheckDisabled(): boolean {
    return readStorage(KEY_CHECK_DISABLED) === "1";
}

export function setUpdateCheckDisabled(disabled: boolean) {
    writeStorage(KEY_CHECK_DISABLED, disabled ? "1" : "0");
    notifySubscribers();
}

function subscribe(listener: Subscriber) {
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
}

/** 设置页「自动检查更新」开关的响应式绑定。 */
export function useUpdateCheckDisabled(): [
    boolean,
    (disabled: boolean) => void,
] {
    const disabled = useSyncExternalStore(
        subscribe,
        isUpdateCheckDisabled,
        () => false,
    );
    return [disabled, setUpdateCheckDisabled];
}

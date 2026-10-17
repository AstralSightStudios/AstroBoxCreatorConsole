import { useSyncExternalStore } from "react";
import {
    githubFetch,
    isGithubStatus,
    optionalAuthHeaders,
} from "~/logic/publish/github-actions";
import {
    getInstalledBuildInfo,
    type InstalledBuildInfo,
} from "./build-info";

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

export type BetaPlatform = "windows" | "macos" | "linux" | "android";

export interface BetaArtifact {
    id: number;
    name: string;
    platform: BetaPlatform;
    /** 构建版本号；兼容旧命名时为空字符串。 */
    version: string;
    /** 该产物所属的 run attempt（用于识别 workflow 重跑）。 */
    attempt: number;
    size: number;
    downloadUrl: string;
    expiresAt: string;
}

export interface BetaArtifactInfo {
    runId: number;
    runNumber: number;
    runAttempt: number;
    workflowName: string;
    headSha: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
    /** 形如 `beta #170.1`。 */
    buildLabel: string;
    /** 构建版本号；旧产物或无法解析时为空字符串。 */
    version: string;
    /** 同一 attempt 下按平台去重后的可下载产物。 */
    artifacts: BetaArtifact[];
}

/** 当前安装的构建与候选构建的关系。 */
export type BetaComparison = "update" | "up-to-date" | "unknown";

export interface BetaUpdatePrompt {
    info: BetaArtifactInfo;
    comparison: BetaComparison;
    /** 当前安装构建的人类可读标识。 */
    currentBuildLabel: string;
}

export type BetaCheckResult =
    | { status: "available"; prompt: BetaUpdatePrompt }
    | { status: "up-to-date"; info: BetaArtifactInfo; currentBuildLabel: string }
    | { status: "none" };

interface WorkflowRepositoryRef {
    id?: unknown;
    full_name?: unknown;
}

interface WorkflowRunResponse {
    id?: unknown;
    run_number?: unknown;
    run_attempt?: unknown;
    name?: unknown;
    path?: unknown;
    head_branch?: unknown;
    head_sha?: unknown;
    event?: unknown;
    status?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    repository?: WorkflowRepositoryRef;
    head_repository?: WorkflowRepositoryRef | null;
}

interface ArtifactWorkflowRunRef {
    id?: unknown;
    repository_id?: unknown;
    head_repository_id?: unknown;
    head_branch?: unknown;
    head_sha?: unknown;
}

interface ArtifactResponse {
    id?: unknown;
    name?: unknown;
    size_in_bytes?: unknown;
    archive_download_url?: unknown;
    expires_at?: unknown;
    expired?: unknown;
    workflow_run?: ArtifactWorkflowRunRef | null;
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

// 后台静默检查用的请求策略：不重试、短超时，失败即放弃
const SILENT_FETCH = { retries: 0, timeoutMs: 15_000 };

/**
 * 更新检测专用请求：优先带 GitHub token，token 失效（401）时退回匿名请求，
 * 避免过期 token 让更新检测彻底失效。
 */
async function githubFetchForUpdate<T>(url: string): Promise<T> {
    const headers = optionalAuthHeaders();
    try {
        return await githubFetch<T>(url, { headers }, SILENT_FETCH);
    } catch (error) {
        if (Object.keys(headers).length > 0 && isGithubStatus(error, 401)) {
            return githubFetch<T>(url, { headers: {} }, SILENT_FETCH);
        }
        throw error;
    }
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
 *
 * 优先带 GitHub token（限流额度 5000 次/小时）；未登录时退回匿名请求
 * （仅 60 次/小时，且按出口 IP 计算，同一网络下多用户极易被限流）。
 */
export async function fetchLatestRelease(): Promise<UpdateInfo | null> {
    try {
        const raw = await githubFetchForUpdate<LatestReleaseResponse>(
            `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
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

const UPDATE_WORKFLOW_FILE = "main.yml";
const UPDATE_WORKFLOW_PATH = `.github/workflows/${UPDATE_WORKFLOW_FILE}`;
const UPDATE_BRANCH = "main";
const BETA_RUNS_PER_PAGE = 30;
const BETA_MAX_RUN_PAGES = 2;
const BETA_MAX_ARTIFACT_REQUESTS = 5;
const ARTIFACT_CACHE_TTL_MS = 5 * 60_000;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const VERSION_PATTERN =
    /^[vV]?(\d+(?:\.\d+)*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// 新命名：astrobox-creator-console-<version>-<run_number>.<run_attempt>-<platform>
const VERSIONED_ARTIFACT_PATTERN =
    /^astrobox-creator-console-(.+)-(\d+)\.(\d+)-(windows|macos|linux|android)$/;
const LEGACY_ARTIFACT_PLATFORMS: Record<string, BetaPlatform> = {
    "tauri-build-macos-latest": "macos",
    "tauri-build-windows-latest": "windows",
    "tauri-build-ubuntu-22.04": "linux",
    "android-apk": "android",
};
const TRUSTED_RUN_EVENTS = new Set(["push", "workflow_dispatch", "schedule"]);

/**
 * 本仓库的构建既可能由 `main` 上的手动触发产生，也可能由 `v*` 版本 tag 的
 * push 产生（此时 GitHub 返回的 head_branch 是 tag 名）。两者都视为可信来源。
 */
function isTrustedBranch(branch: string): boolean {
    return branch === UPDATE_BRANCH || VERSION_PATTERN.test(branch);
}

export interface ParsedBetaArtifactName {
    version: string;
    runNumber: number;
    attempt: number;
    platform: BetaPlatform;
}

/**
 * 解析新命名的构建产物。旧工作流使用静态产物名，无法从中确认 attempt，
 * 由 `toDownloadableArtifact` 单独兼容。
 */
export function parseBetaArtifactName(
    name: string,
): ParsedBetaArtifactName | null {
    const match = VERSIONED_ARTIFACT_PATTERN.exec(name);
    if (!match) return null;
    const [, version, runNumberText, attemptText, platform] = match;
    if (!VERSION_PATTERN.test(version)) return null;
    const runNumber = Number(runNumberText);
    const attempt = Number(attemptText);
    if (!Number.isSafeInteger(runNumber) || runNumber <= 0) return null;
    if (!Number.isSafeInteger(attempt) || attempt <= 0) return null;
    return {
        version,
        runNumber,
        attempt,
        platform: platform as BetaPlatform,
    };
}

interface TrustedRun {
    id: number;
    repositoryId: number;
    runNumber: number;
    runAttempt: number;
    name: string;
    headBranch: string;
    headSha: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * 只接受「本仓库 main 分支、由可信事件触发、已成功完成」的工作流运行，
 * 避免把 PR、fork 或其他工作流的产物误判为 Beta 构建。
 */
function toTrustedRun(raw: WorkflowRunResponse): TrustedRun | null {
    if (readString(raw.path) !== UPDATE_WORKFLOW_PATH) return null;
    const headBranch = readString(raw.head_branch);
    if (!isTrustedBranch(headBranch)) return null;
    if (readString(raw.status) !== "completed") return null;
    if (readString(raw.conclusion) !== "success") return null;
    if (!TRUSTED_RUN_EVENTS.has(readString(raw.event))) return null;

    const repository = raw.repository;
    const headRepository = raw.head_repository;
    if (!repository || !headRepository) return null;
    if (readString(repository.full_name) !== UPDATE_REPO) return null;
    if (readString(headRepository.full_name) !== UPDATE_REPO) return null;

    const repositoryId = Number(repository.id);
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) return null;
    if (Number(headRepository.id) !== repositoryId) return null;

    const id = Number(raw.id);
    const runNumber = Number(raw.run_number);
    const runAttempt = Number(raw.run_attempt);
    const headSha = readString(raw.head_sha).toLowerCase();
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (!Number.isSafeInteger(runNumber) || runNumber <= 0) return null;
    if (!Number.isSafeInteger(runAttempt) || runAttempt <= 0) return null;
    if (!SHA_PATTERN.test(headSha)) return null;

    return {
        id,
        repositoryId,
        runNumber,
        runAttempt,
        name: readString(raw.name),
        headBranch,
        headSha,
        htmlUrl: readString(raw.html_url),
        createdAt: readString(raw.created_at),
        updatedAt: readString(raw.updated_at),
    };
}

function toDownloadableArtifact(
    raw: ArtifactResponse,
    run: TrustedRun,
): BetaArtifact | null {
    // 过期、空产物或缺少下载地址一律视为不可用。
    if (raw.expired !== false) return null;
    const size = Number(raw.size_in_bytes);
    if (!Number.isSafeInteger(size) || size <= 0) return null;
    const expiresAt = readString(raw.expires_at);
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;

    const id = Number(raw.id);
    const downloadUrl = readString(raw.archive_download_url);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (!downloadUrl) return null;

    // 产物的 workflow_run 必须与当前 run 完全一致，防止跨 run 混入。
    const workflowRun = raw.workflow_run;
    if (!workflowRun) return null;
    if (Number(workflowRun.id) !== run.id) return null;
    if (Number(workflowRun.repository_id) !== run.repositoryId) return null;
    if (Number(workflowRun.head_repository_id) !== run.repositoryId) return null;
    if (readString(workflowRun.head_branch) !== run.headBranch) return null;
    if (readString(workflowRun.head_sha).toLowerCase() !== run.headSha) {
        return null;
    }

    const name = readString(raw.name);
    const parsed = parseBetaArtifactName(name);
    let version: string;
    let attempt: number;
    let platform: BetaPlatform;
    if (parsed) {
        if (parsed.runNumber !== run.runNumber) return null;
        // 部分重跑可能保留旧 attempt 的产物，只接受不超过当前 attempt 的。
        if (parsed.attempt > run.runAttempt) return null;
        version = parsed.version;
        attempt = parsed.attempt;
        platform = parsed.platform;
    } else {
        // 兼容旧静态命名。旧产物不含 attempt，无法安全区分重跑，
        // 因此只在 run 的第一次 attempt 中接受。
        const legacyPlatform = LEGACY_ARTIFACT_PLATFORMS[name];
        if (!legacyPlatform || run.runAttempt !== 1) return null;
        version = "";
        attempt = 1;
        platform = legacyPlatform;
    }

    return {
        id,
        name,
        platform,
        version,
        attempt,
        size,
        downloadUrl,
        expiresAt,
    };
}

function collectBuildArtifacts(
    rawArtifacts: ArtifactResponse[],
    run: TrustedRun,
): { attempt: number; version: string; artifacts: BetaArtifact[] } | null {
    const all = rawArtifacts
        .map((artifact) => toDownloadableArtifact(artifact, run))
        .filter((artifact): artifact is BetaArtifact => artifact !== null);
    if (all.length === 0) return null;

    // 以最新的 attempt 为准：重跑后旧 attempt 的产物不应再被下载。
    const attempt = Math.max(...all.map((artifact) => artifact.attempt));
    const byPlatform = new Map<BetaPlatform, BetaArtifact>();
    for (const artifact of all) {
        if (artifact.attempt !== attempt) continue;
        if (!byPlatform.has(artifact.platform)) {
            byPlatform.set(artifact.platform, artifact);
        }
    }
    if (byPlatform.size === 0) return null;

    const artifacts = [...byPlatform.values()].sort((left, right) =>
        left.platform.localeCompare(right.platform),
    );
    return {
        attempt,
        version: artifacts.find((artifact) => artifact.version)?.version ?? "",
        artifacts,
    };
}

/**
 * 拉取最近一个「带可下载产物」的 Beta 构建。
 * 最新的成功 run 可能没有产物（例如只有部分 job 上传），此时继续向前查找。
 */
async function requestLatestBetaBuild(): Promise<BetaArtifactInfo | null> {
    try {
        let artifactRequests = 0;

        for (let page = 1; page <= BETA_MAX_RUN_PAGES; page += 1) {
            const response = await githubFetchForUpdate<{
                workflow_runs?: WorkflowRunResponse[];
            }>(
                `https://api.github.com/repos/${UPDATE_REPO}/actions/workflows/${UPDATE_WORKFLOW_FILE}/runs` +
                    `?status=success&per_page=${BETA_RUNS_PER_PAGE}&page=${page}`,
            );

            const rawRuns = Array.isArray(response?.workflow_runs)
                ? response.workflow_runs
                : [];
            if (rawRuns.length === 0) break;

            const runs = rawRuns
                .map(toTrustedRun)
                .filter((run): run is TrustedRun => run !== null)
                .sort(
                    (left, right) =>
                        right.runNumber - left.runNumber ||
                        right.runAttempt - left.runAttempt,
                );

            for (const run of runs) {
                if (artifactRequests >= BETA_MAX_ARTIFACT_REQUESTS) return null;
                artifactRequests += 1;

                const artifactsResponse = await githubFetchForUpdate<{
                    artifacts?: ArtifactResponse[];
                }>(
                    `https://api.github.com/repos/${UPDATE_REPO}/actions/runs/${run.id}/artifacts?per_page=100`,
                );
                const rawArtifacts = Array.isArray(artifactsResponse?.artifacts)
                    ? artifactsResponse.artifacts
                    : [];
                const build = collectBuildArtifacts(rawArtifacts, run);
                if (!build) continue;

                return {
                    runId: run.id,
                    runNumber: run.runNumber,
                    runAttempt: build.attempt,
                    workflowName: run.name || "CI Build",
                    headSha: run.headSha,
                    htmlUrl:
                        run.htmlUrl ||
                        `https://github.com/${UPDATE_REPO}/actions/runs/${run.id}`,
                    createdAt: run.createdAt,
                    updatedAt: run.updatedAt,
                    buildLabel: `beta #${run.runNumber}.${build.attempt}`,
                    version: build.version,
                    artifacts: build.artifacts,
                };
            }

            if (rawRuns.length < BETA_RUNS_PER_PAGE) break;
        }

        return null;
    } catch (error) {
        if (isGithubStatus(error, 404)) return null;
        throw error;
    }
}

/** 当前安装构建的人类可读标识。 */
export function describeInstalledBuild(
    installed: InstalledBuildInfo,
): string {
    if (installed.ciRunNumber > 0 && installed.ciRunAttempt > 0) {
        return `beta #${installed.ciRunNumber}.${installed.ciRunAttempt}`;
    }
    if (SHA_PATTERN.test(installed.commitSha)) {
        return `build ${installed.commitSha.slice(0, 7)}${
            installed.sourceDirty ? " *" : ""
        }`;
    }
    return "本地构建";
}

/**
 * 先用 CI run number / attempt 做精确比较；无法判定时返回 `unknown`，
 * 再由 `resolveBetaComparison` 尝试 commit 祖先关系。
 */
export function compareBetaBuildWithInstalled(
    installed: InstalledBuildInfo,
    info: Pick<BetaArtifactInfo, "runNumber" | "runAttempt">,
): BetaComparison {
    if (installed.sourceDirty) return "unknown";
    if (installed.ciRunNumber > 0 && installed.ciRunAttempt > 0) {
        if (info.runNumber !== installed.ciRunNumber) {
            return info.runNumber > installed.ciRunNumber
                ? "update"
                : "up-to-date";
        }
        return info.runAttempt > installed.ciRunAttempt
            ? "update"
            : "up-to-date";
    }
    return "unknown";
}

async function resolveBetaComparison(
    installed: InstalledBuildInfo,
    info: BetaArtifactInfo,
): Promise<BetaComparison> {
    const known = compareBetaBuildWithInstalled(installed, info);
    if (known !== "unknown") return known;
    if (installed.sourceDirty) return "unknown";

    const installedSha = installed.commitSha.toLowerCase();
    if (!SHA_PATTERN.test(installedSha)) return "unknown";
    if (installedSha === info.headSha.toLowerCase()) return "up-to-date";

    try {
        const comparison = await githubFetchForUpdate<{ status?: unknown }>(
            `https://api.github.com/repos/${UPDATE_REPO}/compare/` +
                `${installedSha}...${info.headSha}?per_page=1`,
        );
        switch (readString(comparison?.status)) {
            case "ahead":
                return "update";
            case "behind":
            case "identical":
                return "up-to-date";
            default:
                return "unknown";
        }
    } catch (error) {
        if (isGithubStatus(error, 404)) return "unknown";
        throw error;
    }
}

let betaCheckCache: { at: number; value: BetaCheckResult } | null = null;
let betaCheckInflight: Promise<BetaCheckResult> | null = null;

/**
 * 检查 GitHub Actions 上是否存在比当前安装构建更新的 Beta 产物。
 * 默认命中 5 分钟缓存；`{ force: true }` 用于设置页手动检查。
 */
export async function checkForBetaUpdate(options?: {
    force?: boolean;
    installedBuild?: InstalledBuildInfo;
}): Promise<BetaCheckResult> {
    const installed = options?.installedBuild ?? getInstalledBuildInfo();
    const cacheable = !options?.installedBuild;

    if (
        cacheable &&
        !options?.force &&
        betaCheckCache &&
        Date.now() - betaCheckCache.at < ARTIFACT_CACHE_TTL_MS
    ) {
        return betaCheckCache.value;
    }
    // 并发去重：启动自动检查与设置页手动检查同时触发时只打一轮 API。
    if (cacheable && !options?.force && betaCheckInflight) {
        return betaCheckInflight;
    }

    const task = (async (): Promise<BetaCheckResult> => {
        const info = await requestLatestBetaBuild();
        if (!info) return { status: "none" };

        const comparison = await resolveBetaComparison(installed, info);
        const currentBuildLabel = describeInstalledBuild(installed);
        if (comparison === "up-to-date") {
            return { status: "up-to-date", info, currentBuildLabel };
        }
        return {
            status: "available",
            prompt: { info, comparison, currentBuildLabel },
        };
    })();

    if (!cacheable) return task;

    betaCheckInflight = task;
    try {
        const value = await task;
        betaCheckCache = { at: Date.now(), value };
        return value;
    } finally {
        betaCheckInflight = null;
    }
}

/** 根据当前平台选择要下载的产物；无法确定平台时仅接受唯一产物。 */
export function selectBetaArtifact(
    info: BetaArtifactInfo,
    platform: BetaPlatform | null = detectBetaPlatform(),
): BetaArtifact | null {
    if (!platform) {
        return info.artifacts.length === 1 ? info.artifacts[0] : null;
    }
    return (
        info.artifacts.find((artifact) => artifact.platform === platform) ?? null
    );
}

/** 从 WebView 的 UA 推断当前平台。 */
export function detectBetaPlatform(): BetaPlatform | null {
    if (typeof navigator === "undefined") return null;
    const ua = navigator.userAgent || "";
    // iOS 没有对应的 Actions 产物；iPad 的桌面模式 UA 会伪装成 macOS。
    if (/iphone|ipad|ipod/i.test(ua)) return null;
    if (/android/i.test(ua)) return "android";
    if (/windows|win32|win64/i.test(ua)) return "windows";
    if (/macintosh|mac os x|macos/i.test(ua)) return "macos";
    if (/linux|x11/i.test(ua)) return "linux";
    return null;
}

// --- 忽略的 beta 构建 / 本地存储 ---

const KEY_BETA_IGNORED_BUILD = "ABCC_BETA_UPDATE_IGNORED_BUILD_V2";
const KEY_BETA_LAST_NOTIFIED = "ABCC_BETA_UPDATE_LAST_NOTIFIED_V1";

function formatBuildKey(info: Pick<BetaArtifactInfo, "runId" | "runAttempt">) {
    return `${info.runId}.${info.runAttempt}`;
}

export function ignoreBetaBuild(
    info: Pick<BetaArtifactInfo, "runId" | "runAttempt">,
) {
    writeStorage(KEY_BETA_IGNORED_BUILD, formatBuildKey(info));
    notifySubscribers();
}

export function isBetaBuildIgnored(
    info: Pick<BetaArtifactInfo, "runId" | "runAttempt">,
): boolean {
    return readStorage(KEY_BETA_IGNORED_BUILD) === formatBuildKey(info);
}

/**
 * 无法判定当前构建是否最新时，同一个构建只自动提示一次，
 * 避免本地构建每次启动都被弹窗打扰。
 */
export function isBetaBuildNotified(
    info: Pick<BetaArtifactInfo, "runId" | "runAttempt">,
): boolean {
    return readStorage(KEY_BETA_LAST_NOTIFIED) === formatBuildKey(info);
}

export function markBetaBuildNotified(
    info: Pick<BetaArtifactInfo, "runId" | "runAttempt">,
) {
    writeStorage(KEY_BETA_LAST_NOTIFIED, formatBuildKey(info));
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

import { useSyncExternalStore } from "react";
import {
    loadAccountState,
    type GithubAccount,
    type GithubReaderAccount,
} from "./store";

export type GithubAuthPurpose = "primary" | "read";
export type GithubAccountRole = "primary" | "reader";
export type GithubRateLimitResource = "core" | "search" | "graphql";

export interface GithubRateLimitSnapshot {
    limit: number;
    remaining: number;
    /** 毫秒时间戳（GitHub 返回的是秒）。 */
    resetAt: number;
    used: number;
}

export interface GithubAccountQuota {
    login: string;
    role: GithubAccountRole;
    core?: GithubRateLimitSnapshot;
    search?: GithubRateLimitSnapshot;
    graphql?: GithubRateLimitSnapshot;
    updatedAt: number;
    /** 内部选号用的最近使用时间，不参与展示。 */
    lastUsedAt?: number;
    /** core 额度耗尽时，到该时间戳前不再使用该账号。 */
    coreExhaustedUntil?: number;
    invalid?: boolean;
}

export interface GithubRequestIdentity {
    token: string;
    login: string;
    role: GithubAccountRole;
    account: GithubAccount | GithubReaderAccount;
}

/** 主账号至少为主请求保留的额度；低于该值时不再回退到主账号做内容读取。 */
export const PRIMARY_READ_RESERVE = 200;

const quotaByLogin = new Map<string, GithubAccountQuota>();
const quotaSubscribers = new Set<() => void>();
let quotaSnapshot: GithubAccountQuota[] = [];

function quotaKey(login: string) {
    return login.trim().toLowerCase() || "primary";
}

function notifyQuota() {
    quotaSnapshot = Array.from(quotaByLogin.values()).sort((left, right) =>
        left.login.localeCompare(right.login),
    );
    quotaSubscribers.forEach((listener) => listener());
}

function subscribeQuota(listener: () => void) {
    quotaSubscribers.add(listener);
    return () => quotaSubscribers.delete(listener);
}

export function useGithubQuota(): GithubAccountQuota[] {
    return useSyncExternalStore(
        subscribeQuota,
        () => quotaSnapshot,
        () => quotaSnapshot,
    );
}

export function getGithubQuota(login: string): GithubAccountQuota | undefined {
    return quotaByLogin.get(quotaKey(login));
}

export function getGithubQuotaSnapshot(): GithubAccountQuota[] {
    return quotaSnapshot;
}

export function clearGithubQuotas(): void {
    quotaByLogin.clear();
    notifyQuota();
}

function upsertQuota(
    login: string,
    role: GithubAccountRole,
    patch: Partial<GithubAccountQuota>,
): GithubAccountQuota {
    const key = quotaKey(login);
    const current = quotaByLogin.get(key) ?? {
        login: login.trim() || role,
        role,
        updatedAt: 0,
    };
    const next: GithubAccountQuota = {
        ...current,
        ...patch,
        login: login.trim() || role,
        role,
    };
    quotaByLogin.set(key, next);
    notifyQuota();
    return next;
}

function parseNumber(value: string | null): number | undefined {
    if (value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** 只识别 GitHub 真正会返回的三个资源桶，避免把其他桶误写进 core。 */
function knownResource(
    value: string | null | undefined,
): GithubRateLimitResource | null {
    const normalized = (value || "").toLowerCase();
    if (normalized === "core") return "core";
    if (normalized === "search") return "search";
    if (normalized === "graphql") return "graphql";
    return null;
}

function writeSnapshot(
    login: string,
    role: GithubAccountRole,
    resource: GithubRateLimitResource,
    snapshot: GithubRateLimitSnapshot,
): GithubAccountQuota {
    const patch: Partial<GithubAccountQuota> = {
        updatedAt: Date.now(),
        invalid: false,
    };
    patch[resource] = snapshot;
    if (resource === "core") {
        patch.coreExhaustedUntil =
            snapshot.remaining <= 0 ? snapshot.resetAt : undefined;
    }
    return upsertQuota(login, role, patch);
}

/** 从任意 GitHub 响应的 X-RateLimit-* 头更新账号额度。 */
export function applyGithubRateLimitHeaders(
    login: string,
    role: GithubAccountRole,
    headers: Headers,
): GithubAccountQuota | null {
    const limit = parseNumber(headers.get("x-ratelimit-limit"));
    const remaining = parseNumber(headers.get("x-ratelimit-remaining"));
    const reset = parseNumber(headers.get("x-ratelimit-reset"));
    if (limit === undefined || remaining === undefined || reset === undefined) {
        return null;
    }

    const resource = knownResource(headers.get("x-ratelimit-resource")) ?? "core";
    const used =
        parseNumber(headers.get("x-ratelimit-used")) ??
        Math.max(0, limit - remaining);

    return writeSnapshot(login, role, resource, {
        limit,
        remaining,
        resetAt: reset * 1000,
        used,
    });
}

/** 从 GET /rate_limit 的 JSON 更新 core / search / graphql 三个桶。 */
export function applyGithubRateLimitPayload(
    login: string,
    role: GithubAccountRole,
    payload: unknown,
): void {
    if (!payload || typeof payload !== "object") return;
    const resources = (payload as { resources?: unknown }).resources;
    if (!resources || typeof resources !== "object") return;

    for (const [resourceName, rawValue] of Object.entries(
        resources as Record<string, unknown>,
    )) {
        const resource = knownResource(resourceName);
        if (!resource || !rawValue || typeof rawValue !== "object") continue;

        const value = rawValue as {
            limit?: unknown;
            remaining?: unknown;
            reset?: unknown;
            used?: unknown;
        };
        const limit = typeof value.limit === "number" ? value.limit : undefined;
        const remaining =
            typeof value.remaining === "number" ? value.remaining : undefined;
        const reset = typeof value.reset === "number" ? value.reset : undefined;
        if (limit === undefined || remaining === undefined || reset === undefined) {
            continue;
        }

        writeSnapshot(login, role, resource, {
            limit,
            remaining,
            resetAt: reset * 1000,
            used:
                typeof value.used === "number"
                    ? value.used
                    : Math.max(0, limit - remaining),
        });
    }
}

export function markGithubAccountExhausted(login: string, resetAt: number): void {
    const current = quotaByLogin.get(quotaKey(login));
    // 有的错误响应不带 X-RateLimit-*，这里把已知的 core 剩余量同步为 0，
    // 避免设置页继续显示一个已经不可用的剩余额度。
    const core = current?.core
        ? { ...current.core, remaining: 0 }
        : undefined;
    upsertQuota(login, current?.role ?? "reader", {
        ...(core ? { core } : {}),
        coreExhaustedUntil: resetAt,
        updatedAt: Date.now(),
    });
}

export function markGithubAccountInvalid(login: string): void {
    const current = quotaByLogin.get(quotaKey(login));
    upsertQuota(login, current?.role ?? "reader", {
        invalid: true,
        updatedAt: Date.now(),
    });
}

function markGithubAccountUsed(login: string, role: GithubAccountRole): void {
    const key = quotaKey(login);
    const current = quotaByLogin.get(key);
    if (current) {
        // lastUsedAt 只用于选号排序，不触发 React 重渲染。
        current.lastUsedAt = Date.now();
        return;
    }
    quotaByLogin.set(key, {
        login: login.trim() || role,
        role,
        updatedAt: 0,
        lastUsedAt: Date.now(),
    });
}

export function getPrimaryGithubIdentity(): GithubRequestIdentity | null {
    const account = loadAccountState().github;
    if (!account?.token) return null;
    return {
        token: account.token,
        login: account.username?.trim() || "primary",
        role: "primary",
        account,
    };
}

export function getGithubReaderIdentities(): GithubRequestIdentity[] {
    const state = loadAccountState();
    const primaryLogin = state.github?.username?.trim().toLowerCase() ?? "";
    return (state.githubReaders ?? [])
        .filter((reader) => Boolean(reader.token) && Boolean(reader.username?.trim()))
        .filter(
            (reader) => reader.username.trim().toLowerCase() !== primaryLogin,
        )
        .map((reader) => ({
            token: reader.token,
            login: reader.username.trim(),
            role: "reader" as const,
            account: reader,
        }));
}

export interface SelectGithubReadIdentityInput {
    primary: GithubRequestIdentity | null;
    readers: GithubRequestIdentity[];
    quotas: ReadonlyMap<string, GithubAccountQuota>;
    exclude?: ReadonlySet<string>;
    allowPrimaryFallback?: boolean;
    now?: number;
    primaryReadReserve?: number;
}

function isQuotaUnavailable(
    quota: GithubAccountQuota | undefined,
    now: number,
): boolean {
    if (!quota) return false;
    if (quota.invalid) return true;
    return Boolean(
        quota.coreExhaustedUntil && quota.coreExhaustedUntil > now,
    );
}

/** 纯选号逻辑：优先读取账号中剩余额度最多、最久未用的一个。 */
export function selectGithubReadIdentity(
    input: SelectGithubReadIdentityInput,
): GithubRequestIdentity | null {
    const {
        primary,
        readers,
        quotas,
        exclude,
        allowPrimaryFallback = true,
        now = Date.now(),
        primaryReadReserve = PRIMARY_READ_RESERVE,
    } = input;

    if (!primary) return null;

    const excluded = exclude ?? new Set<string>();
    const candidates = readers
        .filter(
            (identity) =>
                !excluded.has(identity.login.trim().toLowerCase()),
        )
        .filter(
            (identity) =>
                !isQuotaUnavailable(quotas.get(quotaKey(identity.login)), now),
        )
        .sort((left, right) => {
            const leftQuota = quotas.get(quotaKey(left.login));
            const rightQuota = quotas.get(quotaKey(right.login));
            const leftRemaining =
                leftQuota?.core?.remaining ?? Number.MAX_SAFE_INTEGER;
            const rightRemaining =
                rightQuota?.core?.remaining ?? Number.MAX_SAFE_INTEGER;
            if (rightRemaining !== leftRemaining) {
                return rightRemaining - leftRemaining;
            }
            const leftUsed = leftQuota?.lastUsedAt ?? 0;
            const rightUsed = rightQuota?.lastUsedAt ?? 0;
            if (leftUsed !== rightUsed) return leftUsed - rightUsed;
            return left.login.localeCompare(right.login);
        });

    if (candidates.length > 0) return candidates[0];
    if (!allowPrimaryFallback) return null;
    if (excluded.has(primary.login.trim().toLowerCase())) return null;

    const primaryQuota = quotas.get(quotaKey(primary.login));
    if (isQuotaUnavailable(primaryQuota, now)) return null;
    const primaryRemaining = primaryQuota?.core?.remaining;
    if (
        typeof primaryRemaining === "number" &&
        primaryRemaining < primaryReadReserve
    ) {
        return null;
    }
    return primary;
}

export interface PickGithubReadIdentityOptions {
    exclude?: ReadonlySet<string>;
    allowPrimaryFallback?: boolean;
}

/** 结合当前账号状态和额度记录选出一个读取身份。 */
export function pickGithubReadIdentity(
    options: PickGithubReadIdentityOptions = {},
): GithubRequestIdentity | null {
    const identity = selectGithubReadIdentity({
        primary: getPrimaryGithubIdentity(),
        readers: getGithubReaderIdentities(),
        quotas: quotaByLogin,
        exclude: options.exclude,
        allowPrimaryFallback: options.allowPrimaryFallback,
    });
    if (identity) {
        markGithubAccountUsed(identity.login, identity.role);
    }
    return identity;
}

export function getGithubReadToken(): string | null {
    return pickGithubReadIdentity()?.token ?? null;
}

const IDENTITY_ENDPOINT_PATTERNS: RegExp[] = [
    /^https:\/\/api\.github\.com\/user$/,
    /^https:\/\/api\.github\.com\/user\//,
    /\/collaborators\/[^/]+\/permission(?:\?|$)/,
    /^https:\/\/api\.github\.com\/orgs\/[^/]+\/members(?:\?|$)/,
    /^https:\/\/api\.github\.com\/notifications(?:\?|$)/,
    /\/actions\/[^?]*\/artifacts(?:\?|$)/,
];

/** 必须使用主账号身份的端点：用户资料、权限、组织成员、通知、Actions 产物。 */
export function isIdentityGithubEndpoint(url: string): boolean {
    return IDENTITY_ENDPOINT_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * 决定一次请求该用主账号还是读取账号。
 * 写请求和身份相关端点永远走主账号，即使调用方误传 read。
 */
export function resolveGithubAuthPurpose(
    url: string,
    method: string | undefined,
    requested?: GithubAuthPurpose,
): GithubAuthPurpose {
    const normalizedMethod = (method ?? "GET").toUpperCase();
    if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
        return "primary";
    }
    if (isIdentityGithubEndpoint(url)) return "primary";
    return requested ?? "primary";
}

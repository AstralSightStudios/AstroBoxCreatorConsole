import { useEffect, useState } from "react";
import { getPublicProfile, type PublicProfile } from "~/api/astrobox/profile";
import { fetchCatalogEntries, type CatalogEntry } from "~/logic/publish/catalog";
import { hasCreatorPro, isVipActive, type AuthorProStatus } from "../owner-pro";
import type { VipTier } from "~/api/astrobox/admin";

export type PaidKind = "free" | "paid";

/** 非 Creator Pro 作者：每 1 个付费资源至少要配 2 个免费资源。 */
export const FREE_PER_PAID = 2;

export interface AuthorResourceInfo {
    id: string;
    name: string;
    paidKind: PaidKind;
    /** 本次 PR 正在提交或修改的资源。 */
    pending?: boolean;
}

export type RatioCompliance =
    | { compliant: true; freeCount: number; paidCount: number }
    | { compliant: false; freeCount: number; paidCount: number; reason: string };

/**
 * 比例判定的四种结论，刻意做成互斥判别联合，避免调用方把「查不到」误读成
 * 「不合规」：
 * - `skipped`：本次提交不是付费资源，不参与比例判定；
 * - `pro`：归属作者持有有效 Creator Pro 权益，不受比例限制；
 * - `checked`：已列出该作者名下全部资源并按总量判定；
 * - `unresolved`：账户未匹配或查询失败，无法判定。
 */
export type PaidRatioResult =
    | { status: "skipped"; authorName: string; reason: string }
    | { status: "pro"; authorName: string; vipTier: VipTier }
    | {
          status: "checked";
          authorName: string;
          vipTier: VipTier;
          resources: AuthorResourceInfo[];
          ratio: RatioCompliance;
      }
    | { status: "unresolved"; authorName: string; vipTier?: VipTier; reason: string };

export interface ManifestAuthorLike {
    name?: string;
    bindABAccount?: boolean;
}

export function entryPaidKind(paidType: string | undefined): PaidKind {
    const normalized = (paidType || "").trim().toLowerCase();
    if (normalized === "paid" || normalized === "force_paid") return "paid";
    return "free";
}

export function isPaidEntry(paidType: string | undefined) {
    return entryPaidKind(paidType) === "paid";
}

/**
 * 资源只归属 manifest.author 里「第一位声明绑定 AstroBox 账户」的作者，
 * 其余作者按联名/贡献者处理，不参与付费/免费比例判定——否则一个自己名下
 * 没有资源的联名者会把本次提交判成不合规。
 */
export function pickRatioAuthorName(authors: ManifestAuthorLike[] | undefined): string {
    if (!Array.isArray(authors)) return "";
    for (const author of authors) {
        const name = typeof author?.name === "string" ? author.name.trim() : "";
        if (name && author?.bindABAccount) return name;
    }
    return "";
}

/**
 * 总量口径：名下免费资源数 ≥ 2 × 付费资源数即合规。
 *
 * 这里刻意不按目录行顺序做「前缀不变量」判定：index_v2.csv 的行序只是
 * 「新增追加到末尾、编辑把原行摘掉再追加到末尾」的结果，编辑一次就会把
 * 历史资源挪到后面，行序与发布时间无关。按行序判定会让任何被编辑过或被
 * 管理员强制付费过的作者永久判为不合规。
 */
export function evaluateRatio(resources: AuthorResourceInfo[]): RatioCompliance {
    let freeCount = 0;
    let paidCount = 0;
    for (const r of resources) {
        if (r.paidKind === "paid") paidCount++;
        else freeCount++;
    }
    const required = FREE_PER_PAID * paidCount;
    if (freeCount < required) {
        return {
            compliant: false,
            freeCount,
            paidCount,
            reason: `名下共 ${freeCount} 个免费、${paidCount} 个付费资源，${paidCount} 个付费资源需至少配 ${required} 个免费资源`,
        };
    }
    return { compliant: true, freeCount, paidCount };
}

/**
 * 把本次 PR 的资源并进作者名下清单。
 *
 * 本次提交的资源会「顶替」它在目录里的那一行。编辑允许改资源 ID
 * （`originalEntryId ≠ newEntryId`），不先把原行摘掉，同一个资源会被同时
 * 算成「旧的免费」和「新的付费」，比例直接算错。
 */
export function mergeIncomingResource(
    resources: AuthorResourceInfo[],
    incoming: { id?: string; originalId?: string; isPaid: boolean },
): AuthorResourceInfo[] {
    const incomingId = (incoming.id || "").trim();
    const supersededIds = new Set<string>();
    if (incomingId) supersededIds.add(incomingId);
    const originalId = (incoming.originalId || "").trim();
    if (originalId) supersededIds.add(originalId);

    const merged = resources.filter((r) => !supersededIds.has(r.id));
    merged.push({
        id: incomingId || "(待提交)",
        name: "(本次提交)",
        paidKind: incoming.isPaid ? "paid" : "free",
        pending: true,
    });
    return merged;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

const profileCache = new Map<string, { at: number; value: PublicProfile }>();
let catalogCache: { at: number; promise: Promise<CatalogEntry[]> } | null = null;

/** 「重新检查」时清空缓存，避免沿用上一次拿到的目录快照与账户资料。 */
export function resetPaidRatioCaches() {
    profileCache.clear();
    catalogCache = null;
}

async function fetchCatalogOnce(token: string): Promise<CatalogEntry[]> {
    const now = Date.now();
    if (catalogCache && now - catalogCache.at < CACHE_TTL_MS) return catalogCache.promise;
    const promise = fetchCatalogEntries({ token })
        .then((r) => r.entries)
        .catch((err) => {
            if (catalogCache?.promise === promise) catalogCache = null;
            throw err;
        });
    catalogCache = { at: now, promise };
    return promise;
}

function unresolvedReason(status: Exclude<AuthorProStatus, { state: "found" }>): string {
    switch (status.state) {
        case "not-found":
            return "名称未匹配账户";
        case "error":
            return status.message;
        case "no-auth":
            return "未登录 AstroBox";
        default:
            return "查询中";
    }
}

export async function checkPaidFreeRatioForAuthor(options: {
    authorName: string;
    authorStatus: AuthorProStatus;
    astroboxToken?: string;
    githubToken: string;
    newEntryPaidType?: string;
    newEntryId?: string;
    /** 编辑提交时的原资源 ID；编辑允许改 ID，与 newEntryId 可能不同。 */
    originalEntryId?: string;
}): Promise<PaidRatioResult> {
    const {
        authorName,
        authorStatus,
        astroboxToken,
        githubToken,
        newEntryPaidType,
        newEntryId,
        originalEntryId,
    } = options;

    if (authorStatus.state !== "found") {
        return { status: "unresolved", authorName, reason: unresolvedReason(authorStatus) };
    }

    const user = authorStatus.user;
    const vipTier = user.vip;

    const incomingIsPaid = isPaidEntry(newEntryPaidType);
    // 免费资源的提交不受 Creator Pro 权益与 2 免费 : 1 比例约束，连权益都不用查：
    // 一是免费资源无论作者是否为 Pro 都合规，二是若还拿历史清单去判，就会把
    // 作者早就存在的历史欠账算到这次免费提交头上。
    if (newEntryPaidType != null && !incomingIsPaid) {
        return { status: "skipped", authorName, reason: "本次提交为免费资源，不改变付费/免费比例" };
    }

    if (hasCreatorPro(user.vip) && isVipActive(user.vip, user.vipExpireMap)) {
        return { status: "pro", authorName, vipTier };
    }

    if (!astroboxToken) {
        return { status: "unresolved", authorName, vipTier, reason: "未登录 AstroBox" };
    }

    try {
        const cached = profileCache.get(user.userId);
        let profile: PublicProfile;
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            profile = cached.value;
        } else {
            profile = await getPublicProfile({ userId: user.userId });
            profileCache.set(user.userId, { at: Date.now(), value: profile });
        }

        const catalogEntries = await fetchCatalogOnce(githubToken);
        const authorResourceIds = new Set(
            profile.resources.map((r) => (r.id || "").trim()).filter(Boolean),
        );
        const resources: AuthorResourceInfo[] = [];
        for (const e of catalogEntries) {
            const id = (e.id || "").trim();
            if (!authorResourceIds.has(id)) continue;
            resources.push({ id, name: e.name, paidKind: entryPaidKind(e.paid_type) });
        }

        // 本次 PR 的资源顶替它在目录里的原行后再计入比例。
        const merged = mergeIncomingResource(resources, {
            id: newEntryId,
            originalId: originalEntryId,
            isPaid: incomingIsPaid,
        });

        return {
            status: "checked",
            authorName,
            vipTier,
            resources: merged,
            ratio: evaluateRatio(merged),
        };
    } catch (err) {
        return {
            status: "unresolved",
            authorName,
            vipTier,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}

export type PaidRatioStatus =
    | { state: "idle" }
    | { state: "loading" }
    | { state: "not-applicable"; reason?: string }
    | { state: "pro" }
    | { state: "compliant"; freeCount: number; paidCount: number }
    | { state: "unresolved"; authorName: string; reason: string }
    | {
          state: "non-compliant";
          authorName: string;
          freeCount: number;
          paidCount: number;
          reason: string;
          resources: AuthorResourceInfo[];
      };

export function usePaidRatioStatus(options: {
    ratioAuthorName?: string;
    authorProStatuses: Record<string, AuthorProStatus>;
    astroboxToken?: string;
    githubToken?: string;
    paidType?: string;
    resourceId?: string;
    originalResourceId?: string;
}): PaidRatioStatus {
    const {
        ratioAuthorName,
        authorProStatuses,
        astroboxToken,
        githubToken,
        paidType,
        resourceId,
        originalResourceId,
    } = options;
    const [status, setStatus] = useState<PaidRatioStatus>({ state: "idle" });

    const authorName = ratioAuthorName || "";
    const authorState = authorName ? authorProStatuses[authorName]?.state : undefined;
    const paidKind = entryPaidKind(paidType);

    useEffect(() => {
        if (!authorName) {
            setStatus({ state: "not-applicable", reason: "无声明绑定 AstroBox 的作者" });
            return;
        }
        if (!astroboxToken || !githubToken) {
            setStatus({ state: "not-applicable", reason: "未登录 AstroBox 或 GitHub" });
            return;
        }
        if (!authorState || authorState === "loading") {
            setStatus({ state: "idle" });
            return;
        }
        if (paidKind !== "paid") {
            setStatus({ state: "not-applicable", reason: "本次提交为免费资源" });
            return;
        }

        let cancelled = false;
        setStatus({ state: "loading" });

        (async () => {
            const result = await checkPaidFreeRatioForAuthor({
                authorName,
                authorStatus: authorProStatuses[authorName],
                astroboxToken,
                githubToken,
                newEntryPaidType: paidType,
                newEntryId: resourceId,
                originalEntryId: originalResourceId,
            });

            if (cancelled) return;

            if (result.status === "pro") {
                setStatus({ state: "pro" });
                return;
            }
            if (result.status === "skipped") {
                setStatus({ state: "not-applicable", reason: result.reason });
                return;
            }
            if (result.status === "unresolved") {
                setStatus({ state: "unresolved", authorName, reason: result.reason });
                return;
            }
            if (result.ratio.compliant) {
                setStatus({
                    state: "compliant",
                    freeCount: result.ratio.freeCount,
                    paidCount: result.ratio.paidCount,
                });
                return;
            }
            setStatus({
                state: "non-compliant",
                authorName: result.authorName,
                freeCount: result.ratio.freeCount,
                paidCount: result.ratio.paidCount,
                reason: result.ratio.reason,
                resources: result.resources,
            });
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authorName, authorState, astroboxToken, githubToken, paidKind, paidType, resourceId, originalResourceId]);

    return status;
}

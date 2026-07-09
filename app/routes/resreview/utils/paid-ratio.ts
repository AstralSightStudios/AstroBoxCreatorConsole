import { useEffect, useState } from "react";
import { getPublicProfile, type PublicProfile } from "~/api/astrobox/profile";
import { fetchCatalogEntries, type CatalogEntry } from "~/logic/publish/catalog";
import { hasCreatorPro, isVipActive, type AuthorProStatus } from "../owner-pro";
import type { VipTier } from "~/api/astrobox/admin";

export type PaidKind = "free" | "paid";

export interface AuthorResourceInfo {
    id: string;
    name: string;
    paidKind: PaidKind;
}

export type RatioCompliance =
    | { compliant: true; freeCount: number; paidCount: number }
    | { compliant: false; freeCount: number; paidCount: number; reason: string };

export interface PaidRatioResult {
    authorName: string;
    resolved: boolean;
    hasPro: boolean;
    vipTier?: VipTier;
    resources: AuthorResourceInfo[];
    ratio: RatioCompliance | null;
    error?: string;
}

function entryPaidKind(paidType: string): PaidKind {
    const normalized = (paidType || "").trim().toLowerCase();
    if (normalized === "paid" || normalized === "force_paid") return "paid";
    return "free";
}

function checkRatio(resources: AuthorResourceInfo[]): RatioCompliance {
    let freeCount = 0;
    let paidCount = 0;
    for (const r of resources) {
        if (r.paidKind === "paid") {
            paidCount++;
            if (freeCount < 2 * paidCount) {
                return {
                    compliant: false,
                    freeCount,
                    paidCount,
                    reason: `第 ${paidCount} 个付费资源时仅有 ${freeCount} 个免费资源，需至少 ${2 * paidCount} 个`,
                };
            }
        } else {
            freeCount++;
        }
    }
    return { compliant: true, freeCount, paidCount };
}

const profileCache = new Map<string, PublicProfile>();
let catalogPromise: Promise<CatalogEntry[]> | null = null;

async function fetchCatalogOnce(token: string): Promise<CatalogEntry[]> {
    if (catalogPromise) return catalogPromise;
    catalogPromise = fetchCatalogEntries({ token })
        .then((r) => r.entries)
        .catch((err) => {
            catalogPromise = null;
            throw err;
        });
    return catalogPromise;
}

export async function checkPaidFreeRatioForAuthor(options: {
    authorName: string;
    authorStatus: AuthorProStatus;
    astroboxToken?: string;
    githubToken: string;
    newEntryPaidType?: string;
    newEntryId?: string;
}): Promise<PaidRatioResult> {
    const { authorName, authorStatus, astroboxToken, githubToken, newEntryPaidType, newEntryId } = options;

    if (authorStatus.state !== "found") {
        return {
            authorName,
            resolved: false,
            hasPro: false,
            resources: [],
            ratio: null,
            error: authorStatus.state === "not-found"
                ? "名称未匹配账户"
                : authorStatus.state === "error"
                    ? authorStatus.message
                    : authorStatus.state === "no-auth"
                        ? "未登录 AstroBox"
                        : "查询中",
        };
    }

    const user = authorStatus.user;
    const active = isVipActive(user.vip, user.vipExpireMap);
    const hasPro = hasCreatorPro(user.vip) && active;

    if (hasPro) {
        return {
            authorName,
            resolved: true,
            hasPro: true,
            vipTier: user.vip,
            resources: [],
            ratio: { compliant: true, freeCount: 0, paidCount: 0 },
        };
    }

    if (!astroboxToken) {
        return {
            authorName,
            resolved: false,
            hasPro: false,
            vipTier: user.vip,
            resources: [],
            ratio: null,
            error: "未登录 AstroBox",
        };
    }

    try {
        const cacheKey = user.userId;
        let profile = profileCache.get(cacheKey);
        if (!profile) {
            profile = await getPublicProfile({ userId: user.userId });
            profileCache.set(cacheKey, profile);
        }

        const catalogEntries = await fetchCatalogOnce(githubToken);
        const authorResourceIds = new Set(profile.resources.map((r) => r.id));
        const authorCatalogEntries = catalogEntries.filter((e) => authorResourceIds.has(e.id));

        const resources: AuthorResourceInfo[] = authorCatalogEntries.map((e) => ({
            id: e.id,
            name: e.name,
            paidKind: entryPaidKind(e.paid_type),
        }));

        const newPaidKind = entryPaidKind(newEntryPaidType || "");
        const isUpdate = newEntryId && resources.some((r) => r.id === newEntryId);

        if (newPaidKind === "paid" && !isUpdate) {
            resources.push({
                id: newEntryId || "(待提交)",
                name: "(本次提交)",
                paidKind: "paid",
            });
        } else if (newPaidKind === "paid" && isUpdate && newEntryId) {
            const existing = resources.find((r) => r.id === newEntryId);
            if (existing && existing.paidKind === "free") {
                existing.paidKind = "paid";
            }
        }

        resources.sort((a, b) => {
            const aIsNew = a.id === newEntryId ? 1 : 0;
            const bIsNew = b.id === newEntryId ? 1 : 0;
            return aIsNew - bIsNew;
        });

        const ratio = checkRatio(resources);

        return {
            authorName,
            resolved: true,
            hasPro: false,
            vipTier: user.vip,
            resources,
            ratio,
        };
    } catch (err) {
        return {
            authorName,
            resolved: false,
            hasPro: false,
            vipTier: user.vip,
            resources: [],
            ratio: null,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

export type PaidRatioStatus =
    | { state: "idle" }
    | { state: "loading" }
    | { state: "not-applicable" }
    | { state: "compliant"; freeCount: number; paidCount: number }
    | { state: "non-compliant"; freeCount: number; paidCount: number; reason: string }
    | { state: "error"; message: string };

export function usePaidRatioStatus(options: {
    boundAuthorNames: string[];
    authorProStatuses: Record<string, AuthorProStatus>;
    astroboxToken?: string;
    githubToken?: string;
    paidType?: string;
    resourceId?: string;
}): PaidRatioStatus {
    const { boundAuthorNames, authorProStatuses, astroboxToken, githubToken, paidType, resourceId } = options;
    const [status, setStatus] = useState<PaidRatioStatus>({ state: "idle" });

    const key = boundAuthorNames.join("\u0001");
    const paidKind = entryPaidKind(paidType || "");

    useEffect(() => {
        if (paidKind !== "paid") {
            setStatus({ state: "not-applicable" });
            return;
        }
        if (boundAuthorNames.length === 0) {
            setStatus({ state: "not-applicable" });
            return;
        }
        if (!astroboxToken || !githubToken) {
            setStatus({ state: "not-applicable" });
            return;
        }

        let cancelled = false;
        setStatus({ state: "loading" });

        (async () => {
            for (const name of boundAuthorNames) {
                const proStatus = authorProStatuses[name];
                if (!proStatus || proStatus.state !== "found") continue;

                const active = isVipActive(proStatus.user.vip, proStatus.user.vipExpireMap);
                if (hasCreatorPro(proStatus.user.vip) && active) continue;

                const result = await checkPaidFreeRatioForAuthor({
                    authorName: name,
                    authorStatus: proStatus,
                    astroboxToken,
                    githubToken,
                    newEntryPaidType: paidType,
                    newEntryId: resourceId,
                });

                if (cancelled) return;

                if (result.error) {
                    setStatus({ state: "error", message: result.error });
                    return;
                }
                if (result.ratio) {
                    const totalFree = result.resources.filter((r) => r.paidKind === "free").length;
                    const totalPaid = result.resources.filter((r) => r.paidKind === "paid").length;
                    if (!result.ratio.compliant) {
                        setStatus({
                            state: "non-compliant",
                            freeCount: totalFree,
                            paidCount: totalPaid,
                            reason: result.ratio.reason,
                        });
                        return;
                    }
                    setStatus({
                        state: "compliant",
                        freeCount: totalFree,
                        paidCount: totalPaid,
                    });
                    return;
                }
            }
            setStatus({ state: "not-applicable" });
        })();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, astroboxToken, githubToken, paidKind, resourceId, JSON.stringify(boundAuthorNames.map((n) => authorProStatuses[n]?.state))]);

    return status;
}

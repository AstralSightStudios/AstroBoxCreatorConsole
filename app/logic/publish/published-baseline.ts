/**
 * 读取「已合入索引」的包体版本，作为 versionCode 递增判定的基线。
 *
 * 编辑未合入的 PR 时，PR 分支上的 manifest 属于尚未发布的状态：直接拿它当基线，
 * 创作者每替换一次包体就得再涨一次 versionCode。递增要求的唯一合法基准是索引
 * 指向的那个已合入版本，因此这里按资源 ID 回查索引，再读它对应的 manifest。
 *
 * 索引里没有该资源（首次发布）时返回 undefined，调用方据此清空基线，递增检查不参与。
 */
import type { ManifestDownloadInfo } from "./manifest";
import { fetchCatalogEntries, findCatalogEntryById } from "./catalog";
import { fetchManifestForCatalogEntry } from "./manifest-loader";
import type { PublishedDownloadBaseline } from "./pre-publish-checks";

export interface PublishedBaselines {
    downloads?: Record<string, PublishedDownloadBaseline>;
    trialDownloads?: Record<string, PublishedDownloadBaseline>;
}

/** 从 manifest 的 downloads 字段取出设备 → 版本映射，顺带剔除非对象脏数据。 */
function toBaselineRecord(
    downloads: unknown,
): Record<string, PublishedDownloadBaseline> | undefined {
    if (!downloads || typeof downloads !== "object" || Array.isArray(downloads)) {
        return undefined;
    }
    const record = downloads as Record<string, Partial<ManifestDownloadInfo>>;
    const result: Record<string, PublishedDownloadBaseline> = {};
    for (const [deviceId, info] of Object.entries(record)) {
        if (!info || typeof info !== "object") continue;
        result[deviceId] = {
            version: typeof info.version === "string" ? info.version : undefined,
            versionCode:
                typeof info.versionCode === "number" ? info.versionCode : undefined,
        };
    }
    return result;
}

/**
 * 按资源 ID 取索引中已合入包体的版本基线。
 *
 * 索引与 `loadOwnedCatalogResourcesForCurrentUser` 同源（当前仓库环境），保证
 * 「管理页看到的是已上架版本」与「递增基线的值」不会来自两个不同的环境。
 * 资源不在索引里返回 undefined；读取链路本身抛错则由调用方决定如何降级。
 */
export async function fetchPublishedBaselinesForResourceId(params: {
    token: string;
    resourceId: string;
}): Promise<PublishedBaselines | undefined> {
    const { token, resourceId } = params;
    const { entries } = await fetchCatalogEntries({ token });
    const entry = findCatalogEntryById(entries, resourceId);
    if (!entry) return undefined;

    const { manifest } = await fetchManifestForCatalogEntry({
        entry,
        token,
        ref: entry.repo_commit_hash.trim() || undefined,
    });
    const ext = manifest.ext;
    return {
        downloads: toBaselineRecord(manifest.downloads),
        trialDownloads: toBaselineRecord(ext?.trialDownloads),
    };
}

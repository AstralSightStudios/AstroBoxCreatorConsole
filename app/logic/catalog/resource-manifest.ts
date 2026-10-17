import { loadAccountState } from "~/logic/account/store";
import {
  fetchManifestForCatalogEntry,
  type ManifestV2,
} from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import type { IndexV2Entry } from "./index-v2";

export interface ResourceManifestInfo {
  manifest: ManifestV2;
  raw: string;
}

/** 把已解析的目录条目还原成目录写入用的结构，供仓库文件读取复用。 */
export function indexEntryToCatalogEntry(entry: IndexV2Entry): CatalogEntry {
  return {
    id: entry.id,
    name: entry.name,
    restype: entry.restype,
    repo_owner: entry.repo_owner,
    repo_name: entry.repo_name,
    repo_commit_hash: entry.repo_commit_hash,
    icon: entry.icon,
    cover: entry.cover,
    tags: entry.tags.join(";"),
    device_vendors: entry.device_vendors.join(";"),
    devices: entry.devices.join(";"),
    paid_type: entry.paid_type,
  };
}

/**
 * 读取资源仓库在该 commit 下的 manifest_v2.json。
 * 使用当前登录的 GitHub token，仓库私有也可读。
 */
export async function loadResourceManifest(
  entry: IndexV2Entry,
): Promise<ResourceManifestInfo> {
  const token = loadAccountState().github?.token;
  if (!token) {
    throw new Error("未登录 GitHub，无法读取资源仓库的 manifest_v2.json。");
  }

  const result = await fetchManifestForCatalogEntry({
    entry: indexEntryToCatalogEntry(entry),
    token,
  });

  return { manifest: result.manifest, raw: result.raw };
}

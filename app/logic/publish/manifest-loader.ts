import { PUBLISH_CONFIG } from "~/config/publish";
import type { CatalogEntry } from "./catalog";
import { getRepoFile, type RepoInfo } from "./github-actions";

export interface ManifestV2 {
    item: {
        id: string;
        restype: string;
        name: string;
        description: string;
        preview: string[];
        icon: string;
        cover: string;
        author?: Array<{ name: string; bindABAccount?: boolean }>;
    };
    links?: Array<{ title: string; url: string; icon?: string }>;
    downloads?: Record<string, { version?: string; file_name?: string }>;
    ext?: any;
}

function decodeBase64(content?: string) {
    if (!content) return "";
    return new TextDecoder().decode(
        Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
    );
}

export function buildRawFileUrl(owner: string, repo: string, ref: string, path: string) {
    const encodedPath = path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodedPath}`;
}

export async function fetchManifestForCatalogEntry(options: {
    entry: CatalogEntry;
    token: string;
    ref?: string;
}): Promise<{ manifest: ManifestV2; raw: string; repo: RepoInfo; sha?: string }> {
    const { entry, token, ref } = options;
    const branch = PUBLISH_CONFIG.defaultBranch;
    const repo: RepoInfo = {
        owner: entry.repo_owner,
        name: entry.repo_name,
        branch,
    };
    const fetchRef = ref || entry.repo_commit_hash || branch;

    const response = await getRepoFile({
        repo,
        path: PUBLISH_CONFIG.manifestFileName,
        tokenOverride: token,
        ref: fetchRef,
    });

    const raw = decodeBase64(response.content);
    const manifest = raw ? (JSON.parse(raw) as ManifestV2) : undefined;

    if (!manifest?.item) {
        throw new Error("未找到 manifest_v2.json 或格式无效。");
    }

    return { manifest, raw, repo, sha: response.sha as string | undefined };
}

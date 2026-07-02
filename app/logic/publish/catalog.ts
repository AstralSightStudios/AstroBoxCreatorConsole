import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import type { RepoInfo } from "./github-actions";
import { ensureBase64, githubFetch, createPullRequest } from "./github-actions";

export interface CatalogEntry {
    id: string;
    name: string;
    restype: string;
    repo_owner: string;
    repo_name: string;
    repo_commit_hash: string;
    icon: string;
    cover: string;
    tags: string;
    device_vendors: string;
    devices: string;
    paid_type: string;
}

export interface CatalogUpdateRequest {
    repoInfo: RepoInfo & { commitSha: string };
    iconPath: string;
    coverPath: string;
    tags: string[];
    devices: Array<{ id: string; vendor?: string }>;
    itemId: string;
    itemName: string;
    restype: string;
    paidType?: string;
}

const CATALOG_CSV_COLUMNS = [
    "id",
    "name",
    "restype",
    "repo_owner",
    "repo_name",
    "repo_commit_hash",
    "icon",
    "cover",
    "tags",
    "device_vendors",
    "devices",
    "paid_type",
] as const satisfies ReadonlyArray<keyof CatalogEntry>;

const CATALOG_CSV_HEADER = CATALOG_CSV_COLUMNS.join(",");
const CSV_STRUCTURAL_CHAR_PATTERN = /[,\r\n\0]/;

export function validateCatalogEntryForCsv(entry: CatalogEntry) {
    for (const column of CATALOG_CSV_COLUMNS) {
        const value = entry[column];
        if (typeof value !== "string") {
            throw new Error(`CSV 字段 ${column} 必须是字符串，无法写入目录。`);
        }
        if (CSV_STRUCTURAL_CHAR_PATTERN.test(value)) {
            throw new Error(
                `CSV 字段 ${column} 不能包含逗号、换行或 NUL 字符，否则会破坏目录结构。请修改后重试。`,
            );
        }
    }
}

export function decodeCatalogContent(encoded?: string) {
    if (!encoded) return "";
    return new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    );
}

export function parseCatalogCsv(csv: string): CatalogEntry[] {
    const rows = csv
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (rows.length === 0) return [];
    const dataRows = rows.slice(1);
    const entries: CatalogEntry[] = [];
    for (const row of dataRows) {
        const cols = row.split(",");
        if (cols.length < 12) continue;
        entries.push({
            id: cols[0],
            name: cols[1],
            restype: cols[2],
            repo_owner: cols[3],
            repo_name: cols[4],
            repo_commit_hash: cols[5],
            icon: cols[6],
            cover: cols[7],
            tags: cols[8],
            device_vendors: cols[9],
            devices: cols[10],
            paid_type: cols[11] ?? "",
        });
    }
    return entries;
}

function getGithubTokenOrThrow() {
    const token = loadAccountState().github?.token;
    if (!token) {
        throw new Error("未登录 GitHub，无法更新目录文件。");
    }
    return token;
}

async function getOrCreateFork(token: string, owner: string, repo: string) {
    const fork = await githubFetch<any>(
        `https://api.github.com/repos/${owner}/${repo}/forks`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );
    return {
        owner: fork.owner.login,
        name: fork.name,
        default_branch: fork.default_branch,
    };
}

async function getRefSha(token: string, owner: string, repo: string, ref: string) {
    const data = await githubFetch<any>(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/${ref}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );
    return data.object.sha as string;
}

async function createBranch(
    token: string,
    owner: string,
    repo: string,
    baseSha: string,
    branch: string,
) {
    return githubFetch<any>(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: baseSha,
        }),
    });
}

export async function getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
) {
    return githubFetch<any>(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );
}

export async function fetchCatalogEntries(options?: {
    token?: string;
    owner?: string;
    repo?: string;
    ref?: string;
    path?: string;
}) {
    const token = options?.token ?? getGithubTokenOrThrow();
    const owner = options?.owner ?? PUBLISH_CONFIG.upstreamRepoOwner;
    const repo = options?.repo ?? PUBLISH_CONFIG.upstreamRepoName;
    const ref = options?.ref ?? PUBLISH_CONFIG.defaultBranch;
    const path = options?.path ?? PUBLISH_CONFIG.catalogFilePath;

    const fileData = await getFileContent(token, owner, repo, path, ref);
    const csvContent = decodeCatalogContent(fileData.content);
    return {
        entries: parseCatalogCsv(csvContent),
        csvContent,
        sha: fileData.sha as string | undefined,
        owner,
        repo,
        ref,
    };
}

async function updateFile(
    token: string,
    owner: string,
    repo: string,
    path: string,
    branch: string,
    content: string,
    sha: string,
    message: string,
) {
    return githubFetch<any>(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
        {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
                message,
                content,
                sha,
                branch,
            }),
        },
    );
}

function appendOrReplaceCsvRow(existingCsv: string, entry: CatalogEntry) {
    validateCatalogEntryForCsv(entry);

    const rows = existingCsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const header = rows[0] || "";
    const dataRows = rows.slice(1);

    const rowString = CATALOG_CSV_COLUMNS.map((column) => entry[column]).join(",");

    const filtered = dataRows.filter((line) => !line.startsWith(`${entry.id},`));
    filtered.push(rowString);
    return [header || CATALOG_CSV_HEADER, ...filtered].join("\n");
}

export async function updateCatalogCsv(payload: CatalogUpdateRequest) {
    const token = getGithubTokenOrThrow();
    const upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner;
    const upstreamRepo = PUBLISH_CONFIG.upstreamRepoName;
    const vendors = Array.from(
        new Set(payload.devices.map((d) => d.vendor).filter(Boolean)),
    ).join(";");
    const deviceIds = Array.from(new Set(payload.devices.map((d) => d.id))).join(";");

    const entry: CatalogEntry = {
        id: payload.itemId.trim(),
        name: payload.itemName.trim(),
        restype: payload.restype,
        repo_owner: payload.repoInfo.owner,
        repo_name: payload.repoInfo.name,
        repo_commit_hash: payload.repoInfo.commitSha.slice(0, 7),
        icon: payload.iconPath,
        cover: payload.coverPath,
        tags: payload.tags.join(";"),
        device_vendors: vendors,
        devices: deviceIds,
        paid_type: payload.paidType?.trim() ?? "",
    };
    validateCatalogEntryForCsv(entry);

    const fork = await getOrCreateFork(token, upstreamOwner, upstreamRepo);

    const upstreamSha = await getRefSha(
        token,
        upstreamOwner,
        upstreamRepo,
        `heads/${PUBLISH_CONFIG.defaultBranch}`,
    );
    const branchName = `astrobox-submit-${Date.now()}`;
    await createBranch(token, fork.owner, fork.name, upstreamSha, branchName);

    const fileData = await getFileContent(
        token,
        fork.owner,
        fork.name,
        PUBLISH_CONFIG.catalogFilePath,
        branchName,
    );
    const csvContent = decodeCatalogContent(fileData.content);

    const updatedCsv = appendOrReplaceCsvRow(csvContent, entry);
    const encoded = ensureBase64(updatedCsv);

    await updateFile(
        token,
        fork.owner,
        fork.name,
        PUBLISH_CONFIG.catalogFilePath,
        branchName,
        encoded,
        fileData.sha,
        `Add ${entry.id} to catalog`,
    );

    return {
        forkOwner: fork.owner,
        forkRepo: fork.name,
        branch: branchName,
    };
}

export async function createCatalogPullRequest({
    forkOwner,
    forkRepo,
    branch,
    token,
    title,
    body,
}: {
    forkOwner: string;
    forkRepo: string;
    branch: string;
    token: string;
    title: string;
    body?: string;
}) {
    return createPullRequest({
        token,
        baseOwner: PUBLISH_CONFIG.targetPrRepoOwner,
        baseRepo: PUBLISH_CONFIG.targetPrRepoName,
        baseBranch: PUBLISH_CONFIG.defaultBranch,
        headOwner: forkOwner,
        headRepo: forkRepo,
        headBranch: branch,
        title,
        body,
    });
}

export async function updateCatalogEntryOnBranch(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    entry: CatalogEntry;
}) {
    const { token, owner, repo, branch, entry } = params;
    validateCatalogEntryForCsv(entry);

    const fileData = await getFileContent(
        token,
        owner,
        repo,
        PUBLISH_CONFIG.catalogFilePath,
        branch,
    );
    const csvContent = decodeCatalogContent(fileData.content);
    const updatedCsv = appendOrReplaceCsvRow(csvContent, entry);
    const encoded = ensureBase64(updatedCsv);

    await updateFile(
        token,
        owner,
        repo,
        PUBLISH_CONFIG.catalogFilePath,
        branch,
        encoded,
        fileData.sha,
        `Update ${entry.id} in catalog`,
    );
}

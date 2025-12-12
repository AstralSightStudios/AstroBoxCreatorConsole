import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import type { RepoInfo } from "./github-actions";
import { ensureBase64, githubFetch, createPullRequest } from "./github-actions";

interface CsvEntry {
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

async function getFileContent(
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

function appendOrReplaceCsvRow(existingCsv: string, entry: CsvEntry) {
    const rows = existingCsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const header = rows[0] || "";
    const dataRows = rows.slice(1);

    const rowString = [
        entry.id,
        entry.name,
        entry.restype,
        entry.repo_owner,
        entry.repo_name,
        entry.repo_commit_hash,
        entry.icon,
        entry.cover,
        entry.tags,
        entry.device_vendors,
        entry.devices,
        entry.paid_type,
    ].join(",");

    const filtered = dataRows.filter((line) => !line.startsWith(`${entry.id},`));
    filtered.push(rowString);
    return [header || "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type", ...filtered].join(
        "\n",
    );
}

export async function updateCatalogCsv(payload: CatalogUpdateRequest) {
    const token = getGithubTokenOrThrow();
    const upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner;
    const upstreamRepo = PUBLISH_CONFIG.upstreamRepoName;

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
    const csvContent = fileData.content
        ? new TextDecoder().decode(
              Uint8Array.from(atob(fileData.content), (c) => c.charCodeAt(0)),
          )
        : "";

    const vendors = Array.from(
        new Set(payload.devices.map((d) => d.vendor).filter(Boolean)),
    ).join(";");
    const deviceIds = Array.from(new Set(payload.devices.map((d) => d.id))).join(";");

    const entry: CsvEntry = {
        id: payload.itemId.trim(),
        name: payload.itemName.trim(),
        restype: payload.restype,
        repo_owner: payload.repoInfo.owner,
        repo_name: payload.repoInfo.name,
        repo_commit_hash: payload.repoInfo.commitSha,
        icon: payload.iconPath,
        cover: payload.coverPath,
        tags: payload.tags.join(";"),
        device_vendors: vendors,
        devices: deviceIds,
        paid_type: payload.paidType?.trim() ?? "",
    };

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

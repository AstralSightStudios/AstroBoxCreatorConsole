import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import {
    createBlob,
    createCommit,
    createPullRequest,
    createTree,
    ensureBase64,
    getBranchHead,
    githubFetch,
    updateRef,
    type RepoInfo,
} from "./github-actions";
import {
    createBranch,
    fetchCatalogEntries,
    getOrCreateFork,
    getRefSha,
    normalizeCatalogPaidType,
    type CatalogEntry,
    type CatalogUpdateRequest,
} from "./catalog";
import { syncForkDefaultBranch } from "./fork";
import {
    buildCreateSubmissionRequest,
    buildSubmissionCsv,
    buildSubmissionPath,
    buildSubmissionRequest,
    canonicalCatalogEntryDigest,
    submissionCsvPath,
    submissionRequestPath,
    type SubmissionRequest,
} from "./submission-protocol";

function getGithubTokenOrThrow() {
    const token = loadAccountState().github?.token;
    if (!token) throw new Error("未登录 GitHub，无法提交资源请求。");
    return token;
}

function requireGithubLogin() {
    const login = loadAccountState().github?.username?.trim();
    if (!login) throw new Error("GitHub 账号缺少用户名，无法创建提交路径。");
    return login;
}

export function buildSubmissionEntry(payload: CatalogUpdateRequest): CatalogEntry {
    const vendors = Array.from(
        new Set(payload.devices.map((device) => device.vendor).filter(Boolean)),
    ).join(";");
    const deviceIds = Array.from(
        new Set(payload.devices.map((device) => device.id)),
    ).join(";");
    return {
        id: payload.itemId.trim(),
        name: payload.itemName.trim(),
        restype: payload.restype,
        repo_owner: payload.repoInfo.owner.toLowerCase(),
        repo_name: payload.repoInfo.name.toLowerCase(),
        repo_commit_hash: payload.repoInfo.commitSha.slice(0, 7),
        icon: payload.iconPath,
        cover: payload.coverPath,
        tags: payload.tags.join(";"),
        device_vendors: vendors,
        devices: deviceIds,
        paid_type: normalizeCatalogPaidType(payload.paidType),
    };
}

async function listOpenPullNumbers(token: string): Promise<number[]> {
    const pulls = await githubFetch<
        Array<{ number: number }>
    >(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls?state=open&per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    return pulls.map((pull) => pull.number);
}

async function hasPendingSubmissionPath(
    token: string,
    submissionPath: string,
): Promise<boolean> {
    const numbers = await listOpenPullNumbers(token);
    for (const number of numbers) {
        const files = await githubFetch<
            Array<{ filename?: string }>
        >(
            `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls/${number}/files?per_page=100`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (files.some((file) => file.filename?.startsWith(`${submissionPath}/`))) {
            return true;
        }
    }
    return false;
}

async function commitFilesToBranch(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    files: Array<{ path: string; content: string }>;
    message: string;
}) {
    const { token, owner, repo, branch, files, message } = params;
    const repoInfo: RepoInfo = { owner, name: repo, branch };
    const head = await getBranchHead(repoInfo, token);

    const blobEntries = [];
    for (const file of files) {
        const sha = await createBlob(
            repoInfo,
            ensureBase64(file.content),
            token,
        );
        blobEntries.push({
            sha,
            path: file.path,
            mode: "100644" as const,
            type: "blob" as const,
        });
    }

    const treeSha = await createTree(repoInfo, head.treeSha, blobEntries, token);
    const commitSha = await createCommit(
        repoInfo,
        message,
        treeSha,
        head.commitSha,
        token,
    );
    await updateRef(repoInfo, commitSha, token);
    return commitSha;
}

export async function createSubmissionBranch(payload: CatalogUpdateRequest) {
    const token = getGithubTokenOrThrow();
    const githubLogin = requireGithubLogin();
    const entry = buildSubmissionEntry(payload);
    const upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner;
    const upstreamRepo = PUBLISH_CONFIG.upstreamRepoName;
    const defaultBranch = PUBLISH_CONFIG.defaultBranch;

    const latest = await fetchCatalogEntries({ token });
    const upstreamCommit = await getRefSha(
        token,
        upstreamOwner,
        upstreamRepo,
        `heads/${defaultBranch}`,
    );

    const intent = payload.intent;
    if (intent.mode === "create") {
        const duplicateId = latest.entries.find(
            (item) => item.id.trim() === entry.id.trim(),
        );
        if (duplicateId) {
            throw new Error(
                `资源 ID "${entry.id}" 已被「${duplicateId.name || duplicateId.id}」占用。`,
            );
        }
        const duplicateRepo = latest.entries.find(
            (item) =>
                item.repo_owner.toLowerCase() === entry.repo_owner.toLowerCase() &&
                item.repo_name.toLowerCase() === entry.repo_name.toLowerCase(),
        );
        if (duplicateRepo) {
            throw new Error(
                `资源仓库 ${entry.repo_owner}/${entry.repo_name} 已被资源「${duplicateRepo.name || duplicateRepo.id}」占用。`,
            );
        }
    } else {
        const originalId = intent.originalId.trim();
        const original = latest.entries.find(
            (item) => item.id.trim() === originalId,
        );
        if (!original) {
            throw new Error(`未在目录中找到原资源 ID "${originalId}"。`);
        }
    }

    const submissionPath = buildSubmissionPath(
        githubLogin,
        entry.repo_name,
    );

    if (intent.mode === "create") {
        if (await hasPendingSubmissionPath(token, submissionPath)) {
            throw new Error(
                `路径 ${submissionPath} 已有未处理请求，请等待处理或继续编辑原 PR。`,
            );
        }
    }

    const fork = await getOrCreateFork(token, upstreamOwner, upstreamRepo);
    await syncForkDefaultBranch({
        token,
        forkOwner: fork.owner,
        forkRepo: fork.name,
        branch: fork.default_branch,
        upstreamOwner,
        upstreamRepo,
    });
    const forkHeadSha = await getRefSha(
        token,
        fork.owner,
        fork.name,
        `heads/${fork.default_branch}`,
    );
    const branchName = `astrobox-submit-${Date.now()}`;
    await createBranch(token, fork.owner, fork.name, forkHeadSha, branchName);

    let request: SubmissionRequest;
    if (intent.mode === "create") {
        request = buildCreateSubmissionRequest();
    } else {
        const originalId = intent.originalId.trim();
        const original = latest.entries.find(
            (item) => item.id.trim() === originalId,
        )!;
        request = {
            schema_version: 1,
            mode: "edit",
            original_id: originalId,
            base_entry_digest: await canonicalCatalogEntryDigest(original),
            base_catalog_commit: upstreamCommit,
        };
    }

    await commitFilesToBranch({
        token,
        owner: fork.owner,
        repo: fork.name,
        branch: branchName,
        message: `Submit resource ${entry.id}`,
        files: [
            {
                path: submissionCsvPath(submissionPath),
                content: buildSubmissionCsv(entry),
            },
            {
                path: submissionRequestPath(submissionPath),
                content: buildSubmissionRequest(request),
            },
        ],
    });

    return {
        forkOwner: fork.owner,
        forkRepo: fork.name,
        branch: branchName,
        submissionPath,
        request,
        entry,
    };
}

export async function createSubmissionPullRequest(params: {
    forkOwner: string;
    forkRepo: string;
    branch: string;
    token: string;
    title: string;
    body?: string;
}) {
    return createPullRequest({
        token: params.token,
        baseOwner: PUBLISH_CONFIG.targetPrRepoOwner,
        baseRepo: PUBLISH_CONFIG.targetPrRepoName,
        baseBranch: PUBLISH_CONFIG.defaultBranch,
        headOwner: params.forkOwner,
        headRepo: params.forkRepo,
        headBranch: params.branch,
        title: params.title,
        body: params.body,
    });
}

export async function updateSubmissionEntryOnBranch(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    entry: CatalogEntry;
    request: SubmissionRequest;
    submissionPath: string;
}) {
    const { token, owner, repo, branch, entry, request, submissionPath } = params;
    await commitFilesToBranch({
        token,
        owner,
        repo,
        branch,
        message: `Update resource submission ${entry.id}`,
        files: [
            {
                path: submissionCsvPath(submissionPath),
                content: buildSubmissionCsv(entry),
            },
            {
                path: submissionRequestPath(submissionPath),
                content: buildSubmissionRequest(request),
            },
        ],
    });
}

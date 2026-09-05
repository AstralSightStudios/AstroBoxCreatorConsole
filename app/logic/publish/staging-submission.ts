import { PUBLISH_CONFIG } from "~/config/publish";
import { log } from "~/logic/logging";
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
    buildClientInfo,
    buildCreateSubmissionRequest,
    buildEditSubmissionRequest,
    buildSubmissionCsv,
    buildSubmissionPath,
    buildSubmissionRequest,
    canonicalCatalogEntryDigest,
    isSubmissionFilePath,
    parseSubmissionCsv,
    parseSubmissionRequestJson,
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
        repo_owner: payload.repoInfo.owner,
        repo_name: payload.repoInfo.name,
        repo_commit_hash: payload.repoInfo.commitSha.slice(0, 7),
        icon: payload.iconPath,
        cover: payload.coverPath,
        tags: payload.tags.join(";"),
        device_vendors: vendors,
        devices: deviceIds,
        paid_type: normalizeCatalogPaidType(payload.paidType),
    };
}

async function listOpenPulls(
    token: string,
): Promise<Array<{ number: number; title: string }>> {
    const pulls = await githubFetch<
        Array<{ number: number; title?: string }>
    >(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls?state=open&per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    return pulls.map((pull) => ({ number: pull.number, title: pull.title ?? "" }));
}

/** 经 Git Blobs API 读取文件内容（pull files 端点只给 sha）。 */
async function fetchBlobText(token: string, sha: string): Promise<string> {
    const blob = await githubFetch<{ content?: string; encoding?: string }>(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/git/blobs/${sha}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (blob.encoding !== "base64" || !blob.content) return "";
    const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (ch) =>
        ch.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
}

function sameResourceId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export interface PendingSubmissionConflict {
    prNumber: number;
    prTitle: string;
    /** 命中的 PR 是否与本次提交路径完全相同（同用户重复提交场景）。 */
    samePath: boolean;
}

/**
 * 扫描所有开放 PR，检测与本次提交的冲突：
 * - B1 同路径：同一 tmp/{login}/{repo} 路径已有未处理请求（含解析失败兜底，
 *   行为与旧版 hasPendingSubmissionPath 一致）；
 * - B2 跨用户：任何开放 PR 的提交明细指向同一资源 ID（edit 的 original_id 或
 *   csv 行 id），无论路径是否相同。
 * 解析失败的历史/脏数据一律跳过，不阻塞正常提交。
 */
async function findPendingSubmissionConflicts(
    token: string,
    submissionPath: string,
    entry: CatalogEntry,
): Promise<PendingSubmissionConflict | null> {
    const pulls = await listOpenPulls(token);
    for (const pull of pulls) {
        const files = await githubFetch<
            Array<{ filename?: string; sha?: string }>
        >(
            `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls/${pull.number}/files?per_page=100`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        let samePath = false;
        let idConflict = false;
        for (const file of files) {
            const filePath = file.filename ?? "";
            if (!isSubmissionFilePath(filePath)) continue;
            if (filePath.startsWith(`${submissionPath}/`)) {
                samePath = true;
            }
            if (!file.sha) continue;
            try {
                const text = await fetchBlobText(token, file.sha);
                if (!text) continue;
                if (filePath.endsWith(".json")) {
                    const request = parseSubmissionRequestJson(text);
                    if (
                        request.mode === "edit" &&
                        typeof request.original_id === "string" &&
                        sameResourceId(request.original_id, entry.id)
                    ) {
                        idConflict = true;
                    }
                } else {
                    const parsed = parseSubmissionCsv(text);
                    if (sameResourceId(parsed.id, entry.id)) {
                        idConflict = true;
                    }
                }
            } catch {
                // 历史/脏数据解析失败：跳过该文件，不中断提交流程。
                continue;
            }
        }

        // 内容确认不了但同路径已存在 → 与旧行为一致，保守视为待处理请求。
        if (idConflict || samePath) {
            return { prNumber: pull.number, prTitle: pull.title, samePath };
        }
    }
    return null;
}

/**
 * 扫描所有开放 PR，返回第一个已引用该资源 ID 的提交（edit 的 original_id
 * 或 csv 行 id 命中即视为冲突）。解析失败的历史/脏数据跳过；无命中返回 null。
 * 供「管理」页进入编辑前预检：已有进行中 PR 时直接引导到审核页继续编辑。
 */
export async function findOpenSubmissionForResourceId(
    token: string,
    resourceId: string,
): Promise<{ prNumber: number; prTitle: string } | null> {
    const pulls = await listOpenPulls(token);
    for (const pull of pulls) {
        const files = await githubFetch<
            Array<{ filename?: string; sha?: string }>
        >(
            `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls/${pull.number}/files?per_page=100`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        for (const file of files) {
            const filePath = file.filename ?? "";
            if (!isSubmissionFilePath(filePath)) continue;
            if (!file.sha) continue;
            try {
                const text = await fetchBlobText(token, file.sha);
                if (!text) continue;
                if (filePath.endsWith(".json")) {
                    const request = parseSubmissionRequestJson(text);
                    if (
                        request.mode === "edit" &&
                        typeof request.original_id === "string" &&
                        sameResourceId(request.original_id, resourceId)
                    ) {
                        return { prNumber: pull.number, prTitle: pull.title };
                    }
                } else {
                    const parsed = parseSubmissionCsv(text);
                    if (sameResourceId(parsed.id, resourceId)) {
                        return { prNumber: pull.number, prTitle: pull.title };
                    }
                }
            } catch {
                // 历史/脏数据解析失败：跳过该文件，不误判为冲突。
                continue;
            }
        }
    }
    return null;
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
                `仓库 ${entry.repo_owner}/${entry.repo_name} 已经在 AstroBox 的软件索引里，被资源「${duplicateRepo.name || duplicateRepo.id}」占用，请更换仓库名。`,
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

    // 重复提交守卫：create/edit 都要查。同路径 = 同用户重复开 PR；
    // 跨用户 = 别人正开着另一个 PR 改同一资源。
    const conflict = await findPendingSubmissionConflicts(
        token,
        submissionPath,
        entry,
    );
    if (conflict) {
        if (conflict.samePath) {
            throw new Error(
                `路径 ${submissionPath} 已有未处理请求（PR #${conflict.prNumber}），` +
                `请等待处理或继续编辑原 PR。`,
            );
        }
        throw new Error(
            `资源 "${entry.id}" 已有进行中的提交 PR #${conflict.prNumber}《${conflict.prTitle}》，` +
            `请等待其处理完成，或通过「管理」页在原 PR 上继续更新。`,
        );
    }

    const fork = await getOrCreateFork(token, upstreamOwner, upstreamRepo);
    log.info("publish/fork", `fork 就绪 ${fork.owner}/${fork.name}`, {
      data: { defaultBranch: fork.default_branch },
    });
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
    log.info("publish/branch", `提交分支已创建 ${branchName}`, {
      data: { base: `${fork.owner}/${fork.name}@${forkHeadSha.slice(0, 7)}` },
    });

    let request: SubmissionRequest;
    if (intent.mode === "create") {
        request = await buildCreateSubmissionRequest(upstreamCommit);
    } else {
        const originalId = intent.originalId.trim();
        const original = latest.entries.find(
            (item) => item.id.trim() === originalId,
        )!;
        request = await buildEditSubmissionRequest({
            originalId,
            baseEntryDigest: await canonicalCatalogEntryDigest(original),
            baseCatalogCommit: upstreamCommit,
        });
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
    // 每次写入 request.json 都刷新 client 信息，确保反映当前使用的 CC 版本
    // 与构建来源（编辑旧 PR 时可为历史请求补上缺失的 client 字段）。
    const refreshed: SubmissionRequest = {
        ...request,
        client: await buildClientInfo(),
    };
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
                content: buildSubmissionRequest(refreshed),
            },
        ],
    });
}

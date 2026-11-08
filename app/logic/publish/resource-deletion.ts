import { loadAccountState } from "../account/store";
import type { CatalogEntry } from "./catalog";
import {
    deleteUserRepository,
    getUserRepository,
    isGithubStatus,
} from "./github-actions";
import {
    createDeletionSubmissionBranch,
    createSubmissionPullRequest,
    type PreparedDeletionSubmission,
} from "./staging-submission";

export type { PreparedDeletionSubmission } from "./staging-submission";

export const DELETE_RESOURCE_CONFIRMATION =
    "我已知悉后果，确认从AstroBox删除此资源。";
export const DELETE_RESOURCE_AND_REPO_CONFIRMATION =
    "我已知悉后果，确认从AstroBox删除此资源索引，并删除资源所在仓库，明白仓库无法恢复。";

export type ResourceDeletionErrorCode =
    | "missing-token"
    | "scope-missing"
    | "repo-not-owned"
    | "repo-no-admin";

export class ResourceDeletionError extends Error {
    constructor(
        message: string,
        readonly code: ResourceDeletionErrorCode,
    ) {
        super(message);
        this.name = "ResourceDeletionError";
    }
}

/** 与 ExtSection 的 LegacyItem 前缀判断保持一致。 */
export function isLegacyItemId(id: string): boolean {
    return id.trim().startsWith("LegacyItem");
}

export function requiredDeletionConfirmation(deleteRepository: boolean): string {
    return deleteRepository
        ? DELETE_RESOURCE_AND_REPO_CONFIRMATION
        : DELETE_RESOURCE_CONFIRMATION;
}

export function buildDeletionPullRequestTitle(entry: CatalogEntry): string {
    return `[ABCC] Delete resource: ${entry.name.trim() || entry.id.trim()}`;
}

/**
 * 删除 PR 描述。确认语句按用户实际输入的分支写入，供 Action 与维护者审计。
 * 注意“仓库处理”是创建 PR 时的事实：勾选删仓库时，仓库已在 PR 创建前删除。
 */
export function buildDeletionPullRequestBody(params: {
    entry: CatalogEntry;
    deleteRepository: boolean;
    repoDeleted: boolean;
}): string {
    const { entry, deleteRepository, repoDeleted } = params;
    const confirmation = deleteRepository
        ? "创作者已确认删除此资源，并“已知悉后果，确认从AstroBox删除此资源索引，并删除资源所在仓库，明白仓库无法恢复。”"
        : "创作者已确认删除此资源，并“已知悉后果，确认从AstroBox删除此资源”";
    return [
        "## 删除资源申请",
        "",
        `- 资源：${entry.name.trim() || entry.id.trim()}`,
        `- 资源 ID：${entry.id.trim()}`,
        `- 资源仓库：${entry.repo_owner}/${entry.repo_name}`,
        `- 仓库处理：${repoDeleted ? "已删除" : "保留"}`,
        "",
        confirmation,
        "",
    ].join("\n");
}

/** 准备删除申请的分支与两个提交文件；此时还不会创建 PR。 */
export async function prepareResourceDeletion(
    entry: CatalogEntry,
): Promise<PreparedDeletionSubmission> {
    return createDeletionSubmissionBranch(entry);
}

export type RepositoryDeletionResult = "deleted" | "already-gone";

/**
 * 在创建删除 PR 之前删除资源仓库。
 *
 * 只允许删除当前账号本人所有的仓库；目录里记录的 owner/name 是唯一目标，
 * 不做跨资源共享仓库检查（一个资源对应一个仓库）。
 */
export async function deleteResourceRepository(params: {
    entry: CatalogEntry;
    token?: string;
    expectedLogin?: string;
    onProgress?: (message: string) => void;
}): Promise<RepositoryDeletionResult> {
    const account = loadAccountState().github;
    const token = params.token ?? account?.token;
    if (!token) {
        throw new ResourceDeletionError(
            "未登录 GitHub，无法删除仓库。",
            "missing-token",
        );
    }
    const expectedLogin = (
        params.expectedLogin ??
        account?.username ??
        ""
    ).trim();
    if (!expectedLogin) {
        throw new ResourceDeletionError(
            "缺少 GitHub 用户名，无法确认仓库归属。",
            "missing-token",
        );
    }
    const scopes = account?.scopes ?? [];
    if (scopes.length > 0 && !scopes.includes("delete_repo")) {
        throw new ResourceDeletionError(
            "当前 GitHub 授权缺少 delete_repo 权限，无法删除仓库。请前往设置退出 GitHub 后重新登录。",
            "scope-missing",
        );
    }

    params.onProgress?.("正在检查 GitHub 仓库…");
    let repository;
    try {
        repository = await getUserRepository(
            params.entry.repo_owner,
            params.entry.repo_name,
            token,
        );
    } catch (error) {
        if (isGithubStatus(error, 404)) return "already-gone";
        throw error;
    }

    const fullName =
        repository.full_name ||
        `${params.entry.repo_owner}/${params.entry.repo_name}`;
    const actualOwner = repository.owner?.login?.trim() ?? "";
    if (actualOwner.toLowerCase() !== expectedLogin.toLowerCase()) {
        throw new ResourceDeletionError(
            `仓库 ${fullName} 不属于当前 GitHub 账号，已保留仓库。`,
            "repo-not-owned",
        );
    }
    if (repository.permissions?.admin === false) {
        throw new ResourceDeletionError(
            `当前 GitHub 账号没有 ${fullName} 的管理权限，无法删除仓库。`,
            "repo-no-admin",
        );
    }

    params.onProgress?.("正在删除 GitHub 仓库…");
    try {
        await deleteUserRepository(fullName, token);
        return "deleted";
    } catch (error) {
        if (isGithubStatus(error, 404)) return "already-gone";
        if (isGithubStatus(error, 403)) {
            throw new ResourceDeletionError(
                "GitHub 拒绝了仓库删除请求：当前账号没有删除权限，或授权缺少 delete_repo。仓库已保留。",
                "repo-no-admin",
            );
        }
        throw error;
    }
}

/** 用已准备好的分支创建删除 PR；重试时复用同一分支，不会重复删仓库。 */
export async function openResourceDeletionPullRequest(params: {
    prepared: PreparedDeletionSubmission;
    deleteRepository: boolean;
    repoDeleted: boolean;
}): Promise<{ prNumber: number; prUrl: string }> {
    const { prepared, deleteRepository, repoDeleted } = params;
    const created = await createSubmissionPullRequest({
        forkOwner: prepared.forkOwner,
        forkRepo: prepared.forkRepo,
        branch: prepared.branch,
        token: prepared.token,
        title: buildDeletionPullRequestTitle(prepared.entry),
        body: buildDeletionPullRequestBody({
            entry: prepared.entry,
            deleteRepository,
            repoDeleted,
        }),
    });
    if (!created?.number) {
        throw new Error("删除申请 PR 创建失败：GitHub 未返回 PR 编号。");
    }
    return {
        prNumber: created.number as number,
        prUrl: (created.html_url as string | undefined) || "",
    };
}

import { PUBLISH_CONFIG } from "~/config/publish";
import { log } from "~/logic/logging";
import { githubFetch, isGithubStatus } from "./github-actions";

async function getBranchHeadSha(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
}) {
    const { token, owner, repo, branch } = params;
    const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
    const ref = await githubFetch<{ object?: { sha?: string } }>(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );

    const sha = ref.object?.sha;
    if (!sha) {
        throw new Error(`无法读取分支 ${owner}/${repo}:${branch} 的提交。`);
    }

    return sha;
}

/**
 * 让用户 fork 的默认分支与上游 HEAD 完全对齐。
 *
 * 这个工具只把 fork 的默认分支当作「切新提交分支」的基准，从不直接往上面提交，
 * 因此把它对齐到上游是安全且期望的行为（等同于 GitHub 自带的
 * “Sync fork → discard commits”）。
 *
 * 策略：
 *   1. 先尝试 merge-upstream API：fork 只是落后时可干净 fast-forward，成本低，
 *      也能让 GitHub 的 fork 状态 UI 显示为已同步。
 *   2. 读上游 HEAD 与 fork 默认分支 HEAD。若仍不一致（fork 已分叉，
 *      merge-upstream 因冲突而失败/无操作），用 force 更新 ref 把 fork 硬对齐到
 *      上游 SHA。
 *
 * 任何一步失败都不抛出：目录文件稍后仍会从 fork 分支自身读取，最坏情况是 PR
 * 带上一些落后历史，而不是整个发布流程中断。
 */
export async function syncForkDefaultBranch(params: {
    token: string;
    forkOwner: string;
    forkRepo: string;
    branch: string;
    upstreamOwner?: string;
    upstreamRepo?: string;
}): Promise<void> {
    const {
        token,
        forkOwner,
        forkRepo,
        branch,
        upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner,
        upstreamRepo = PUBLISH_CONFIG.upstreamRepoName,
    } = params;

    const authHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    } as const;

    // 1. 优先走干净的 fast-forward 同步。
    try {
        await githubFetch<any>(
            `https://api.github.com/repos/${forkOwner}/${forkRepo}/merge-upstream`,
            {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ branch }),
            },
        );
    } catch (error) {
        log.warn("publish/fork", `merge-upstream 同步 fork ${forkOwner}/${forkRepo}#${branch} 失败，尝试强制对齐到上游`, { data: { error } });
    }

    // 2. 校验是否真的追平上游；没追平就强制对齐（丢弃 fork 分支上的分叉提交）。
    try {
        const [upstreamSha, forkSha] = await Promise.all([
            getBranchHeadSha({ token, owner: upstreamOwner, repo: upstreamRepo, branch }),
            getBranchHeadSha({ token, owner: forkOwner, repo: forkRepo, branch }),
        ]);

        if (forkSha === upstreamSha) return;

        const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
        await githubFetch<any>(
            `https://api.github.com/repos/${forkOwner}/${forkRepo}/git/refs/heads/${encodedBranch}`,
            {
                method: "PATCH",
                headers: authHeaders,
                body: JSON.stringify({ sha: upstreamSha, force: true }),
            },
        );
    } catch (error) {
        log.warn("publish/fork", `强制对齐 fork ${forkOwner}/${forkRepo}#${branch} 到上游失败，将使用 fork 当前状态继续`, { data: { error } });
    }
}

export async function syncBranchWithUpstream(params: {
    token: string;
    forkOwner: string;
    forkRepo: string;
    targetBranch: string;
    upstreamOwner?: string;
    upstreamRepo?: string;
    upstreamBranch?: string;
}) {
    const {
        token,
        forkOwner,
        forkRepo,
        targetBranch,
        upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner,
        upstreamRepo = PUBLISH_CONFIG.upstreamRepoName,
        upstreamBranch = PUBLISH_CONFIG.defaultBranch,
    } = params;

    // 1. 先把 fork 与上游同名的默认分支对齐到上游最新（fast-forward 不成则强制
    //    对齐），把上游新对象带进 fork 的对象网络。否则直接向 fork 的 merges
    //    API 传上游 SHA 会因对象不存在而 404，或用陈旧的 fork 状态去合并。
    await syncForkDefaultBranch({
        token,
        forkOwner,
        forkRepo,
        branch: upstreamBranch,
        upstreamOwner,
        upstreamRepo,
    });

    // 2. 把 fork 上已同步的默认分支合并进 PR 分支
    const headSha = await getBranchHeadSha({
        token,
        owner: forkOwner,
        repo: forkRepo,
        branch: upstreamBranch,
    });

    try {
        return await githubFetch<any>(
            `https://api.github.com/repos/${forkOwner}/${forkRepo}/merges`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    base: targetBranch,
                    head: headSha,
                }),
            },
        );
    } catch (error) {
        if (isGithubStatus(error, 409)) {
            throw new Error(
                `PR 分支 ${targetBranch} 与上游存在合并冲突，无法自动同步。` +
                `请在 GitHub 上手动解决冲突后重试。`,
            );
        }
        throw error;
    }
}

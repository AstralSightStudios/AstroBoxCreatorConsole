import { PUBLISH_CONFIG } from "~/config/publish";
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
        upstreamBranch = PUBLISH_CONFIG.defaultBranch,
    } = params;

    // 1. 先把 fork 上与上游同名的分支 fast-forward 到上游
    //    （把上游新对象带进 fork 的对象网络；否则直接向 fork 的
    //    merges API 传上游 SHA 会因对象不存在而 404）。
    //    失败（如同名分支被改动导致冲突）时继续，用 fork 现状合并。
    try {
        await githubFetch<any>(
            `https://api.github.com/repos/${forkOwner}/${forkRepo}/merge-upstream`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ branch: upstreamBranch }),
            },
        );
    } catch (error) {
        console.warn(
            `同步 fork ${forkOwner}/${forkRepo}#${upstreamBranch} 与上游失败，将使用 fork 当前状态继续`,
            error,
        );
    }

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

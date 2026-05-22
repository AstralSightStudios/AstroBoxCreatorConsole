import { PUBLISH_CONFIG } from "~/config/publish";
import { githubFetch } from "./github-actions";

async function getBranchHeadSha(params: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
}) {
    const { token, owner, repo, branch } = params;
    const ref = await githubFetch<{ object?: { sha?: string } }>(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        },
    );

    const sha = ref.object?.sha;
    if (!sha) {
        throw new Error(`无法读取上游分支 ${owner}/${repo}:${branch} 的提交。`);
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
        upstreamOwner = PUBLISH_CONFIG.upstreamRepoOwner,
        upstreamRepo = PUBLISH_CONFIG.upstreamRepoName,
        upstreamBranch = PUBLISH_CONFIG.defaultBranch,
    } = params;

    const upstreamHeadSha = await getBranchHeadSha({
        token,
        owner: upstreamOwner,
        repo: upstreamRepo,
        branch: upstreamBranch,
    });

    return githubFetch<any>(
        `https://api.github.com/repos/${forkOwner}/${forkRepo}/merges`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
                base: targetBranch,
                head: upstreamHeadSha,
            }),
        },
    );
}

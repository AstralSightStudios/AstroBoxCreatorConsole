import { PUBLISH_CONFIG } from "~/config/publish";
import { githubFetch } from "./github-actions";

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
                head: `${upstreamOwner}:${upstreamBranch}`,
            }),
        },
    );
}

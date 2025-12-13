import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import { githubFetch } from "./github-actions";
import {
    fetchCatalogEntries,
    type CatalogEntry,
} from "./catalog";
import {
    deriveReviewStatus,
    type NeedFixItem,
    type ReviewState,
} from "./review-status";

export interface ResourceCatalogContext {
    entry: CatalogEntry;
    owner: string;
    repo: string;
    ref: string;
    sha?: string;
}

export interface PublishingResource {
    id: string;
    name: string;
    restype: string;
    status: ReviewState;
    needs: NeedFixItem[];
    createdAt?: string;
    prNumber: number;
    prTitle: string;
    prUrl: string;
    prHead: { owner: string; repo: string; ref: string };
    catalog: ResourceCatalogContext;
}

export interface ResourceEditContext {
    mode: "in_progress" | "catalog";
    catalog: ResourceCatalogContext;
    prNumber?: number;
    prHead?: { owner: string; repo: string; ref: string };
}

function requireGithubAccount() {
    const state = loadAccountState();
    const token = state.github?.token;
    const username = state.github?.username;
    if (!token || !username) {
        throw new Error("请先登录 GitHub 账号。");
    }
    return { token, username };
}

export async function loadOwnedCatalogResourcesForCurrentUser(): Promise<
    ResourceCatalogContext[]
> {
    const { token, username } = requireGithubAccount();
    const catalog = await fetchCatalogEntries({ token });
    return catalog.entries
        .filter((entry) => entry.repo_owner === username)
        .map((entry) => ({
            entry,
            owner: catalog.owner,
            repo: catalog.repo,
            ref: catalog.ref,
            sha: catalog.sha,
        }));
}

async function fetchIssueComments(
    repoOwner: string,
    repoName: string,
    issueNumber: number,
    token: string,
) {
    return githubFetch<any[]>(
        `https://api.github.com/repos/${repoOwner}/${repoName}/issues/${issueNumber}/comments?per_page=100`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
}

function isSameUser(user?: { login?: string }, username?: string) {
    return Boolean(user?.login && username && user.login === username);
}

export async function loadInProgressResourcesForCurrentUser(): Promise<PublishingResource[]> {
    const { token, username } = requireGithubAccount();

    const pulls = await githubFetch<any[]>(
        `https://api.github.com/repos/${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}/pulls?state=open&per_page=50`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );

    const resources: PublishingResource[] = [];

    for (const pr of pulls) {
        const headRepo = pr.head?.repo;
        if (!headRepo) continue;

        const isAuthor =
            isSameUser(pr.user, username) || isSameUser(headRepo.owner, username);
        if (!isAuthor) continue;

        try {
            const comments = await fetchIssueComments(
                PUBLISH_CONFIG.targetPrRepoOwner,
                PUBLISH_CONFIG.targetPrRepoName,
                pr.number,
                token,
            );
            const review = deriveReviewStatus(comments);

            const catalog = await fetchCatalogEntries({
                token,
                owner: headRepo.owner?.login,
                repo: headRepo.name,
                ref: pr.head.ref,
            });

            const relatedEntries = catalog.entries.filter(
                (entry) =>
                    entry.repo_owner === username ||
                    entry.repo_owner === headRepo.owner?.login,
            );

            for (const entry of relatedEntries) {
                resources.push({
                    id: entry.id,
                    name: entry.name,
                    restype: entry.restype,
                    status: review.state,
                    needs: review.items,
                    createdAt: pr.created_at,
                    prNumber: pr.number,
                    prTitle: pr.title,
                    prUrl: pr.html_url,
                    prHead: {
                        owner: headRepo.owner?.login,
                        repo: headRepo.name,
                        ref: pr.head.ref,
                    },
                    catalog: {
                        entry,
                        owner: catalog.owner,
                        repo: catalog.repo,
                        ref: pr.head.ref,
                        sha: catalog.sha,
                    },
                });
            }
        } catch (error) {
            console.error("Failed to process PR", pr.number, error);
        }
    }

    return resources.sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
}

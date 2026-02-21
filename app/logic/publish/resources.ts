import { PUBLISH_CONFIG } from "~/config/publish";
import { loadAccountState } from "../account/store";
import { githubFetch } from "./github-actions";
import {
    fetchCatalogEntries,
    parseCatalogCsv,
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
    reviewState?: ReviewState;
    needs?: NeedFixItem[];
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

async function fetchPullFiles(
    repoOwner: string,
    repoName: string,
    pullNumber: number,
    token: string,
) {
    return githubFetch<
        Array<{
            filename?: string;
            patch?: string;
        }>
    >(
        `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/files?per_page=100`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );
}

const CATALOG_CSV_HEADER =
    "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

function parseCatalogEntryRow(row: string) {
    return parseCatalogCsv(`${CATALOG_CSV_HEADER}\n${row}`)[0];
}

function isCatalogFile(filename?: string) {
    if (!filename) return false;
    return (
        filename === PUBLISH_CONFIG.catalogFilePath ||
        filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
    );
}

function extractCatalogEntriesFromPatch(patch?: string) {
    if (!patch) return [];

    const byId = new Map<string, CatalogEntry>();
    const lines = patch.split(/\r?\n/);
    for (const line of lines) {
        if (!line.startsWith("+") || line.startsWith("+++")) continue;

        const row = line.slice(1).trim();
        if (!row || row === CATALOG_CSV_HEADER) continue;

        const parsed = parseCatalogEntryRow(row);
        if (!parsed) continue;
        byId.set(parsed.id, parsed);
    }

    return Array.from(byId.values());
}

function extractCatalogEntriesFromPullFiles(
    files: Array<{ filename?: string; patch?: string }>,
) {
    const byId = new Map<string, CatalogEntry>();

    for (const file of files) {
        if (!isCatalogFile(file.filename)) continue;

        const entries = extractCatalogEntriesFromPatch(file.patch);
        for (const entry of entries) {
            byId.set(entry.id, entry);
        }
    }

    return Array.from(byId.values());
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

        const isAuthor = Boolean(pr.user?.login && pr.user.login === username);
        if (!isAuthor) continue;

        try {
            const [comments, files] = await Promise.all([
                fetchIssueComments(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
                fetchPullFiles(
                    PUBLISH_CONFIG.targetPrRepoOwner,
                    PUBLISH_CONFIG.targetPrRepoName,
                    pr.number,
                    token,
                ),
            ]);
            const review = deriveReviewStatus(comments);
            const relatedEntries = extractCatalogEntriesFromPullFiles(files);

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
                        owner: headRepo.owner?.login || "",
                        repo: headRepo.name,
                        ref: pr.head.ref,
                        sha: pr.head.sha,
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

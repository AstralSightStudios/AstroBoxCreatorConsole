import { toProxiedApiUrl } from "~/logic/github-raw";
import {
    applyGithubRateLimitHeaders,
    applyGithubRateLimitPayload,
    getGithubReaderIdentities,
    getPrimaryGithubIdentity,
    markGithubAccountInvalid,
    type GithubRequestIdentity,
} from "./github-tokens";

async function refreshOne(identity: GithubRequestIdentity): Promise<void> {
    try {
        const response = await fetch(
            toProxiedApiUrl("https://api.github.com/rate_limit"),
            {
                headers: {
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    Authorization: `Bearer ${identity.token}`,
                },
                cache: "no-store",
            },
        );

        if (response.status === 401) {
            markGithubAccountInvalid(identity.login);
            return;
        }
        if (!response.ok) return;

        const payload = await response.json().catch(() => null);
        applyGithubRateLimitPayload(identity.login, identity.role, payload);
        // /rate_limit 不计入额度；响应头兜底 core，JSON 覆盖 search/graphql。
        applyGithubRateLimitHeaders(identity.login, identity.role, response.headers);
    } catch {
        // 额度刷新失败不影响审核主流程。
    }
}

/** 刷新主账号与所有读取账号的额度；GET /rate_limit 本身不消耗额度。 */
export async function refreshGithubQuotas(): Promise<void> {
    const primary = getPrimaryGithubIdentity();
    const identities: GithubRequestIdentity[] = [
        ...(primary ? [primary] : []),
        ...getGithubReaderIdentities(),
    ];
    await Promise.all(identities.map((identity) => refreshOne(identity)));
}

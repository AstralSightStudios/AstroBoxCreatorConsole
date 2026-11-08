import {
    createPullRequestComment,
    deletePullRequestComment,
    getPullRequest,
    listPullRequestComments,
} from "~/api/github/pr-review";
import { loadAccountState } from "~/logic/account/store";
import { HIDE_PR_COMMENT, isHideTagComment } from "./review-status";

/**
 * 创作者侧「隐藏 closed PR 记录」。
 *
 * 不修改 PR 状态、不删分支、不删 PR：只是在 PR 上留一条 [ABCC_HIDE] 评论，
 * 创作者侧列表读取时间线后跳过这些记录。标记落在 GitHub 上，所以桌面端、
 * 手机端以及重装后都能得到一致的隐藏结果；取消隐藏就是把这条评论删掉。
 */

function requireGithubAccount() {
    const account = loadAccountState().github;
    if (!account?.token || !account.username) {
        throw new Error("请先登录 GitHub 账号。");
    }
    return account;
}

function sameLogin(left?: string, right?: string) {
    if (!left || !right) return false;
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * 隐藏一个已关闭的 PR 记录。
 *
 * 只允许 PR 作者本人操作；标记已存在时直接返回，避免多端重复点击堆出多条评论。
 */
export async function hidePullRequestRecord(prNumber: number): Promise<void> {
    const { username } = requireGithubAccount();
    const pull = await getPullRequest(prNumber);

    if (pull.merged_at) {
        throw new Error("已合入的 PR 不能隐藏。");
    }
    if (pull.state !== "closed") {
        throw new Error("只能隐藏已关闭的 PR。");
    }
    if (!sameLogin(pull.user?.login, username)) {
        throw new Error("只能隐藏你自己提交的 PR。");
    }

    const comments = await listPullRequestComments(prNumber);
    if (comments.some((comment) => isHideTagComment(comment, username))) {
        return;
    }
    await createPullRequestComment(prNumber, HIDE_PR_COMMENT);
}

/**
 * 取消隐藏：删除当前账号在该 PR 上留下的 [ABCC_HIDE] 评论。
 *
 * 只删自己的标记；返回实际删除的条数，调用方据此判断是否需要提示。
 * 评论接口的 DELETE 需要评论 id，所以这里复用 issue comments（不含 review）。
 */
export async function unhidePullRequestRecord(prNumber: number): Promise<number> {
    const { username } = requireGithubAccount();
    const comments = await listPullRequestComments(prNumber);
    const markers = comments.filter((comment) =>
        isHideTagComment(comment, username),
    );

    for (const marker of markers) {
        await deletePullRequestComment(marker.id);
    }
    return markers.length;
}

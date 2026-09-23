import type { UpsertExternalAuthorizationBody } from "~/api/astrobox/order";

// 未上架资源登记自有网站授权需要 repo/commit 所有权证明，而 commit 只有在发布提交后才存在。
// 这里暂存编辑器里填好的配置，发布流程提交加密密钥后再带上证明一起登记。
// 只含公钥与公开 URL，不含任何私密信息；仅保存在当前会话内存中。
export type ExternalAuthorizationDraft = Omit<
    UpsertExternalAuthorizationBody,
    "repoOwner" | "repoName" | "commitSha"
>;

const drafts = new Map<string, ExternalAuthorizationDraft>();
const listeners = new Set<() => void>();

function draftKey(resourceId: string, deviceId: string) {
    return JSON.stringify([resourceId, deviceId]);
}

function notify() {
    for (const listener of listeners) listener();
}

export function setExternalAuthorizationDraft(draft: ExternalAuthorizationDraft) {
    drafts.set(draftKey(draft.resourceId, draft.deviceId), draft);
    notify();
}

export function getExternalAuthorizationDraft(resourceId: string, deviceId: string) {
    return drafts.get(draftKey(resourceId, deviceId)) ?? null;
}

export function clearExternalAuthorizationDraft(resourceId: string, deviceId: string) {
    if (drafts.delete(draftKey(resourceId, deviceId))) notify();
}

export function listExternalAuthorizationDrafts(resourceId: string) {
    return Array.from(drafts.values()).filter((draft) => draft.resourceId === resourceId);
}

export function subscribeExternalAuthorizationDrafts(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

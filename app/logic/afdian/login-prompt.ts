import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    AFDIAN_SESSION_QUERY_KEY,
    getAfdianErrorMessage,
    logoutAfdian,
    type AfdianSessionStatus,
} from "~/api/afdian-account";

const LOGIN_HINT =
    /请先登录|尚未登录|未登录|登录已过期|登录失效|登录已失效|请重新登录|HTTP\s*401|HTTP\s*403/;

let lastNoticeAt = 0;
let dropping: Promise<void> | null = null;
let open = false;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function isAfdianLoginRequiredError(error: unknown) {
    return LOGIN_HINT.test(getAfdianErrorMessage(error, ""));
}

function showAfdianSessionExpiredPrompt() {
    const now = Date.now();
    open = true;
    emit();
    if (now - lastNoticeAt < 8_000) return;
    lastNoticeAt = now;
    toast.error("爱发电登录已失效，请重新登录");
}

export function dismissAfdianSessionExpired() {
    if (!open) return;
    open = false;
    emit();
}

export function useAfdianSessionExpiredOpen() {
    return useSyncExternalStore(subscribe, () => open, () => false);
}

function forgetAfdianQueries(queryClient: QueryClient) {
    queryClient.setQueryData<AfdianSessionStatus>(AFDIAN_SESSION_QUERY_KEY, {
        connected: false,
        displayName: null,
    });
    queryClient.removeQueries({
        predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === "afdian" &&
            query.queryKey[1] !== "session",
    });
}

/** 启动检查已经确认会话失效并清掉了本地文件时，直接提示。 */
export function markAfdianSessionExpired(queryClient: QueryClient) {
    forgetAfdianQueries(queryClient);
    showAfdianSessionExpiredPrompt();
}

async function dropAfdianSession(queryClient: QueryClient) {
    try {
        await logoutAfdian();
    } catch (error) {
        toast.error(getAfdianErrorMessage(error, "无法清除爱发电登录状态"));
        return;
    }

    await queryClient.cancelQueries({ queryKey: AFDIAN_SESSION_QUERY_KEY });
    forgetAfdianQueries(queryClient);
    showAfdianSessionExpiredPrompt();
}

/** 爱发电会话失效时清除本地会话文件，并立刻提示重新登录。 */
export function notifyAfdianSessionDropped(queryClient: QueryClient) {
    if (dropping) return dropping;
    dropping = dropAfdianSession(queryClient).finally(() => {
        dropping = null;
    });
    return dropping;
}

export function useAfdianSessionDropPrompt(error: unknown, active: boolean) {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!active || !isAfdianLoginRequiredError(error)) return;
        void notifyAfdianSessionDropped(queryClient);
    }, [active, error, queryClient]);
}

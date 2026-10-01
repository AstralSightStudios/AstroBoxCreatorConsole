import { useSyncExternalStore } from "react";
import { toast } from "sonner";

let lastNoticeAt = 0;
let open = false;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 登录态失效时立刻提示，并保持对话框直到用户处理。 */
export function notifyAstroboxSessionExpired() {
    const now = Date.now();
    if (now - lastNoticeAt < 8_000 && open) return;
    lastNoticeAt = now;
    open = true;
    emit();
    toast.error("登录已过期，请重新登录");
}

export function dismissAstroboxSessionExpired() {
    if (!open) return;
    open = false;
    emit();
}

export function useAstroboxSessionExpiredOpen() {
    return useSyncExternalStore(subscribe, () => open, () => false);
}

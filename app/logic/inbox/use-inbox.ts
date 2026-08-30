import { useCallback, useEffect } from "react";
import { InboxApi } from "~/api/astrobox/inbox";
import { useAccountState } from "~/logic/account/store";
import {
  getInboxUnreadCount,
  setInboxUnreadCount,
  useInboxUnreadCount,
} from "./store";
import { flushCcNoticeQueue } from "./send";

const POLL_INTERVAL_MS = 60_000;

/**
 * 未读计数轮询：进入应用拉一次，之后每 60s 定时轮询，
 * visibilitychange / focus 时立即刷新；登出时清零。
 */
export function useInboxPolling() {
  const accountState = useAccountState();
  const hasAstrobox = Boolean(accountState.astrobox?.token);

  useEffect(() => {
    if (!hasAstrobox) {
      setInboxUnreadCount(0);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const { count } = await InboxApi.unreadCount();
        if (!cancelled) setInboxUnreadCount(count);
      } catch {
        // 静默失败，保留下一次轮询重试。
      }
    };

    void refresh();
    // 应用启动时顺手把上次发送失败的通知队列重试掉。
    void flushCcNoticeQueue();

    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        // 切回前台时顺手补发上次失败的审核通知。
        void flushCcNoticeQueue();
      }
    };
    const onFocus = () => {
      void refresh();
      void flushCcNoticeQueue();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [hasAstrobox]);
}

/**
 * 信箱编排：已读/删除操作（操作后刷新未读计数）。
 * 未读轮询由 Nav 顶层统一挂载 useInboxPolling，避免重复计时器。
 */
export function useInbox() {
  const count = useInboxUnreadCount();

  const refreshUnread = useCallback(async () => {
    try {
      const { count: next } = await InboxApi.unreadCount();
      setInboxUnreadCount(next);
    } catch {
      // ignore
    }
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      try {
        await InboxApi.markRead(id);
      } catch {
        // ignore
      }
      setInboxUnreadCount(Math.max(0, getInboxUnreadCount() - 1));
      void refreshUnread();
    },
    [refreshUnread],
  );

  const markAllRead = useCallback(async () => {
    try {
      await InboxApi.markAllRead();
    } catch {
      // ignore
    }
    setInboxUnreadCount(0);
    void refreshUnread();
  }, [refreshUnread]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await InboxApi.remove(id);
      } catch {
        // ignore
      }
      void refreshUnread();
    },
    [refreshUnread],
  );

  return { count, refreshUnread, markRead, markAllRead, remove };
}

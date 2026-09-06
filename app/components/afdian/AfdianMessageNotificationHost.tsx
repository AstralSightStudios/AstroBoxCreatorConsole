import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { AFDIAN_DIALOGS_QUERY_KEY } from "~/api/afdian-messages";
import {
  isAfdianMessageNotificationSupported,
  useAfdianMessageNotificationsEnabled,
} from "~/config/afdianNotifications";
import { log } from "~/logic/logging";

const DIALOGS_REFRESHED_EVENT = "afdian-message-dialogs-refreshed";

function getActiveConversation(pathname: string, search: string) {
  if (pathname !== "/afdian-messages") return null;
  return new URLSearchParams(search).get("userId");
}

export default function AfdianMessageNotificationHost() {
  const supported = isAfdianMessageNotificationSupported();
  const [enabled] = useAfdianMessageNotificationsEnabled();
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeConversationRef = useRef<string | null>(null);

  activeConversationRef.current = getActiveConversation(
    location.pathname,
    location.search,
  );

  useEffect(() => {
    const nativeEnabled = supported && enabled;
    log.info("afdian/notifications", "正在同步后台私信通知开关", {
      data: { supported, enabled: nativeEnabled },
    });
    void invoke("afdian_message_notifications_set_enabled", {
      enabled: nativeEnabled,
    })
      .then(() => {
        log.info("afdian/notifications", "后台私信通知开关同步成功", {
          data: { enabled: nativeEnabled },
        });
      })
      .catch((error) => {
        log.error("afdian/notifications", "后台私信通知开关同步失败", {
          data: { enabled: nativeEnabled, error },
        });
      });
  }, [enabled, supported]);

  useEffect(() => {
    if (!supported) return;

    const refreshVisibleQueries = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      void queryClient.invalidateQueries({ queryKey: AFDIAN_DIALOGS_QUERY_KEY });
      if (activeConversationRef.current) {
        void queryClient.invalidateQueries({
          queryKey: ["afdian", "messages", activeConversationRef.current],
        });
      }
    };

    const syncContext = () => {
      const appFocused =
        document.visibilityState === "visible" && document.hasFocus();
      void invoke("afdian_message_notifications_set_context", {
        activeUserId: activeConversationRef.current,
        appFocused,
      }).catch((error) => {
        log.warn("afdian/notifications", "后台私信阅读状态同步失败", {
          data: { error },
        });
      });
      if (appFocused) refreshVisibleQueries();
    };

    syncContext();
    window.addEventListener("focus", syncContext);
    window.addEventListener("blur", syncContext);
    document.addEventListener("visibilitychange", syncContext);

    return () => {
      window.removeEventListener("focus", syncContext);
      window.removeEventListener("blur", syncContext);
      document.removeEventListener("visibilitychange", syncContext);
    };
  }, [location.pathname, location.search, queryClient, supported]);

  useEffect(() => {
    if (!supported) return;

    const unlistenPromise = listen(DIALOGS_REFRESHED_EVENT, () => {
      log.debug("afdian/notifications", "收到后台私信列表刷新事件");
      void queryClient.invalidateQueries({ queryKey: AFDIAN_DIALOGS_QUERY_KEY });
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        activeConversationRef.current
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["afdian", "messages", activeConversationRef.current],
        });
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [queryClient, supported]);

  return null;
}

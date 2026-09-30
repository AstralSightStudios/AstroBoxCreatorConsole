import "./app.css";

import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { Theme } from "@radix-ui/themes";
import UiScaleShell from "./components/UiScaleShell";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
import AutoUpdateChecker from "./components/update/AutoUpdateChecker";
import AutoBetaUpdateChecker from "./components/update/AutoBetaUpdateChecker";
import BroadcastDialogHost from "./components/announcement/BroadcastDialogHost";
import AfdianMessageNotificationHost from "./components/afdian/AfdianMessageNotificationHost";
import AfdianAiAutoReplyHost from "./components/afdian/AfdianAiAutoReplyHost";
import { refreshAstroboxAccount } from "./logic/account/astrobox";
import { NavVisibilityProvider } from "./layout/nav-visibility-context";
import { InboxDrawerProvider, useInboxDrawer } from "./components/inbox/drawer-context";
import InboxDrawer from "./components/inbox/InboxDrawer";
import { Toaster } from "sonner";

function InboxDrawerHost() {
  const { open, closeInbox } = useInboxDrawer();
  return <InboxDrawer open={open} onClose={closeInbox} />;
}

function AstroboxAccountRefresher() {
    const hasRefreshedRef = useRef(false);

    useEffect(() => {
        if (hasRefreshedRef.current) return;
        hasRefreshedRef.current = true;
        void refreshAstroboxAccount();
    }, []);

    // 用户通常在外部浏览器里完成 Casdoor 绑定（如 GitHub），回到本应用窗口时
    // 自动重新同步一次，把最新绑定及时回填到服务端 MongoDB。节流避免频繁切窗刷屏。
    useEffect(() => {
        const REFRESH_THROTTLE_MS = 30_000;

        const handleVisible = () => {
            if (document.visibilityState === "visible") {
                void refreshAstroboxAccount({ throttleMs: REFRESH_THROTTLE_MS });
            }
        };
        const handleFocus = () => {
            void refreshAstroboxAccount({ throttleMs: REFRESH_THROTTLE_MS });
        };

        document.addEventListener("visibilitychange", handleVisible);
        window.addEventListener("focus", handleFocus);

        return () => {
            document.removeEventListener("visibilitychange", handleVisible);
            window.removeEventListener("focus", handleFocus);
        };
    }, []);

    return null;
}

export default function RootLayout() {
    const location = useLocation();
    const isWallpaperEditor = location.pathname === "/publish/wallpaper";

    return (
        <UiScaleShell disabled={isWallpaperEditor}>
            <Theme appearance="dark" panelBackground="translucent" radius="medium" accentColor="blue">
                <AstroboxAccountRefresher />
                <AutoUpdateChecker />
                <AutoBetaUpdateChecker />
                <BroadcastDialogHost />
                <AfdianMessageNotificationHost />
                <AfdianAiAutoReplyHost />
                {isWallpaperEditor ? (
                    <main className="h-full min-h-0 w-full overflow-hidden">
                        <Outlet />
                    </main>
                ) : (
                    <NavVisibilityProvider>
                        {/* 信箱浮层必须挂在 <Nav /> 之外：窄屏 Nav 自身就是 vaul
                            Drawer，信箱留在它子树里会共享同一套浮层判定，点消息会
                            连带收起侧栏并把信箱一起卸载。结构对齐 AstroBox 端
                            （InboxButton 挂在页面 header，全链路无 Drawer）。 */}
                        <InboxDrawerProvider>
                            <div className="flex h-full min-h-0 w-full flex-row">
                                <Nav />
                                <main className="flex-1 h-full min-w-0">
                                    <PageTransition />
                                </main>
                            </div>
                            <InboxDrawerHost />
                        </InboxDrawerProvider>
                    </NavVisibilityProvider>
                )}
                <Toaster
                    position="bottom-right"
                    richColors
                    theme="dark"
                    duration={4000}
                    offset={{
                        top: "max(16px, var(--ui-safe-area-top))",
                        right: "max(16px, var(--ui-safe-area-right))",
                        bottom: "max(16px, var(--ui-safe-area-bottom))",
                        left: "max(16px, var(--ui-safe-area-left))",
                    }}
                />
            </Theme>
        </UiScaleShell>
    );
}

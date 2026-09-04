import "./app.css";

import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { Theme } from "@radix-ui/themes";
import UiScaleShell from "./components/UiScaleShell";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
import AutoUpdateChecker from "./components/update/AutoUpdateChecker";
import BroadcastDialogHost from "./components/announcement/BroadcastDialogHost";
import { refreshAstroboxAccount } from "./logic/account/astrobox";
import { NavVisibilityProvider } from "./layout/nav-visibility-context";
import { Toaster } from "sonner";

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
                <BroadcastDialogHost />
                {isWallpaperEditor ? (
                    <main className="h-full min-h-0 w-full overflow-hidden">
                        <Outlet />
                    </main>
                ) : (
                    <NavVisibilityProvider>
                        <div className="flex h-full min-h-0 w-full flex-row">
                            <Nav />
                            <main className="flex-1 h-full min-w-0">
                                <PageTransition />
                            </main>
                        </div>
                    </NavVisibilityProvider>
                )}
                <Toaster
                    position="bottom-right"
                    richColors
                    theme="dark"
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

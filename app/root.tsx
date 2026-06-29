import "./app.css";
import "@radix-ui/themes/styles.css";

import { useEffect, useRef } from "react";
import { Theme } from "@radix-ui/themes";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
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
    return (
        <Theme appearance="dark" panelBackground="translucent" radius="medium" accentColor="blue">
            <AstroboxAccountRefresher />
            <NavVisibilityProvider>
                <div
                    className="flex flex-row h-screen min-h-screen"
                    style={{ height: "100dvh", minHeight: "100dvh" }}
                >
                    <Nav />
                    <main className="flex-1 h-full">
                        <PageTransition />
                    </main>
                </div>
            </NavVisibilityProvider>
            <Toaster
                richColors
                position="top-right"
                offset={{
                    top: "calc(env(safe-area-inset-top) + 24px)",
                    right: "calc(env(safe-area-inset-right) + 24px)",
                    bottom: "calc(env(safe-area-inset-bottom) + 24px)",
                    left: "calc(env(safe-area-inset-left) + 24px)",
                }}
                mobileOffset={{
                    top: "calc(env(safe-area-inset-top) + 16px)",
                    right: "calc(env(safe-area-inset-right) + 16px)",
                    bottom: "calc(env(safe-area-inset-bottom) + 16px)",
                    left: "calc(env(safe-area-inset-left) + 16px)",
                }}
            />
        </Theme>
    );
}

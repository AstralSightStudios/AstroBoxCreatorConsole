import "./app.css";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { Button, Flex, Heading, Theme } from "@radix-ui/themes";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import UiScaleShell from "./components/UiScaleShell";
import PageTransition from "./components/transition/page-transition";
import {
    ENTER_DURATION,
    ENTER_EASE,
    EXIT_DURATION,
    EXIT_EASE,
    getExitOffset,
    getInitialOffset,
} from "./components/transition/transition-config";
import { useFrozenOutlet } from "./components/transition/use-frozen-outlet";
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
import SessionExpiredPrompt from "./components/session-expired-prompt";
import { hasRequiredAccounts, useAccountState } from "./logic/account/store";

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
    const frozenOutlet = useFrozenOutlet();
    const accounts = useAccountState();
    const canUseConsole = hasRequiredAccounts(accounts);
    const isWelcome = location.pathname === "/welcome";
    // 未登录时只保留欢迎页与内置登录页；设置（含退出登录后）一律回到欢迎页，
    // 设置内容改由欢迎页的设置抽屉承载。
    const isSetupPage = isWelcome || location.pathname === "/login";
    const needsLogin = !canUseConsole && !isSetupPage;
    const isWallpaperEditor = location.pathname === "/publish/wallpaper";
    // 全局固定深色：欢迎页与设置抽屉的表面色是硬编码深色，跟随系统浅色会让
    // Radix token 翻成 light，产出白底 + 黑字压黑底的崩坏界面。
    const appearance = "dark";
    // 公共页面（欢迎/设置/登录）的进出方向：进入欢迎页视为「返回」，欢迎页从上方落下、
    // 当前页向下退场；其余（进入设置/登录）视为前进，向上位移。
    const publicTransitionDirection: 1 | -1 = isWelcome ? -1 : 1;

    return (
        <UiScaleShell disabled={canUseConsole && isWallpaperEditor}>
            <Theme appearance={appearance} panelBackground="translucent" radius="medium" accentColor="blue">
                <AstroboxAccountRefresher />
                <AutoUpdateChecker />
                <AutoBetaUpdateChecker />
                {canUseConsole && (
                    <>
                        <BroadcastDialogHost />
                        <AfdianMessageNotificationHost />
                        <AfdianAiAutoReplyHost />
                    </>
                )}
                {needsLogin ? (
                    <Navigate to="/welcome" replace />
                ) : isWelcome || !canUseConsole ? (
                    <div className="relative h-full min-h-0 w-full overflow-hidden">
                        <AnimatePresence
                            mode="sync"
                            initial={false}
                            custom={publicTransitionDirection}
                        >
                            <motion.div
                                key={location.pathname}
                                custom={publicTransitionDirection}
                                className="absolute inset-0 h-full w-full"
                                variants={{
                                    initial: (direction: 1 | -1) => ({
                                        y: getInitialOffset("y", direction),
                                        opacity: 0,
                                    }),
                                    animate: {
                                        y: 0,
                                        opacity: 1,
                                        transition: { duration: ENTER_DURATION, ease: ENTER_EASE },
                                    },
                                    exit: (direction: 1 | -1) => ({
                                        y: getExitOffset("y", direction),
                                        opacity: 0,
                                        transition: { duration: EXIT_DURATION, ease: EXIT_EASE },
                                    }),
                                }}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                            >
                                {isWelcome ? (
                                    <div className="h-full w-full overflow-x-hidden overflow-y-auto">
                                        {frozenOutlet}
                                    </div>
                                ) : (
                                    <Flex asChild direction="column" height="100%">
                                        <main>
                                            <div className="mx-auto flex w-full max-w-[424px] flex-col px-4 pt-9 pb-4">
                                                <Flex align="center" gap="2">
                                                    <Button variant="ghost" color="gray" asChild>
                                                        <Link to="/welcome" aria-label="返回欢迎页">
                                                            <ArrowLeftIcon size={18} />
                                                        </Link>
                                                    </Button>
                                                    <Heading as="h1" size="5">登录 AstroBox</Heading>
                                                </Flex>
                                            </div>
                                            <div className="relative flex-1 min-h-0 overflow-hidden">
                                                <div className="absolute inset-0 h-full w-full overflow-y-auto">
                                                    {frozenOutlet}
                                                </div>
                                            </div>
                                        </main>
                                    </Flex>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                ) : isWallpaperEditor ? (
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
                <SessionExpiredPrompt />
                <Toaster
                    position="bottom-right"
                    richColors
                    theme={appearance}
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

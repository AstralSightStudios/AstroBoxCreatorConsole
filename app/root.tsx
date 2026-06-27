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

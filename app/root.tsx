import "./app.css";
import "@radix-ui/themes/styles.css";

import { useEffect, useRef } from "react";
import { Theme } from "@radix-ui/themes";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
import { refreshAstroboxAccount } from "./logic/account/astrobox";
import { NavVisibilityProvider } from "./layout/nav-visibility-context";

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
        <Theme appearance="dark">
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
        </Theme>
    );
}

import "./app.css";
import "@radix-ui/themes/styles.css";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
import { Theme } from "@radix-ui/themes";
import { NavVisibilityProvider } from "./layout/nav-visibility-context";

export default function RootLayout() {
    return (
        <Theme appearance="dark">
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

import "./app.css";
import "@radix-ui/themes/styles.css";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";
import { Theme } from "@radix-ui/themes";

export default function RootLayout() {
    return (
        <Theme appearance="dark">
            <div className="flex flex-row min-h-screen">
                <div className="shrink-0">
                    <Nav />
                </div>

                <main className="flex-1">
                    <PageTransition />
                </main>
            </div>
        </Theme>
    );
}

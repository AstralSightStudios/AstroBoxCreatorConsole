import "./app.css";
import PageTransition from "./components/transition/page-transition";
import Nav from "./layout/nav";

export default function RootLayout() {
    return (
        <div className="flex flex-row min-h-screen">
            <div className="shrink-0">
                <Nav />
            </div>

            <main className="flex-1">
                <PageTransition />
            </main>
        </div>
    );
}

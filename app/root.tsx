import { Outlet } from "react-router";

import "./app.css";
import Nav from "./layout/nav";

export default function RootLayout() {
    return (
        <div className="flex flex-row min-h-screen">
            <div className="shrink-0">
                <Nav />
            </div>

            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    );
}

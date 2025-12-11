import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import RootLayout from "~/root";
import Home from "~/routes/index";
import Analysis from "~/routes/analysis";
import Profile from "~/routes/profile";
import ResourceEncrypt from "~/routes/resource/encrypt";
import ResourceManage from "~/routes/resource/manage";
import ResourcePublish from "~/routes/resource/publish";
import Settings from "~/routes/settings";
import LoginCallback from "./pages/callback";
import { NewResourcePublishPage } from "./routes/resource/publish/new";

const router = createBrowserRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [
            { index: true, element: <Home /> },
            { path: "analysis", element: <Analysis /> },
            { path: "publish", element: <ResourcePublish /> },
            { path: "manage", element: <ResourceManage /> },
            { path: "encrypt", element: <ResourceEncrypt /> },
            { path: "profile", element: <Profile /> },
            { path: "settings", element: <Settings /> },
            { path: "publish/new", element: <NewResourcePublishPage /> },
        ],
    },
    {
        path: "/callback",
        element: <LoginCallback />,
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <div className="bg-bg">
            <RouterProvider router={router} />
        </div>
    </StrictMode>,
);

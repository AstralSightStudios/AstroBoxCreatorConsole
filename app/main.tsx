import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import RootLayout from "~/root";
import RouteErrorFallback from "~/components/RouteErrorFallback";
import Home from "~/routes/index";
import Analysis from "~/routes/analysis";
import Interactions from "~/routes/interactions";
import Profile from "~/routes/profile";
import CloudControl from "~/routes/cloudcontrol";
import ResourceEncrypt from "~/routes/resource/encrypt";
import ResourceManage from "~/routes/resource/manage";
import ResourcePublish from "~/routes/resource/publish";
import WallpaperEditorPage from "~/routes/resource/wallpaper";
import Settings from "~/routes/settings";
import AdminAccountsPage from "~/routes/admin/accounts";
import AdminInboxPage from "~/routes/admin/inbox";
import AdminOrdersPage from "~/routes/admin/orders";
import AdminReportsPage from "~/routes/admin/reports";
import AdminHotUpdatePage from "~/routes/admin/hotupdate";
import AdminAccountDeletionPage from "~/routes/admin/account-deletion";
import ResourceReviewPage from "~/routes/resreview/page";
import ExplorePageManager from "~/routes/explorepage";
import LoginCallback from "./pages/callback";
import OauthCallbackPage from "./pages/oauth-callback";
import { installFrontendLogBridge } from "~/logic/logging";
import {
  NewResourcePublishPage,
  ResourceEditPage,
} from "./routes/resource/publish/new";

installFrontendLogBridge();

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: <Home /> },
      { path: "analysis", element: <Analysis /> },
      { path: "interactions", element: <Interactions /> },
      { path: "publish", element: <NewResourcePublishPage /> },
      { path: "manage", element: <ResourceManage /> },
      { path: "encrypt", element: <ResourceEncrypt /> },
      { path: "cloudcontrol", element: <CloudControl /> },
      { path: "profile", element: <Profile /> },
      { path: "settings", element: <Settings /> },
      { path: "resreview", element: <ResourceReviewPage /> },
      { path: "resreview/detail", element: <ResourceReviewPage /> },
      { path: "explorepage", element: <ExplorePageManager /> },
      { path: "admin/accounts", element: <AdminAccountsPage /> },
      { path: "admin/orders", element: <AdminOrdersPage /> },
      { path: "admin/reports", element: <AdminReportsPage /> },
      { path: "admin/inbox", element: <AdminInboxPage /> },
      { path: "admin/account-deletion", element: <AdminAccountDeletionPage /> },
      { path: "admin/hotupdate", element: <AdminHotUpdatePage /> },
      { path: "publish/new", element: <NewResourcePublishPage /> },
      { path: "publish/edit", element: <ResourceEditPage /> },
      { path: "publish/wallpaper", element: <WallpaperEditorPage /> },
      { path: "manage/edit", element: <ResourceEditPage /> },
    ],
  },
  {
    path: "/callback",
    element: <LoginCallback />,
  },
  {
    path: "/oauth-callback",
    element: <OauthCallbackPage />,
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="bg-bg">
        <RouterProvider router={router} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);

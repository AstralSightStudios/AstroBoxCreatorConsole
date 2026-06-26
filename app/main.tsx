import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import RootLayout from "~/root";
import Home from "~/routes/index";
import Analysis from "~/routes/analysis";
import Profile from "~/routes/profile";
import CloudControl from "~/routes/cloudcontrol";
import ResourceEncrypt from "~/routes/resource/encrypt";
import ResourceManage from "~/routes/resource/manage";
import ResourcePublish from "~/routes/resource/publish";
import Settings from "~/routes/settings";
import AdminAccountsPage from "~/routes/admin/accounts";
import AdminInboxPage from "~/routes/admin/inbox";
import AdminOrdersPage from "~/routes/admin/orders";
import AdminReportsPage from "~/routes/admin/reports";
import AdminHotUpdatePage from "~/routes/admin/hotupdate";
import ResourceReviewPage from "~/routes/resreview";
import ExplorePageManager from "~/routes/explorepage";
import LoginCallback from "./pages/callback";
import {
  NewResourcePublishPage,
  ResourceEditPage,
} from "./routes/resource/publish/new";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "analysis", element: <Analysis /> },
      { path: "publish", element: <NewResourcePublishPage /> },
      { path: "manage", element: <ResourceManage /> },
      { path: "encrypt", element: <ResourceEncrypt /> },
      { path: "cloudcontrol", element: <CloudControl /> },
      { path: "profile", element: <Profile /> },
      { path: "settings", element: <Settings /> },
      { path: "resreview", element: <ResourceReviewPage /> },
      { path: "explorepage", element: <ExplorePageManager /> },
      { path: "admin/accounts", element: <AdminAccountsPage /> },
      { path: "admin/orders", element: <AdminOrdersPage /> },
      { path: "admin/reports", element: <AdminReportsPage /> },
      { path: "admin/inbox", element: <AdminInboxPage /> },
      { path: "admin/hotupdate", element: <AdminHotUpdatePage /> },
      { path: "publish/new", element: <NewResourcePublishPage /> },
      { path: "publish/edit", element: <ResourceEditPage /> },
      { path: "manage/edit", element: <ResourceEditPage /> },
    ],
  },
  {
    path: "/callback",
    element: <LoginCallback />,
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

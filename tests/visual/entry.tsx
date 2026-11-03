// Test-only browser harness. This file is never routed or bundled into the app.
import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { JobsProvider } from "../../app/components/jobs";
import Discover from "../../app/routes/discover";
import EditorPage from "../../app/routes/editor";
import Settings from "../../app/routes/settings";
import History from "../../app/routes/history";
import { source, editorFixture, pricing } from "../fixtures";
import "../../app/styles.css";
const settings = {
  ...pricing,
  keyConfigured: true,
  environment: "production",
  aiAccount: "",
};
const context = {
  name: "Synthetic test store",
  domain: "test-shop.myshopify.com",
  currency: "USD",
  scopes: ["read_products", "write_products", "read_files", "write_files"],
  missingScopes: [],
};
const draftId = "00000000-0000-4000-8000-000000000001";
function Shell() {
  return (
    <>
      <div
        style={{
          padding: "7px 15px",
          background: "#fff3d6",
          color: "#806026",
          font: "10px system-ui",
          textAlign: "center",
        }}
      >
        TEST HARNESS · SYNTHETIC DATA · NO REAL SHOPIFY OR HIOBUY CONNECTION
      </div>
      <JobsProvider>
        <main className="workspace">
          <Outlet context={{ shop: context.domain, settings }} />
        </main>
      </JobsProvider>
    </>
  );
}
const router = createBrowserRouter([
  {
    path: "/app",
    Component: Shell,
    children: [
      { index: true, Component: Discover },
      {
        path: "editor/:id",
        loader: () => ({
          id: draftId,
          source,
          editor: editorFixture(),
          version: 1,
          environment: "production",
          context,
          collections: {
            nodes: [
              {
                id: "gid://shopify/Collection/123",
                title: "Garden essentials",
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          record: null,
        }),
        Component: EditorPage,
      },
      {
        path: "settings",
        loader: () => ({ settings, context }),
        Component: Settings,
      },
      {
        path: "history",
        loader: () => ({
          records: [
            {
              id: "rec-1",
              draftId,
              sourceId: "123456789012",
              sourceUrl: "https://detail.1688.com/offer/123456789012.html",
              sourcePlatform: "1688",
              title: source.title.translated,
              status: "SUCCEEDED",
              publishStatus: "DRAFT",
              productId: "gid://shopify/Product/1",
              error: null,
              warnings: null,
              attempts: 1,
              createdAt: "2026-10-18T10:00:00Z",
              updatedAt: "2026-10-18T10:00:00Z",
              canRetry: false,
              draft: { environment: "production" },
            },
            {
              id: "rec-2",
              draftId,
              sourceId: "123456789013",
              sourceUrl: null,
              sourcePlatform: "1688",
              title: "Garden spray bottle",
              status: "FAILED",
              publishStatus: "DRAFT",
              productId: null,
              error:
                "Shopify product prices use the store currency (CNY). Choose “Switch to CNY and recalculate” at the top of the editor, then import again.",
              warnings: null,
              attempts: 2,
              createdAt: "2026-10-17T08:00:00Z",
              updatedAt: "2026-10-17T08:00:00Z",
              canRetry: true,
              draft: { environment: "production" },
            },
          ],
          drafts: [
            {
              id: draftId,
              title: source.title.translated,
              environment: "production",
              updatedAt: "2026-10-18T10:00:00Z",
            },
          ],
          count: 2,
          page: 1,
          shop: context.domain,
        }),
        Component: History,
      },
    ],
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);

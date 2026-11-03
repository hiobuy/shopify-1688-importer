import {
  Outlet,
  useLoaderData,
  useRouteError,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, publicSettings } from "../lib/settings.server";
import { JobsProvider } from "../components/jobs";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings: publicSettings(await getSettings(session.shop)),
  };
}
export default function App() {
  const { apiKey, shop, settings } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Find products</s-link>
        <s-link href="/app/history">Import history</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <JobsProvider>
        <main className="workspace">
          <Outlet context={{ shop, settings }} />
        </main>
      </JobsProvider>
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => {
  const headers = new Headers(boundary.headers(args));
  headers.set("Cache-Control", "private, no-store");
  return headers;
};

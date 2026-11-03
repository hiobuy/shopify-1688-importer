import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import "./styles.css";
export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <html lang="en">
      <head>
        <title>HIOBuy Importer</title>
        <Links />
      </head>
      <body>
        <main className="login">
          <h1>Unable to open the app</h1>
          <p>
            {isRouteErrorResponse(error) && error.status === 404
              ? "This page was not found."
              : "Check the app configuration and open the app from your Shopify Admin."}
          </p>
          <a href="/auth/login">Connect your store</a>
          <Scripts />
        </main>
      </body>
    </html>
  );
}

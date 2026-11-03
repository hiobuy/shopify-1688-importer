import { type RouteConfig, index, route } from "@react-router/dev/routes";
export default [
  index("routes/index.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/*", "routes/auth.tsx"),
  route("webhooks/app", "routes/webhooks.ts"),
  route("healthz", "routes/health.ts"),
  route("app", "routes/app.tsx", [
    index("routes/discover.tsx"),
    route("editor/:id", "routes/editor.tsx"),
    route("settings", "routes/settings.tsx"),
    route("history", "routes/history.tsx"),
    route("api", "routes/api.ts"),
    route("api/upload", "routes/upload.ts"),
    route("api/assets/:id", "routes/asset.ts"),
  ]),
] satisfies RouteConfig;

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const origin = "http://127.0.0.1:4189";
const child = spawn(
  process.execPath,
  ["node_modules/@react-router/serve/bin.js", "./build/server/index.js"],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "4189",
      HOST: "127.0.0.1",
      DATABASE_URL: "file:./dev.sqlite",
      SHOPIFY_API_KEY: "synthetic_test_client_id",
      SHOPIFY_API_SECRET: randomBytes(32).toString("hex"),
      SHOPIFY_APP_URL: origin,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (d) => {
  output += d;
});
child.stderr.on("data", (d) => {
  output += d;
});
try {
  let last = "";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${origin}/healthz`);
      last = String(res.status);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch (e) {
      last = String(e.cause?.code || e.message);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready)
    throw new Error(
      `Smoke server failed to start (${last}): ${output.slice(-1500)}`,
    );
  const report = [];
  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  };
  for (const path of [
    "/auth/login",
    "/app",
    "/app/settings",
    "/app/history",
    "/app/api?resource=jobs",
    "/app/api/assets/not-an-id",
  ]) {
    const response = await fetch(origin + path, {
      headers: {
        ...browserHeaders,
        ...(path === "/auth/login"
          ? {}
          : { Authorization: "Bearer invalid-synthetic-token" }),
      },
      redirect: "manual",
    });
    report.push({ method: "GET", path, status: response.status });
    if (path === "/auth/login") {
      if (response.status !== 200)
        throw new Error("Login page did not render.");
      const html = await response.text();
      if (!html.includes("Connect Shopify store"))
        throw new Error("Login UI missing.");
    } else if (![302, 303, 401].includes(response.status))
      throw new Error(
        `Unauthenticated route exposed content: ${path} ${response.status}`,
      );
  }
  for (const path of ["/app/api", "/app/api/upload", "/webhooks/app"]) {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: {
        ...browserHeaders,
        Origin: origin,
        Authorization: "Bearer invalid-synthetic-token",
        "Content-Type": "application/json",
      },
      body: '{"intent":"publish"}',
      redirect: "manual",
    });
    report.push({ method: "POST", path, status: response.status });
    if (![302, 303, 400, 401, 403].includes(response.status))
      throw new Error(`Unsigned mutation accepted: ${path} ${response.status}`);
  }
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/http-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill("SIGTERM");
}

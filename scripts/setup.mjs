import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const url = process.env.DATABASE_URL;
if (!url?.startsWith("file:"))
  throw new Error(
    "Set DATABASE_URL to a SQLite file URL in .env or the server environment.",
  );
const path = resolve("prisma", url.slice(5).split("?")[0]);
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
// Prisma 6's schema engine can fail on a missing SQLite file on some hosts.
closeSync(openSync(path, "a", 0o600));
for (const args of [["generate"], ["migrate", "deploy"]]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}

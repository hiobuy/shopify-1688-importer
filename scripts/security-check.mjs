import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
const exclude = new Set([
  ".git",
  "node_modules",
  "build",
  ".react-router",
  ".shopify",
  "artifacts",
  "coverage",
  "test-results",
  "playwright-report",
  "data",
]);
const problems = [];
const patterns = [
  [/hio_(?:live|test)_[A-Za-z0-9]{24,}/, "HIOBuy key"],
  [/shp(?:at|ss|ca|pa)_[a-f0-9]{24,}/i, "Shopify credential"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/(?:sk_live_|AKIA)[A-Za-z0-9]{16,}/, "service credential"],
  [
    /(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+:[^\s"']+@/i,
    "database credential",
  ],
];
function scan(text, label) {
  for (const [pattern, kind] of patterns)
    if (pattern.test(text)) problems.push(`${label}: possible ${kind}`);
}
function walk(path = ".") {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (exclude.has(entry.name) || entry.name === ".DS_Store") continue;
    const full = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (
      /\.(sqlite|db)(-|$)/.test(entry.name) ||
      entry.name === ".env" ||
      (entry.name.startsWith(".env.") && entry.name !== ".env.example")
    )
      continue;
    if (statSync(full).size > 2e6) continue;
    scan(readFileSync(full, "utf8"), full);
  }
}
walk();
const history = spawnSync("git", ["rev-list", "--all"], { encoding: "utf8" });
const commits =
  history.status === 0 ? history.stdout.trim().split("\n").filter(Boolean) : [];
for (const commit of commits) {
  const show = spawnSync(
    "git",
    ["show", commit, "--format=", "--no-ext-diff", "--unified=0"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (show.status !== 0) problems.push(`Could not inspect commit ${commit}`);
  else scan(show.stdout, `history ${commit.slice(0, 12)}`);
}
const tracked =
  spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout || "";
for (const file of tracked.trim().split("\n").filter(Boolean))
  if (
    /(^|\/)(\.env($|\.(?!example$))|.*\.(sqlite|db)(-|$)|.*\.(pem|key)$)/.test(
      file,
    )
  )
    problems.push(`Sensitive file is tracked: ${file}`);
// These names may be documented, but must never occur in executable application source.
for (const path of ["app", "scripts"]) {
  const search = spawnSync(
    "rg",
    [
      "-l",
      "HIOBUY_INTERNAL_TOKEN|X-Portal-Token|/v1/internal|/api/internal",
      path,
    ],
    { encoding: "utf8" },
  );
  if (path === "app" && search.status === 0)
    problems.push(
      `Private integration reference in application code: ${search.stdout.trim()}`,
    );
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `Secret-pattern and private-integration checks passed; ${commits.length} local commits inspected. Review staged files and any separately hosted remote history before publication.`,
);

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const raw = readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(raw);
const accepted = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "(MIT OR CC0-1.0)",
  "(MIT OR Apache-2.0)",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
]);
const entries = [];
const failures = [];
for (const [path, value] of Object.entries(lock.packages)) {
  if (!path || value.link) continue;
  // Platform-specific optional packages may not be installed on this host.
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
  } catch {}
  const license = manifest?.license || value.license || "UNKNOWN";
  const name = manifest?.name || path.split("node_modules/").at(-1);
  entries.push({
    name,
    version: value.version,
    license,
    development: !!value.dev,
    optional: !!value.optional,
  });
  if (!accepted.has(license))
    failures.push(`${name}@${value.version}: ${license}`);
}
const unique = [
  ...new Map(entries.map((e) => [`${e.name}@${e.version}`, e])).values(),
].sort((a, b) => a.name.localeCompare(b.name));
const report = {
  lockfileSha256: createHash("sha256").update(raw).digest("hex"),
  packages: unique,
  unreviewed: failures,
};
if (process.argv.includes("--write"))
  writeFileSync(
    "docs/DEPENDENCY-LICENSES.json",
    JSON.stringify(report, null, 2) + "\n",
  );
if (failures.length) {
  console.error("Unreviewed dependency licenses:\n" + failures.join("\n"));
  process.exit(1);
}
if (!existsSync("docs/DEPENDENCY-LICENSES.json")) {
  console.error(
    "Generate the license inventory with npm run check:licenses -- --write.",
  );
  process.exit(1);
}
const recorded = JSON.parse(
  readFileSync("docs/DEPENDENCY-LICENSES.json", "utf8"),
);
if (recorded.lockfileSha256 !== report.lockfileSha256) {
  console.error(
    "Dependency lockfile changed; regenerate the reviewed license inventory.",
  );
  process.exit(1);
}
console.log(
  `License metadata checked for ${unique.length} locked package versions; no unreviewed licenses.`,
);

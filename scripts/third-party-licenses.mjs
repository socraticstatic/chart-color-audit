#!/usr/bin/env node
// The CLI and MCP server bundle their dependencies. This writes the license
// of every bundled package to dist/THIRD-PARTY-LICENSES.txt, from the list of
// files the bundler actually included, and fails if one has no license text.
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const metaFiles = readdirSync(dist).filter((f) => /^metafile-.*\.json$/.test(f));
if (metaFiles.length === 0) {
  console.error("No metafile in dist/. Run tsup first.");
  process.exit(1);
}

const packages = new Map();
for (const file of metaFiles) {
  const meta = JSON.parse(readFileSync(join(dist, file), "utf8"));
  for (const input of Object.keys(meta.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//g;
    let match;
    let last = null;
    while ((match = m.exec(input)) !== null) last = { name: match[1], end: match.index + match[0].length };
    if (!last) continue;
    packages.set(last.name, join(root, input.slice(0, last.end)));
  }
  rmSync(join(dist, file));
}

const missing = [];
const sections = [];
for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const licenseFile = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  const text = licenseFile ? readFileSync(join(dir, licenseFile), "utf8").trim() : null;
  if (!text) missing.push(name);
  sections.push(
    `${name}@${pkg.version}\nLicense: ${typeof pkg.license === "string" ? pkg.license : "see below"}\n\n${text ?? "(no license file in the package)"}`
  );
}

if (missing.length > 0) {
  console.error(`Bundled packages with no license file: ${missing.join(", ")}`);
  process.exit(1);
}

const header =
  "chart-color-audit bundles the following packages into dist/cli.js and dist/mcp.js.\n" +
  "Each is redistributed under its own license, reproduced here.\n";
writeFileSync(join(dist, "THIRD-PARTY-LICENSES.txt"), [header, ...sections].join("\n\n" + "-".repeat(72) + "\n\n") + "\n");
console.log(`THIRD-PARTY-LICENSES.txt: ${packages.size} bundled packages`);

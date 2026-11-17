#!/usr/bin/env node
// Fails if server.json drifts from package.json.
// Run automatically by prepublishOnly and by the mcp-registry release job.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));

const errors = [];

if (server.version !== pkg.version) {
  errors.push(`server.json version "${server.version}" != package.json version "${pkg.version}"`);
}

for (const p of server.packages ?? []) {
  if (p.version !== pkg.version) {
    errors.push(`server.json packages[].version "${p.version}" (${p.identifier}) != package.json version "${pkg.version}"`);
  }
  if (p.registryType === "npm" && p.identifier !== pkg.name) {
    errors.push(`server.json npm identifier "${p.identifier}" != package.json name "${pkg.name}"`);
  }
}

if (server.name !== pkg.mcpName) {
  errors.push(`server.json name "${server.name}" != package.json mcpName "${pkg.mcpName}"`);
}

// Registry limits (registry.modelcontextprotocol.io rejects the publish with
// 422 after the workflow has already tagged and authenticated).
if (!server.title || server.title.length > 100) errors.push("server.json title missing or > 100 chars");
if (!server.description || server.description.length > 100) errors.push("server.json description missing or > 100 chars");
if (!/^https:\/\//.test(server.websiteUrl ?? "")) errors.push("server.json websiteUrl missing or not https");

// The GitHub Action runs the npm package at a pinned version. That default
// must be the version being released, or `uses: ...@vX.Y.Z` runs older code.
const actionYml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const actionVersion = /\n {2}version:\n(?: {4}.*\n)*? {4}default: "([^"]+)"/.exec(actionYml)?.[1];
if (actionVersion !== pkg.version) {
  errors.push(`action.yml version default "${actionVersion}" != package.json version "${pkg.version}"`);
}

if (errors.length > 0) {
  console.error("release metadata is out of sync with package.json:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`server.json and action.yml in sync with package.json (v${pkg.version})`);

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

if (errors.length > 0) {
  console.error("server.json is out of sync with package.json:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`server.json in sync with package.json (v${pkg.version})`);

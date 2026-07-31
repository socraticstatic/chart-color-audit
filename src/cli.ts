#!/usr/bin/env node
/**
 * CLI face. Zero-config trial path:
 *   npx chart-color-audit --colors "#4E79A7,#F28E2B" --bg "#fff"
 * CI path:
 *   npx chart-color-audit            (reads chartaudit.config.json)
 *   npx chart-color-audit --config path/to/config.json
 * MCP face:
 *   npx chart-color-audit mcp
 *
 * Exit codes: 0 = all floors clear · 1 = audit failed · 2 = usage/input error.
 */
import { existsSync } from "node:fs";
import { audit, type AuditResult, type FloorsMode } from "./engine/audit.js";
import { loadConfig } from "./config.js";

const HELP = `chart-color-audit — accessibility audit for chart color palettes

USAGE
  chart-color-audit --colors "#4E79A7,#F28E2B,#E15759" --bg "#fff"   zero-config audit
  chart-color-audit [--config chartaudit.config.json]                CI mode (config file)
  chart-color-audit mcp                                              start the MCP server

OPTIONS
  --colors <list>   comma-separated palette colors (any CSS color syntax)
  --bg <color>      background the marks render on
  --mode <mode>     perceptual (default) | redundant-encodings | strict
  --config <path>   config file path (default ./chartaudit.config.json)
  --json            machine-readable output
  --help            this text
  --version         package version

CHECKS
  Pairwise OKLab dE separation under normal vision + deutan/protan/tritan
  (published Machado 2009 matrices, applied in linear RGB) + grayscale, and
  WCAG 2.2 SC 1.4.11 non-text contrast (>= 3:1) vs. the background.
  Fails the build (exit 1) when any floor breaks.`;

interface Args {
  colors?: string;
  bg?: string;
  mode?: string;
  config?: string;
  json: boolean;
  help: boolean;
  version: boolean;
  mcp: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, help: false, version: false, mcp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "mcp": args.mcp = true; break;
      case "--colors": args.colors = argv[++i]; break;
      case "--bg": case "--background": args.bg = argv[++i]; break;
      case "--mode": args.mode = argv[++i]; break;
      case "--config": args.config = argv[++i]; break;
      case "--json": args.json = true; break;
      case "--help": case "-h": args.help = true; break;
      case "--version": case "-v": args.version = true; break;
      default:
        fail(`Unknown argument: ${a}\nRun with --help for usage.`);
    }
  }
  return args;
}

function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

const BAND_LABEL: Record<string, string> = {
  "clearly-distinct": "clearly distinct",
  distinguishable: "distinguishable",
  "patterns-carry-identity": "colors nearly identical — patterns must carry identity",
  collision: "COLLISION",
};

function printHuman(result: AuditResult) {
  const w = (s: string) => process.stdout.write(s + "\n");
  w("");
  w(`chart-color-audit · ${result.colors.length} colors on ${result.background.hex} · mode: ${result.mode}`);
  w("");
  w("  vision          min ΔE   closest pair   reading");
  for (const v of result.perVision) {
    const de = Number.isFinite(v.minDeltaE) ? v.minDeltaE.toFixed(1).padStart(6) : "   n/a";
    const pair = v.closestPair ? `${v.closestPair[0] + 1} ↔ ${v.closestPair[1] + 1}`.padEnd(12) : "—".padEnd(12);
    const band = v.band ? BAND_LABEL[v.band] ?? v.band : "single color";
    const mark = v.pass ? "·" : "✗";
    w(`  ${mark} ${v.mode.padEnd(13)} ${de}   ${pair} ${band}`);
  }
  w("");
  const worst = result.contrast.reduce((a, b) => (b.ratio < a.ratio ? b : a), result.contrast[0]!);
  w(`  contrast vs background: worst ${worst.ratio.toFixed(2)}:1 (slot ${worst.index + 1}, needs ≥ ${result.floors.minContrast}:1)`);
  for (const c of result.contrast.filter((c) => !c.pass)) {
    w(`  ✗ slot ${c.index + 1} ${c.hex} — ${c.ratio.toFixed(2)}:1`);
  }
  if (result.semantic.length > 0) {
    w("");
    for (const s of result.semantic) {
      const mark = s.status === "ok" ? "·" : s.status === "cvd-risk" ? "⚠" : "✗";
      w(`  ${mark} semantic ${s.role.padEnd(10)} ${s.hex}  ${s.reason ?? "ok"}`);
    }
  }
  w("");
  if (result.verdict === "pass") {
    w("  PASS — every floor clear.");
  } else {
    w(`  FAIL — ${result.failures.length} finding${result.failures.length === 1 ? "" : "s"}:`);
    for (const f of result.failures) w(`    · ${f}`);
  }
  w("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { process.stdout.write(HELP + "\n"); return; }
  if (args.version) {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    process.stdout.write(pkg.version + "\n");
    return;
  }
  if (args.mcp) {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
    return;
  }

  let result: AuditResult;
  try {
    if (args.colors) {
      if (!args.bg) fail("--colors requires --bg <background color>.");
      result = audit({
        colors: args.colors.split(",").map((s) => s.trim()).filter(Boolean),
        background: args.bg,
        mode: args.mode as FloorsMode | undefined,
      });
    } else {
      const path = args.config ?? "chartaudit.config.json";
      if (!existsSync(path)) {
        fail(
          `No ${path} found and no --colors given.\n` +
            `Try the zero-config path:\n` +
            `  chart-color-audit --colors "#4E79A7,#F28E2B,#E15759" --bg "#fff"`
        );
      }
      const resolved = loadConfig(path);
      result = audit({
        colors: resolved.colors,
        background: resolved.background,
        semanticRoles: resolved.semanticRoles,
        mode: (args.mode as FloorsMode | undefined) ?? resolved.mode,
        floors: resolved.floors,
      });
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printHuman(result);
  }
  process.exit(result.verdict === "pass" ? 0 : 1);
}

main().catch((e: unknown) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(2);
});

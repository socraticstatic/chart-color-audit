#!/usr/bin/env node
// Turns an audit result (the CLI's --json output) into GitHub Actions
// annotations, a job summary and step outputs. Pure functions are exported
// so the test suite can check them without a runner.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Escape a message for a workflow command (`::error::...`). */
export function escapeCommand(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape a value for a Markdown table cell. */
export function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A themed result as [name, result] pairs; a plain result as one pair named null. */
export function themesOf(result) {
  return result.themes ? Object.entries(result.themes) : [[null, result]];
}

/** One `::error` line per finding. A themed finding names its theme. */
export function annotations(result) {
  return themesOf(result).flatMap(([name, r]) =>
    r.failures.map((f) => `::error title=chart-color-audit::${escapeCommand(name === null ? f : `[${name}] ${f}`)}`)
  );
}

const fmt = (n, digits) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "n/a");

/** The job summary, as Markdown. A themed result gets one section per theme. */
export function markdown(result) {
  if (!result.themes) return section(result, "### Chart color audit");
  const out = [`### Chart color audit: ${result.verdict === "pass" ? "pass" : "fail"}`, ""];
  for (const [name, r] of themesOf(result)) out.push(section(r, `#### Theme ${escapeCell(name)}`));
  return out.join("\n");
}

function section(result, heading) {
  const pass = result.verdict === "pass";
  const out = [];
  out.push(`${heading}: ${pass ? "pass" : "fail"}`);
  out.push("");
  out.push(
    `${result.colors.length} color${result.colors.length === 1 ? "" : "s"} on \`${result.background.hex}\`, mode \`${result.mode}\`.`
  );
  out.push("");
  out.push("| Vision | Min ΔE | Closest pair | Floor | Result |");
  out.push("|---|---|---|---|---|");
  for (const v of result.perVision) {
    const pair = v.closestPair
      ? `${v.closestPair[0] + 1} (\`${result.colors[v.closestPair[0]]?.hex}\`) and ${v.closestPair[1] + 1} (\`${result.colors[v.closestPair[1]]?.hex}\`)`
      : "n/a";
    out.push(`| ${v.mode} | ${fmt(v.minDeltaE, 1)} | ${pair} | ${v.floor} | ${v.pass ? "pass" : "FAIL"} |`);
  }
  const lowContrast = result.contrast.filter((c) => !c.pass);
  if (lowContrast.length > 0) {
    out.push("");
    out.push(`| Slot | Color | Contrast vs background | Needs |`);
    out.push("|---|---|---|---|");
    for (const c of lowContrast) {
      out.push(`| ${c.index + 1} | \`${c.hex}\` | ${fmt(c.ratio, 2)}:1 | ${result.floors.minContrast}:1 |`);
    }
  }
  if (result.failures.length > 0) {
    out.push("");
    out.push(`**${result.failures.length} finding${result.failures.length === 1 ? "" : "s"}**`);
    out.push("");
    for (const f of result.failures) out.push(`- ${escapeCell(f)}`);
  }
  out.push("");
  return out.join("\n");
}

/** Step outputs, as `name=value` lines. */
export function outputs(result) {
  const findings = themesOf(result).reduce((n, [, r]) => n + r.failures.length, 0);
  return [`verdict=${result.verdict === "pass" ? "pass" : "fail"}`, `findings=${findings}`];
}

function main(path) {
  const result = JSON.parse(readFileSync(path, "utf8"));
  for (const line of annotations(result)) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(result) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs(result).join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]);
}

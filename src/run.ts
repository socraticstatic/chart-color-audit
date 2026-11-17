/**
 * Run the audit a config file describes: once, or once per theme. The CLI
 * and the MCP server both go through here, so they report the same thing.
 */
import { audit, type AuditResult, type FloorsMode } from "./engine/audit.js";
import { loadThemes } from "./config.js";

export interface ThemedAuditResult {
  /** "fail" when any theme fails. */
  verdict: "pass" | "fail";
  /** Each theme's full result, by theme name, in config order. */
  themes: Record<string, AuditResult>;
}

/**
 * Audit a config file. A config with no "themes" returns the plain
 * AuditResult; one with themes returns a verdict over all of them plus each
 * theme's result. `mode`, when given, overrides the mode of every theme.
 */
export function auditConfigFile(configPath: string, mode?: FloorsMode): AuditResult | ThemedAuditResult {
  const runs = loadThemes(configPath).map(({ name, config }) => ({
    name,
    result: audit({
      colors: config.colors,
      background: config.background,
      semanticRoles: config.semanticRoles,
      textRoles: config.textRoles,
      mode: mode ?? config.mode,
      floors: config.floors,
    }),
  }));
  const only = runs[0];
  if (runs.length === 1 && only && only.name === null) return only.result;
  const themes: Record<string, AuditResult> = {};
  for (const run of runs) themes[run.name ?? ""] = run.result;
  return { verdict: runs.every((r) => r.result.verdict === "pass") ? "pass" : "fail", themes };
}

export function isThemed(result: AuditResult | ThemedAuditResult): result is ThemedAuditResult {
  return "themes" in result;
}

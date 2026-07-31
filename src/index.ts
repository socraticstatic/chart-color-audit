/**
 * chart-color-audit — accessibility audit for chart color palettes.
 *
 * One engine, four faces: this typed API, the CLI (`npx chart-color-audit`),
 * the CI gate (same CLI, exit code 1 on failure), and an MCP server
 * (`npx chart-color-audit mcp`).
 *
 * Quick start:
 * ```ts
 * import { audit } from "chart-color-audit";
 *
 * const result = audit({
 *   colors: ["#4E79A7", "#F28E2B", "#E15759"],
 *   background: "#ffffff",
 * });
 * result.verdict            // "pass" | "fail"
 * result.perVision[1]       // { mode: "deutan", minDeltaE, closestPair, band, ... }
 * result.failures           // human-readable reasons, empty on pass
 * ```
 */
export {
  audit,
  bandFor,
  FLOOR_PRESETS,
  type AuditInput,
  type AuditResult,
  type Band,
  type ContrastFinding,
  type Floors,
  type FloorsMode,
  type SemanticFinding,
  type SemanticStatus,
  type VisionFinding,
} from "./engine/audit.js";
export {
  contrastRatio,
  deltaE,
  parseColor,
  simulate,
  toGrayscale,
  VISION_MODES,
  type ColorRecord,
  type VisionMode,
} from "./engine/color.js";
export { simulateRgb, DEUTAN_1, PROTAN_1, TRITAN_1, type CvdType, type Matrix } from "./engine/cvd.js";
export { parseCssVars, type CssVars } from "./parsers/css.js";
export { parseTokensJson, type TokenColors } from "./parsers/tokens.js";
export {
  loadConfig,
  resolveConfig,
  validateConfig,
  type AuditConfig,
  type ResolvedConfig,
} from "./config.js";

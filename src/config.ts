/**
 * chartaudit.config.json — the CI path. Token references resolve in three
 * ways, checked in order:
 *   1. a literal color ("#4E79A7", "hsl(210 40% 50%)")
 *   2. a CSS custom-property name ("--chart-cat-1") looked up in the tokens file
 *   3. a dotted path ("chart.categorical.1") into a design-tokens JSON file
 */
import { readFileSync } from "node:fs";
import { parseColor } from "./engine/color.js";
import { parseCssVars, type CssVars } from "./parsers/css.js";
import { parseTokensJson, type TokenColors } from "./parsers/tokens.js";
import type { FloorsMode, Floors } from "./engine/audit.js";

export interface AuditConfig {
  /** Path to a .css or .json token file (relative to the config file). */
  tokens?: string;
  /** CSS selector whose block holds the variables. Default ":root". */
  selector?: string;
  /** Categorical slots, in order. Literals, --var names, or dotted paths. */
  categorical: string[];
  /** Background the marks render on. Literal, --var name, or dotted path. */
  background: string;
  /** Optional semantic roles to check against the palette. */
  semantic?: Record<string, string>;
  mode?: FloorsMode;
  floors?: Partial<Floors>;
}

export interface ResolvedConfig {
  colors: string[];
  background: string;
  semanticRoles?: Record<string, string>;
  mode?: FloorsMode;
  floors?: Partial<Floors>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateConfig(raw: unknown, configPath: string): AuditConfig {
  if (!isRecord(raw)) throw new Error(`${configPath}: config must be a JSON object.`);
  const c = raw as Partial<AuditConfig>;
  if (!Array.isArray(c.categorical) || c.categorical.length === 0) {
    throw new Error(`${configPath}: "categorical" must be a non-empty array of color references.`);
  }
  if (typeof c.background !== "string" || c.background.length === 0) {
    throw new Error(`${configPath}: "background" (string) is required.`);
  }
  if (c.mode && !["perceptual", "redundant-encodings", "strict"].includes(c.mode)) {
    throw new Error(
      `${configPath}: "mode" must be perceptual, redundant-encodings, or strict (got "${String(c.mode)}").`
    );
  }
  return c as AuditConfig;
}

/** Load token file (if any) and resolve every reference to a color string. */
export function resolveConfig(config: AuditConfig, baseDir: string): ResolvedConfig {
  let cssVars: CssVars | null = null;
  let tokenColors: TokenColors | null = null;

  if (config.tokens) {
    const path = config.tokens.startsWith("/")
      ? config.tokens
      : `${baseDir}/${config.tokens}`;
    const content = readFileSync(path, "utf8");
    if (config.tokens.endsWith(".json")) {
      tokenColors = parseTokensJson(content);
    } else {
      cssVars = parseCssVars(content, config.selector ?? ":root");
    }
  }

  function resolve(ref: string, what: string): string {
    if (parseColor(ref)) return ref;
    if (ref.startsWith("--")) {
      const v = cssVars?.[ref];
      if (v === undefined) {
        throw new Error(
          `${what}: "${ref}" not found in ${config.tokens ?? "(no tokens file configured)"}${config.selector ? ` under ${config.selector}` : ""}.`
        );
      }
      return v;
    }
    const t = tokenColors?.[ref];
    if (t !== undefined) return t;
    throw new Error(
      `${what}: "${ref}" is not a parseable color, a known CSS variable, or a token path.`
    );
  }

  return {
    colors: config.categorical.map((ref, i) => resolve(ref, `categorical[${i}]`)),
    background: resolve(config.background, "background"),
    semanticRoles: config.semantic
      ? Object.fromEntries(
          Object.entries(config.semantic).map(([role, ref]) => [
            role,
            resolve(ref, `semantic.${role}`),
          ])
        )
      : undefined,
    mode: config.mode,
    floors: config.floors,
  };
}

export function loadConfig(configPath: string): ResolvedConfig {
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const config = validateConfig(raw, configPath);
  const baseDir = configPath.includes("/")
    ? configPath.slice(0, configPath.lastIndexOf("/"))
    : ".";
  return resolveConfig(config, baseDir);
}

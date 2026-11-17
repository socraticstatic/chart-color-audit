/**
 * chartaudit.config.json — the CI path. Token references resolve in three
 * ways, checked in order:
 *   1. a literal color ("#4E79A7", "hsl(210 40% 50%)")
 *   2. a CSS custom-property name ("--chart-cat-1") looked up in the tokens file
 *   3. a dotted path ("chart.categorical.1") into a design-tokens JSON file
 */
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { parseColor } from "./engine/color.js";
import { parseCssVars, resolveCssValue, type CssVars } from "./parsers/css.js";
import { parseTokensJson, type TokenColors } from "./parsers/tokens.js";
import type { FloorsMode, Floors } from "./engine/audit.js";

export interface AuditConfig {
  /** Path to a .css or .json token file (relative to the config file). */
  tokens?: string;
  /**
   * CSS selector whose block holds the variables. Default ":root". Any other
   * selector is read on top of ":root", as the cascade would apply it.
   */
  selector?: string;
  /** Categorical slots, in order. Literals, --var names, or dotted paths. */
  categorical: string[];
  /** Background the marks render on. Literal, --var name, or dotted path. */
  background: string;
  /** Optional semantic roles to check against the palette. */
  semantic?: Record<string, string>;
  /** Tokens rendered as UI text, audited at 4.5:1 (SC 1.4.3), not the 3:1 mark floor. */
  text?: Record<string, string>;
  mode?: FloorsMode;
  floors?: Partial<Floors>;
}

export interface ResolvedConfig {
  colors: string[];
  background: string;
  semanticRoles?: Record<string, string>;
  textRoles?: Record<string, string>;
  mode?: FloorsMode;
  floors?: Partial<Floors>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CONFIG_KEYS = ["tokens", "selector", "categorical", "background", "semantic", "text", "mode", "floors"];

function requireColorMap(value: unknown, key: string, configPath: string): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.values(value).some((v) => typeof v !== "string")) {
    throw new Error(`${configPath}: "${key}" must be an object of role name to color reference.`);
  }
}

export function validateConfig(raw: unknown, configPath: string): AuditConfig {
  if (!isRecord(raw)) throw new Error(`${configPath}: config must be a JSON object.`);
  // An unknown key is almost always a typo, and a typo in an optional key
  // would silently drop a check. "$schema" and other "$" keys are allowed.
  const unknown = Object.keys(raw).filter((k) => !CONFIG_KEYS.includes(k) && !k.startsWith("$"));
  if (unknown.length > 0) {
    throw new Error(
      `${configPath}: unknown key${unknown.length === 1 ? "" : "s"} ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `Expected: ${CONFIG_KEYS.join(", ")}.`
    );
  }
  const c = raw as Partial<AuditConfig>;
  if (!Array.isArray(c.categorical) || c.categorical.length === 0) {
    throw new Error(`${configPath}: "categorical" must be a non-empty array of color references.`);
  }
  if (c.categorical.some((ref) => typeof ref !== "string" || ref.length === 0)) {
    throw new Error(`${configPath}: every "categorical" entry must be a color reference string.`);
  }
  if (typeof c.background !== "string" || c.background.length === 0) {
    throw new Error(`${configPath}: "background" (string) is required.`);
  }
  for (const key of ["tokens", "selector"] as const) {
    if (c[key] !== undefined && typeof c[key] !== "string") {
      throw new Error(`${configPath}: "${key}" must be a string.`);
    }
  }
  requireColorMap(c.semantic, "semantic", configPath);
  requireColorMap(c.text, "text", configPath);
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
    const content = readFileSync(resolvePath(baseDir, config.tokens), "utf8");
    if (config.tokens.toLowerCase().endsWith(".json")) {
      tokenColors = parseTokensJson(content);
    } else {
      const selector = config.selector ?? ":root";
      cssVars = parseCssVars(content, ":root");
      if (selector !== ":root") cssVars = { ...cssVars, ...parseCssVars(content, selector) };
    }
  }

  function resolve(ref: string, what: string): string {
    if (parseColor(ref)) return ref;
    if (ref.startsWith("--") || ref.includes("var(")) {
      const declared = ref.startsWith("--") ? cssVars?.[ref] : ref;
      if (declared === undefined) {
        throw new Error(
          `${what}: "${ref}" not found in ${config.tokens ?? "(no tokens file configured)"}${config.selector ? ` under ${config.selector}` : ""}.`
        );
      }
      try {
        return resolveCssValue(declared, cssVars ?? {}, ref.startsWith("--") ? [ref] : []);
      } catch (e) {
        throw new Error(`${what}: "${ref}": ${e instanceof Error ? e.message : String(e)}.`);
      }
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
    textRoles: config.text
      ? Object.fromEntries(
          Object.entries(config.text).map(([role, ref]) => [role, resolve(ref, `text.${role}`)])
        )
      : undefined,
    mode: config.mode,
    floors: config.floors,
  };
}

/** One audit to run: the whole config, or one of its themes. */
export interface ThemeConfig {
  /** Theme name, or null for a config with no "themes". */
  name: string | null;
  config: ResolvedConfig;
}

const MERGED_MAPS = ["semantic", "text", "floors"] as const;

/**
 * Load a config that may declare "themes": an object of theme name to
 * overrides of any top-level key. Each theme is the top-level config with its
 * overrides applied ("semantic", "text" and "floors" merge key by key; every
 * other key is replaced), then validated and resolved on its own. A config
 * with no "themes" yields a single entry named null.
 */
export function loadThemes(configPath: string): ThemeConfig[] {
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const baseDir = dirname(configPath);
  if (!isRecord(raw) || raw.themes === undefined) {
    return [{ name: null, config: resolveConfig(validateConfig(raw, configPath), baseDir) }];
  }
  const { themes, ...base } = raw;
  if (!isRecord(themes) || Object.keys(themes).length === 0) {
    throw new Error(`${configPath}: "themes" must be a non-empty object of theme name to overrides.`);
  }
  return Object.entries(themes).map(([name, override]) => {
    const where = `${configPath}, theme "${name}"`;
    if (!isRecord(override)) throw new Error(`${where}: must be an object of overrides.`);
    if ("themes" in override) throw new Error(`${where}: a theme cannot declare "themes".`);
    const merged: Record<string, unknown> = { ...base, ...override };
    for (const key of MERGED_MAPS) {
      const b = base[key];
      const o = override[key];
      if (isRecord(b) && isRecord(o)) merged[key] = { ...b, ...o };
    }
    const config = validateConfig(merged, where);
    try {
      return { name, config: resolveConfig(config, baseDir) };
    } catch (e) {
      throw new Error(`theme "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

/** Load a config with no themes. For one that has them, use `loadThemes`. */
export function loadConfig(configPath: string): ResolvedConfig {
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (isRecord(raw) && raw.themes !== undefined) {
    throw new Error(`${configPath}: this config declares "themes". Load it with loadThemes.`);
  }
  const config = validateConfig(raw, configPath);
  return resolveConfig(config, dirname(configPath));
}

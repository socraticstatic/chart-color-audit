/**
 * CSS custom-property parser. Extracts `--name: value` declarations from the
 * blocks matching a selector (default `:root`). Flat blocks only — no CSS
 * nesting — which covers the design-token stylesheets this tool targets.
 *
 * Values come in two shapes in the wild: standard color strings culori can
 * parse directly (#hex, hsl(...), rgb(...)), and raw shadcn-style HSL
 * triples ("222 47% 6%"). parseColor handles both.
 */

export interface CssVars {
  /** Variable name (including leading --) → raw declared value. */
  [name: string]: string;
}

/**
 * Return the custom properties declared in every block whose selector list
 * contains `selector` as one of its comma-separated selectors. Later blocks
 * override earlier ones, matching the cascade for equal specificity.
 */
export function parseCssVars(css: string, selector = ":root"): CssVars {
  const out: CssVars = {};
  // Strip comments so a commented-out block can't match.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(stripped)) !== null) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const body = m[2] ?? "";
    // The last declaration in a block may have no closing semicolon.
    const declRe = /(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      const value = (d[2] ?? "").replace(/!\s*important\s*$/i, "").trim();
      if (value) out[(d[1] ?? "").trim()] = value;
    }
  }
  return out;
}

// var(--name) or var(--name, fallback). The fallback may hold one level of
// parentheses, which covers a color function or a nested var().
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/;

/**
 * Replace every `var()` in a value with what it points at, following chains
 * (`--chart-1: var(--blue)`) and the shadcn form (`hsl(var(--primary))`).
 * An undeclared variable uses its fallback when it has one. Throws on an
 * undeclared variable with no fallback, and on a circular reference.
 */
export function resolveCssValue(value: string, vars: CssVars, seen: string[] = []): string {
  let out = value;
  for (let guard = 0; guard < 100; guard++) {
    const m = VAR_RE.exec(out);
    if (!m) return out;
    const name = m[1] ?? "";
    if (seen.includes(name)) {
      throw new Error(`circular var() reference: ${[...seen, name].join(" -> ")}`);
    }
    const declared = vars[name];
    let replacement: string;
    if (declared !== undefined) {
      replacement = resolveCssValue(declared, vars, [...seen, name]);
    } else if (m[2] !== undefined) {
      replacement = resolveCssValue(m[2].trim(), vars, seen);
    } else {
      throw new Error(`var(${name}) is not declared`);
    }
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
  }
  throw new Error(`too many var() references in "${value}"`);
}

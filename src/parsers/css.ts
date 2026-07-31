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
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      out[(d[1] ?? "").trim()] = (d[2] ?? "").trim();
    }
  }
  return out;
}

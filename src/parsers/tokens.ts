/**
 * W3C design-tokens JSON parser. Walks the tree collecting every token whose
 * `$type` is "color" (declared on the token or inherited from a group) and
 * returns them keyed by dotted path.
 *
 * A color `$value` is either a CSS color string or the Design Tokens format's
 * color object (`{ colorSpace, components, alpha, hex }`), which is turned
 * into the CSS color string for the same color. An alias (`"{path.to.token}"`)
 * resolves to the color it points at, through chains.
 */

export interface TokenColors {
  /** Dotted path (e.g. "chart.categorical.1") → color string. */
  [path: string]: string;
}

interface TokenNode {
  [key: string]: unknown;
}

function isNode(v: unknown): v is TokenNode {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const COLOR_FUNCTION_SPACES = new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d65",
  "xyz-d50",
]);

/**
 * A Design Tokens color object as a CSS color string, or null when it cannot
 * be expressed (unknown color space, malformed components) and has no `hex`
 * fallback.
 */
export function tokenColorToCss(value: TokenNode): string | null {
  const fallback = typeof value.hex === "string" ? value.hex : null;
  const space = value.colorSpace;
  const raw = value.components;
  if (typeof space !== "string" || !Array.isArray(raw) || raw.length !== 3) return fallback;
  const c: string[] = [];
  for (const x of raw) {
    if (x === "none") c.push("none");
    else if (typeof x === "number" && Number.isFinite(x)) c.push(String(x));
    else return fallback;
  }
  const [c0, c1, c2] = c as [string, string, string];
  const pct = (x: string) => (x === "none" ? x : `${x}%`);
  const alpha = typeof value.alpha === "number" && Number.isFinite(value.alpha) ? ` / ${value.alpha}` : "";
  switch (space) {
    case "hsl":
      return `hsl(${c0} ${pct(c1)} ${pct(c2)}${alpha})`;
    case "hwb":
      return `hwb(${c0} ${pct(c1)} ${pct(c2)}${alpha})`;
    case "lab":
    case "lch":
    case "oklab":
    case "oklch":
      return `${space}(${c0} ${c1} ${c2}${alpha})`;
    default:
      return COLOR_FUNCTION_SPACES.has(space) ? `color(${space} ${c0} ${c1} ${c2}${alpha})` : fallback;
  }
}

export function parseTokensJson(json: string): TokenColors {
  const root = JSON.parse(json) as TokenNode;
  const out: TokenColors = {};
  /** Token path → the path its alias points at. */
  const aliases: Record<string, string> = {};

  function walk(node: TokenNode, path: string[], inheritedType: string | null) {
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      const key = path.join(".");
      const value = node.$value;
      if (typeof value === "string") {
        const alias = /^\{([^{}]+)\}$/.exec(value.trim());
        // An alias takes the type of its target, so it is kept whatever
        // type this token declares and settled once every token is known.
        if (alias) aliases[key] = (alias[1] ?? "").trim();
        else if (type === "color") out[key] = value;
      } else if (type === "color" && isNode(value)) {
        const css = tokenColorToCss(value);
        if (css !== null) out[key] = css;
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (isNode(value)) walk(value, [...path, key], type);
    }
  }

  walk(root, [], null);

  function follow(path: string, seen: string[]): string | undefined {
    const direct = out[path];
    if (direct !== undefined) return direct;
    const target = aliases[path];
    if (target === undefined) return undefined;
    if (seen.includes(path)) {
      throw new Error(`Circular token alias: ${[...seen, path].join(" -> ")}`);
    }
    return follow(target, [...seen, path]);
  }
  for (const path of Object.keys(aliases)) {
    const color = follow(path, []);
    if (color !== undefined) out[path] = color;
  }
  return out;
}

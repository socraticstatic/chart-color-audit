/**
 * W3C design-tokens JSON parser. Walks the tree collecting every token whose
 * `$type` is "color" (declared on the token or inherited from a group) and
 * returns them keyed by dotted path.
 */

export interface TokenColors {
  /** Dotted path (e.g. "chart.categorical.1") → raw $value string. */
  [path: string]: string;
}

interface TokenNode {
  [key: string]: unknown;
}

export function parseTokensJson(json: string): TokenColors {
  const root = JSON.parse(json) as TokenNode;
  const out: TokenColors = {};

  function walk(node: TokenNode, path: string[], inheritedType: string | null) {
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      if (type === "color" && typeof node.$value === "string") {
        out[path.join(".")] = node.$value;
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value as TokenNode, [...path, key], type);
      }
    }
  }

  walk(root, [], null);
  return out;
}

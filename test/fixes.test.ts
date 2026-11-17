import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/engine/audit.js";
import { compositeOver, contrastRatio, parseColor } from "../src/engine/color.js";
import { parseCssVars, resolveCssValue } from "../src/parsers/css.js";
import { parseTokensJson, tokenColorToCss } from "../src/parsers/tokens.js";
import { loadConfig, validateConfig } from "../src/config.js";
import { splitColors } from "../src/split.js";

const TABLEAU10 = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
];

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "chart-color-audit-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return join(dir, "chartaudit.config.json");
}

describe("alpha: a translucent color is measured as it renders", () => {
  it("records alpha on the parsed color", () => {
    expect(parseColor("#000000")!.alpha).toBe(1);
    expect(parseColor("rgba(0, 0, 0, 0.5)")!.alpha).toBeCloseTo(0.5, 6);
    expect(parseColor("transparent")!.alpha).toBe(0);
  });

  it("composites over the background in sRGB", () => {
    const white = parseColor("#fff")!;
    expect(compositeOver(parseColor("rgba(0, 0, 0, 0.5)")!, white).hex).toBe("#808080");
    expect(compositeOver(parseColor("transparent")!, white).hex).toBe("#ffffff");
    const opaque = parseColor("#2456A4")!;
    expect(compositeOver(opaque, white)).toBe(opaque);
  });

  it("a fully transparent mark fails contrast instead of passing as black", () => {
    const r = audit({ colors: ["transparent"], background: "#fff" });
    expect(r.contrast[0]!.ratio).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("fail");
    expect(r.colors[0]).toEqual({ hex: "#ffffff", input: "transparent", alpha: 0 });
  });

  it("10% black on white is a pale gray, not black at 21:1", () => {
    const r = audit({ colors: ["rgba(0,0,0,0.1)"], background: "#fff" });
    expect(r.colors[0]!.hex).toBe("#e6e6e6");
    expect(r.contrast[0]!.ratio).toBeLessThan(1.5);
    expect(r.contrast[0]!.pass).toBe(false);
  });

  it("two translucent series are compared as rendered", () => {
    // The same hue at two opacities is two different colors on screen.
    const r = audit({ colors: ["rgba(36,86,164,1)", "rgba(36,86,164,0.3)"], background: "#fff" });
    expect(r.perVision[0]!.minDeltaE).toBeGreaterThan(10);
  });

  it("opaque input reports no alpha and is unchanged", () => {
    const r = audit({ colors: ["#2456A4", "#B03A2E"], background: "#fff" });
    expect(r.colors[0]).toEqual({ hex: "#2456a4", input: "#2456A4" });
    expect(r.verdict).toBe("pass");
  });

  it("text and semantic roles are composited too", () => {
    const r = audit({
      colors: ["#2456A4"],
      background: "#fff",
      textRoles: { faint: "rgba(0,0,0,0.3)" },
      semanticRoles: { ghost: "rgba(0,0,0,0.05)" },
    });
    expect(r.text[0]!.pass).toBe(false);
    expect(r.semantic[0]!.status).toBe("low-contrast");
  });

  it("refuses a translucent background", () => {
    expect(() => audit({ colors: ["#000"], background: "rgba(255,255,255,0.5)" })).toThrow(/not opaque/);
  });
});

describe("CSS custom properties", () => {
  it("reads the last declaration when it has no semicolon", () => {
    expect(parseCssVars(":root{--a:#111;--b:#222}")).toEqual({ "--a": "#111", "--b": "#222" });
    expect(parseCssVars(":root {\n  --a: #111;\n  --b: #222\n}")).toEqual({ "--a": "#111", "--b": "#222" });
  });

  it("drops !important", () => {
    expect(parseCssVars(":root{--a:#fff !important;--b:#000!important}")).toEqual({ "--a": "#fff", "--b": "#000" });
  });

  it("follows var() chains", () => {
    const vars = parseCssVars(":root{--blue-500:#2456A4;--brand:var(--blue-500);--chart-1:var(--brand);}");
    expect(resolveCssValue(vars["--chart-1"]!, vars)).toBe("#2456A4");
  });

  it("resolves the shadcn form hsl(var(--x))", () => {
    const vars = parseCssVars(":root{--primary:222 47% 6%;--chart-1:hsl(var(--primary));}");
    const value = resolveCssValue(vars["--chart-1"]!, vars);
    expect(value).toBe("hsl(222 47% 6%)");
    expect(parseColor(value)!.hex).toBe(parseColor("222 47% 6%")!.hex);
  });

  it("uses a fallback only when the variable is undeclared", () => {
    expect(resolveCssValue("var(--missing, #abcdef)", {})).toBe("#abcdef");
    expect(resolveCssValue("var(--missing, rgb(1, 2, 3))", {})).toBe("rgb(1, 2, 3)");
    expect(resolveCssValue("var(--missing, var(--there))", { "--there": "#123456" })).toBe("#123456");
    expect(resolveCssValue("var(--there, #abcdef)", { "--there": "#123456" })).toBe("#123456");
  });

  it("names an undeclared variable and a cycle", () => {
    expect(() => resolveCssValue("var(--nope)", {})).toThrow(/var\(--nope\) is not declared/);
    expect(() => resolveCssValue("var(--a)", { "--a": "var(--b)", "--b": "var(--a)" })).toThrow(
      /circular var\(\) reference: --a -> --b -> --a/
    );
  });
});

describe("config resolution", () => {
  it("resolves aliased CSS variables end to end", () => {
    const path = project({
      "t.css": ":root{--blue:#2456A4;--red:#B03A2E;--chart-1:var(--blue);--chart-2:var(--red);--bg:#fff}",
      "chartaudit.config.json": JSON.stringify({
        tokens: "t.css",
        categorical: ["--chart-1", "--chart-2"],
        background: "--bg",
      }),
    });
    const resolved = loadConfig(path);
    expect(resolved.colors).toEqual(["#2456A4", "#B03A2E"]);
    expect(resolved.background).toBe("#fff");
  });

  it("reads another selector on top of :root, as the cascade does", () => {
    const path = project({
      "t.css": ":root{--blue:#2456A4;--chart-1:var(--blue);--bg:#fff;} .dark{--bg:#111;--blue:#8ab4ff;}",
      "chartaudit.config.json": JSON.stringify({
        tokens: "t.css",
        selector: ".dark",
        categorical: ["--chart-1"],
        background: "--bg",
      }),
    });
    expect(loadConfig(path)).toMatchObject({ colors: ["#8ab4ff"], background: "#111" });
  });

  it("reports a missing variable with the reference that needed it", () => {
    const path = project({
      "t.css": ":root{--chart-1:var(--gone);--bg:#fff;}",
      "chartaudit.config.json": JSON.stringify({ tokens: "t.css", categorical: ["--chart-1"], background: "--bg" }),
    });
    expect(() => loadConfig(path)).toThrow(/categorical\[0\]: "--chart-1": var\(--gone\) is not declared/);
  });

  it("rejects an unknown key, which is nearly always a typo that drops a check", () => {
    const base = { categorical: ["#000"], background: "#fff" };
    expect(() => validateConfig({ ...base, sematic: { a: "#000" } }, "c.json")).toThrow(/unknown key "sematic"/);
    expect(() => validateConfig({ ...base, $schema: "https://example.com/s.json" }, "c.json")).not.toThrow();
  });

  it("rejects a role map that is not strings", () => {
    const base = { categorical: ["#000"], background: "#fff" };
    expect(() => validateConfig({ ...base, text: { a: 3 } }, "c.json")).toThrow(/"text" must be an object/);
    expect(() => validateConfig({ ...base, categorical: ["#000", 5] }, "c.json")).toThrow(/every "categorical" entry/);
  });
});

describe("design tokens", () => {
  it("resolves aliases, through chains, whatever type the alias declares", () => {
    const tokens = parseTokensJson(
      JSON.stringify({
        base: { $type: "color", blue: { $value: "#2456A4" } },
        brand: { primary: { $value: "{base.blue}" } },
        chart: { one: { $value: "{brand.primary}" } },
      })
    );
    expect(tokens).toEqual({ "base.blue": "#2456A4", "brand.primary": "#2456A4", "chart.one": "#2456A4" });
  });

  it("ignores an alias to something that is not a color, and names a cycle", () => {
    const tokens = parseTokensJson(
      JSON.stringify({ size: { $type: "dimension", s: { $value: "4px" } }, x: { $value: "{size.s}" } })
    );
    expect(tokens).toEqual({});
    expect(() => parseTokensJson(JSON.stringify({ a: { $value: "{b}" }, b: { $value: "{a}" } }))).toThrow(
      /Circular token alias: a -> b -> a/
    );
  });

  it("reads the color object form in every color space", () => {
    const hexOf = (value: Record<string, unknown>) => parseColor(tokenColorToCss(value)!)!.hex;
    const srgb = [0x24 / 255, 0x56 / 255, 0xa4 / 255];
    expect(hexOf({ colorSpace: "srgb", components: srgb })).toBe("#2456a4");
    expect(hexOf({ colorSpace: "hsl", components: [0, 100, 50] })).toBe("#ff0000");
    expect(hexOf({ colorSpace: "hwb", components: [120, 0, 0] })).toBe("#00ff00");
    expect(hexOf({ colorSpace: "oklch", components: [1, 0, 0] })).toBe("#ffffff");
    expect(hexOf({ colorSpace: "oklab", components: [0, 0, 0] })).toBe("#000000");
    expect(hexOf({ colorSpace: "lab", components: [100, 0, 0] })).toBe("#ffffff");
    expect(hexOf({ colorSpace: "lch", components: [0, 0, "none"] })).toBe("#000000");
    for (const space of ["srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020"]) {
      expect(hexOf({ colorSpace: space, components: [1, 1, 1] }), space).toBe("#ffffff");
      expect(hexOf({ colorSpace: space, components: [0, 0, 0] }), space).toBe("#000000");
    }
    for (const space of ["xyz-d65", "xyz-d50"]) {
      expect(hexOf({ colorSpace: space, components: [0, 0, 0] }), space).toBe("#000000");
    }
  });

  it("carries alpha, and falls back to hex for a space it cannot express", () => {
    expect(parseColor(tokenColorToCss({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.25 })!)!.alpha).toBeCloseTo(0.25, 6);
    expect(tokenColorToCss({ colorSpace: "made-up", components: [1, 2, 3], hex: "#123456" })).toBe("#123456");
    expect(tokenColorToCss({ colorSpace: "made-up", components: [1, 2, 3] })).toBeNull();
  });

  it("collects object-valued tokens by path", () => {
    const tokens = parseTokensJson(
      JSON.stringify({
        chart: {
          $type: "color",
          one: { $value: { colorSpace: "srgb", components: [0, 0, 1], hex: "#0000ff" } },
          two: { $value: "{chart.one}" },
        },
      })
    );
    expect(parseColor(tokens["chart.one"]!)!.hex).toBe("#0000ff");
    expect(tokens["chart.two"]).toBe(tokens["chart.one"]);
  });
});

describe("--colors splitting", () => {
  it("keeps the commas inside a color function", () => {
    expect(splitColors("rgb(255, 0, 0), #00f")).toEqual(["rgb(255, 0, 0)", "#00f"]);
    expect(splitColors("#4E79A7,#F28E2B, #E15759 ,")).toEqual(["#4E79A7", "#F28E2B", "#E15759"]);
    expect(splitColors("hsl(210, 40%, 50%),rgba(0, 0, 0, 0.5),red")).toEqual([
      "hsl(210, 40%, 50%)",
      "rgba(0, 0, 0, 0.5)",
      "red",
    ]);
  });
});

describe("every failing pair is reported", () => {
  it("Tableau 10 under protanopia: four pairs, closest first", () => {
    const r = audit({ colors: TABLEAU10, background: "#fff" });
    const protan = r.perVision.find((v) => v.mode === "protan")!;
    expect(protan.failingPairs).toHaveLength(4);
    expect(protan.failingPairs[0]!.pair).toEqual(protan.closestPair);
    const distances = protan.failingPairs.map((p) => p.deltaE);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    for (const p of protan.failingPairs) expect(p.deltaE).toBeLessThan(protan.floor);
    const line = r.failures.find((f) => f.startsWith("protan"))!;
    expect(line).toContain("Also below the floor:");
  });

  it("a passing mode has none, and the finding count is unchanged", () => {
    const r = audit({ colors: TABLEAU10, background: "#fff" });
    expect(r.perVision.find((v) => v.mode === "normal")!.failingPairs).toEqual([]);
    expect(r.failures).toHaveLength(8);
  });
});

describe("floors are validated", () => {
  const base = { colors: ["#777"], background: "#fff" };
  it("rejects a floor that is not a number of 0 or more", () => {
    expect(() => audit({ ...base, floors: { minContrast: "high" as unknown as number } })).toThrow(/Floor "minContrast"/);
    expect(() => audit({ ...base, floors: { minContrast: -1 } })).toThrow(/Floor "minContrast"/);
    expect(() => audit({ ...base, floors: { minContrast: NaN } })).toThrow(/Floor "minContrast"/);
  });
  it("rejects an unknown floor", () => {
    expect(() => audit({ ...base, floors: { minContrst: 3 } as never })).toThrow(/Unknown floor "minContrst"/);
  });
  it("an undefined override keeps the preset", () => {
    expect(audit({ ...base, floors: { minContrast: undefined } }).floors.minContrast).toBe(3);
  });
});

describe("contrastRatio is unchanged for opaque colors", () => {
  it("black on white is 21", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 6);
  });
});

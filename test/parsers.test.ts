import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCssVars } from "../src/parsers/css.js";
import { parseTokensJson } from "../src/parsers/tokens.js";
import { loadConfig } from "../src/config.js";

describe("parseCssVars", () => {
  const css = readFileSync(new URL("./fixtures/site.css", import.meta.url), "utf8");

  it("extracts raw HSL triples from :root", () => {
    const vars = parseCssVars(css, ":root");
    expect(vars["--chart-bg"]).toBe("0 0% 100%");
    expect(vars["--chart-cat-anchor-1"]).toBe("210 85% 45%");
  });

  it("extracts the dark theme block separately", () => {
    const dark = parseCssVars(css, ".dark");
    expect(dark["--chart-bg"]).toBe("222 47% 6%");
  });

  it("handles standard color values and comments", () => {
    const vars = parseCssVars(
      `/* c1 */ :root { --a: #ff0000; /* inline */ --b: hsl(210 40% 50%); }
       .x { --c: #00ff00; }`
    );
    expect(vars["--a"]).toBe("#ff0000");
    expect(vars["--b"]).toBe("hsl(210 40% 50%)");
    expect(vars["--c"]).toBeUndefined();
  });

  it("later blocks override earlier ones", () => {
    const vars = parseCssVars(`:root { --a: #111; } :root { --a: #222; }`);
    expect(vars["--a"]).toBe("#222");
  });
});

describe("parseTokensJson", () => {
  const json = readFileSync(new URL("./fixtures/tokens.json", import.meta.url), "utf8");

  it("collects color tokens by dotted path, inheriting group $type", () => {
    const tokens = parseTokensJson(json);
    expect(tokens["chart.categorical.1"]).toBe("#4E79A7");
    expect(tokens["chart.background"]).toBe("#ffffff");
    expect(tokens["chart.semantic.positive"]).toBe("#25935F");
  });

  it("ignores non-color tokens", () => {
    const tokens = parseTokensJson(json);
    expect(tokens["chart.label"]).toBeUndefined();
  });
});

describe("loadConfig end to end", () => {
  it("resolves CSS variable references through a config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "chartaudit-"));
    const cssPath = join(dir, "tokens.css");
    writeFileSync(
      cssPath,
      `:root { --bg: #ffffff; --c1: 210 85% 45%; --c2: #F28E2B; }`
    );
    const configPath = join(dir, "chartaudit.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        tokens: "tokens.css",
        categorical: ["--c1", "--c2", "#E15759"],
        background: "--bg",
        mode: "perceptual",
      })
    );
    const resolved = loadConfig(configPath);
    expect(resolved.colors).toEqual(["210 85% 45%", "#F28E2B", "#E15759"]);
    expect(resolved.background).toBe("#ffffff");
    expect(resolved.mode).toBe("perceptual");
  });

  it("fails loudly on an unknown variable", () => {
    const dir = mkdtempSync(join(tmpdir(), "chartaudit-"));
    const configPath = join(dir, "chartaudit.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ categorical: ["--nope"], background: "#fff" })
    );
    expect(() => loadConfig(configPath)).toThrow(/--nope/);
  });
});

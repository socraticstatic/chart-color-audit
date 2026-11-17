import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, FLOOR_PRESETS } from "../src/engine/audit.js";
import { loadConfig, loadThemes } from "../src/config.js";
import { auditConfigFile, isThemed } from "../src/run.js";
// @ts-expect-error plain ESM script shipped with the GitHub Action, no types
import { annotations, markdown, outputs } from "../action/summary.mjs";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "chart-color-audit-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return join(dir, "chartaudit.config.json");
}

describe("contrast between series", () => {
  it("is off by default in every preset, so no default floor changed", () => {
    for (const preset of Object.values(FLOOR_PRESETS)) expect(preset.minPairContrast).toBe(0);
  });

  it("is always measured and never fails while the floor is 0", () => {
    const r = audit({ colors: ["#4E79A7", "#F28E2B", "#E15759"], background: "#fff" });
    expect(r.pairContrast.floor).toBe(0);
    expect(r.pairContrast.pass).toBe(true);
    expect(r.pairContrast.failingPairs).toEqual([]);
    expect(r.pairContrast.lowestPair).toEqual([0, 2]);
    expect(r.pairContrast.min).toBeCloseTo(1.24, 2);
    expect(r.failures.some((f) => f.startsWith("pair contrast"))).toBe(false);
  });

  it("fails pairs below the floor once one is set, lowest first", () => {
    const r = audit({
      colors: ["#4E79A7", "#F28E2B", "#E15759"],
      background: "#fff",
      floors: { minPairContrast: 3 },
    });
    expect(r.pairContrast.pass).toBe(false);
    expect(r.pairContrast.failingPairs).toHaveLength(3);
    expect(r.pairContrast.failingPairs[0]!.pair).toEqual(r.pairContrast.lowestPair);
    const ratios = r.pairContrast.failingPairs.map((p) => p.ratio);
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
    expect(r.failures.filter((f) => f.startsWith("pair contrast"))).toHaveLength(1);
    expect(r.verdict).toBe("fail");
  });

  it("passes a pair that clears the floor: black and white are 21:1", () => {
    const r = audit({ colors: ["#000", "#fff"], background: "#808080", floors: { minPairContrast: 3 } });
    expect(r.pairContrast.pass).toBe(true);
    expect(r.pairContrast.min).toBeCloseTo(21, 6);
  });

  it("a single color has no pair", () => {
    const r = audit({ colors: ["#000"], background: "#fff", floors: { minPairContrast: 3 } });
    expect(r.pairContrast.lowestPair).toBeNull();
    expect(r.pairContrast.pass).toBe(true);
  });
});

describe("themes", () => {
  it("a config with no themes is one unnamed run and a plain result", () => {
    const themes = loadThemes(fixture("ci-config.json"));
    expect(themes).toHaveLength(1);
    expect(themes[0]!.name).toBeNull();
    expect(isThemed(auditConfigFile(fixture("ci-config.json")))).toBe(false);
  });

  it("resolves each theme against its own selector, on top of :root", () => {
    const themes = loadThemes(fixture("themes-config.json"));
    expect(themes.map((t) => t.name)).toEqual(["light", "dark"]);
    expect(themes[0]!.config).toMatchObject({ colors: ["#2456A4", "#B03A2E"], background: "#ffffff" });
    expect(themes[1]!.config).toMatchObject({ colors: ["#8ab4ff", "#e0503c"], background: "#111318" });
    expect(themes[1]!.config.textRoles).toEqual({ label: "#aab2bd" });
  });

  it("audits every theme and passes when all pass", () => {
    const r = auditConfigFile(fixture("themes-config.json"));
    expect(isThemed(r)).toBe(true);
    if (!isThemed(r)) return;
    expect(Object.keys(r.themes)).toEqual(["light", "dark"]);
    expect(r.themes.light!.verdict).toBe("pass");
    expect(r.themes.dark!.verdict).toBe("pass");
    expect(r.verdict).toBe("pass");
  });

  it("fails overall when one theme fails, and says which", () => {
    // The light palette reused on a dark background: the classic miss.
    const path = project({
      "t.css": ":root{--a:#2456A4;--b:#B03A2E;--bg:#fff;} .dark{--bg:#111318;}",
      "chartaudit.config.json": JSON.stringify({
        tokens: "t.css",
        categorical: ["--a", "--b"],
        background: "--bg",
        themes: { light: {}, dark: { selector: ".dark" } },
      }),
    });
    const r = auditConfigFile(path);
    if (!isThemed(r)) throw new Error("expected a themed result");
    expect(r.themes.light!.verdict).toBe("pass");
    expect(r.themes.dark!.verdict).toBe("fail");
    expect(r.verdict).toBe("fail");
    const lines: string[] = annotations(JSON.parse(JSON.stringify(r)));
    expect(lines.length).toBe(r.themes.dark!.failures.length);
    expect(lines.every((l) => l.includes("[dark] "))).toBe(true);
    const md: string = markdown(JSON.parse(JSON.stringify(r)));
    expect(md).toContain("### Chart color audit: fail");
    expect(md).toContain("#### Theme light: pass");
    expect(md).toContain("#### Theme dark: fail");
    expect(outputs(JSON.parse(JSON.stringify(r)))).toEqual(["verdict=fail", `findings=${r.themes.dark!.failures.length}`]);
  });

  it("a theme can override the palette, and maps merge key by key", () => {
    const path = project({
      "chartaudit.config.json": JSON.stringify({
        categorical: ["#2456A4", "#B03A2E"],
        background: "#fff",
        text: { label: "#333", note: "#444" },
        floors: { minContrast: 3 },
        themes: {
          light: {},
          dark: {
            categorical: ["#8ab4ff", "#ff9e8f"],
            background: "#111318",
            text: { label: "#ddd" },
            floors: { minPairContrast: 1.1 },
          },
        },
      }),
    });
    const [light, dark] = loadThemes(path);
    expect(light!.config.colors).toEqual(["#2456A4", "#B03A2E"]);
    expect(dark!.config.colors).toEqual(["#8ab4ff", "#ff9e8f"]);
    expect(dark!.config.textRoles).toEqual({ label: "#ddd", note: "#444" });
    expect(dark!.config.floors).toEqual({ minContrast: 3, minPairContrast: 1.1 });
  });

  it("the mode argument overrides every theme", () => {
    const r = auditConfigFile(fixture("themes-config.json"), "strict");
    if (!isThemed(r)) throw new Error("expected a themed result");
    expect(Object.values(r.themes).every((t) => t.mode === "strict")).toBe(true);
  });

  it("names the theme in errors, and rejects malformed themes", () => {
    const bad = (themes: unknown, extra: Record<string, unknown> = {}) =>
      project({
        "chartaudit.config.json": JSON.stringify({ categorical: ["#000"], background: "#fff", ...extra, themes }),
      });
    expect(() => loadThemes(bad({}))).toThrow(/"themes" must be a non-empty object/);
    expect(() => loadThemes(bad({ dark: "x" }))).toThrow(/theme "dark": must be an object/);
    expect(() => loadThemes(bad({ dark: { bakground: "#000" } }))).toThrow(/theme "dark": unknown key "bakground"/);
    expect(() => loadThemes(bad({ dark: { themes: {} } }))).toThrow(/cannot declare "themes"/);
    expect(() => loadThemes(bad({ dark: { background: "--missing" } }))).toThrow(/theme "dark": background: "--missing" not found/);
  });

  it("loadConfig points a themed config at loadThemes", () => {
    expect(() => loadConfig(fixture("themes-config.json"))).toThrow(/loadThemes/);
  });
});

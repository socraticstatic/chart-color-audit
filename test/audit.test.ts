import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { audit, bandFor, FLOOR_PRESETS } from "../src/engine/audit.js";
import { parseColor, contrastRatio } from "../src/engine/color.js";
import { parseCssVars } from "../src/parsers/css.js";

const TABLEAU10 = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
];

describe("audit — zero-config palette", () => {
  it("passes a verified-distinct palette on white", () => {
    // Hand-verified: worst separation is grayscale ΔE 4.0; contrast 7.1 / 6.0.
    // (A red/green pair was rejected while writing this test — grayscale ΔE
    // 1.9, below JND. The engine catching that is the product working.)
    const r = audit({ colors: ["#2456A4", "#B03A2E"], background: "#fff" });
    expect(r.verdict).toBe("pass");
    expect(r.perVision).toHaveLength(5);
    for (const v of r.perVision) expect(v.pass).toBe(true);
  });

  it("fails identical colors with a collision band and a named pair", () => {
    const r = audit({ colors: ["#4E79A7", "#4E79A7"], background: "#fff" });
    expect(r.verdict).toBe("fail");
    const normal = r.perVision.find((v) => v.mode === "normal")!;
    expect(normal.band).toBe("collision");
    expect(normal.closestPair).toEqual([0, 1]);
    expect(r.failures.some((f) => f.includes("slots 1 and 2"))).toBe(true);
  });

  it("Tableau 10 on white: names a true worst CVD pair (the gate demo)", () => {
    const r = audit({ colors: TABLEAU10, background: "#fff" });
    // Tableau 10 contains low-contrast light slots (yellow, pink, gray) —
    // the audit must find real findings, not rubber-stamp a famous palette.
    expect(r.verdict).toBe("fail");
    const cvdModes = r.perVision.filter((v) => v.mode !== "normal");
    const worst = cvdModes.reduce((a, b) => (b.minDeltaE < a.minDeltaE ? b : a));
    expect(worst.closestPair).not.toBeNull();
    expect(worst.minDeltaE).toBeGreaterThan(0);
    expect(worst.minDeltaE).toBeLessThan(10); // genuinely close under CVD
  });

  it("throws a clear error for unparseable input", () => {
    expect(() => audit({ colors: ["#zzz"], background: "#fff" })).toThrow(/Cannot parse color 1/);
    expect(() => audit({ colors: [], background: "#fff" })).toThrow(/No colors/);
  });

  it("single color: pairwise n/a, contrast still enforced", () => {
    const r = audit({ colors: ["#eeeeee"], background: "#ffffff" });
    expect(r.perVision.every((v) => v.pass)).toBe(true);
    expect(r.verdict).toBe("fail"); // near-white on white fails 3:1
    expect(r.contrast[0]!.pass).toBe(false);
  });
});

describe("floors modes", () => {
  it("presets are ordered strict > perceptual > redundant-encodings", () => {
    expect(FLOOR_PRESETS.strict.minDeltaENormal).toBeGreaterThan(
      FLOOR_PRESETS.perceptual.minDeltaENormal
    );
    expect(FLOOR_PRESETS.perceptual.minDeltaECvd).toBeGreaterThan(
      FLOOR_PRESETS["redundant-encodings"].minDeltaECvd
    );
  });

  it("a palette can pass redundant-encodings and fail perceptual", () => {
    // Two colors ΔE ≈ 1.67 apart: above the redundant floor 1, below JND 2.
    const close = ["#4E79A7", "#527ead"];
    const relaxed = audit({ colors: close, background: "#fff", mode: "redundant-encodings" });
    const strict = audit({ colors: close, background: "#fff" });
    expect(relaxed.verdict).toBe("pass");
    expect(strict.verdict).toBe("fail");
  });

  it("bandFor words match the thresholds", () => {
    expect(bandFor(15, 2)).toBe("clearly-distinct");
    expect(bandFor(5, 2)).toBe("distinguishable");
    expect(bandFor(1, 0.1)).toBe("patterns-carry-identity");
    expect(bandFor(0.05, 0.1)).toBe("collision");
  });
});

describe("self-audit — the two known truths from the parent project", () => {
  const css = readFileSync(new URL("./fixtures/site.css", import.meta.url), "utf8");
  const vars = parseCssVars(css, ":root");
  // Positive/negative are the palette here; the parent's categorical palette
  // is solver output (not shipped as tokens), and its anchor-2 orange is a
  // documented contrast failure by design (anchors are preferences there).
  const palette = [vars["--chart-positive"]!, vars["--chart-negative"]!];
  const semantic = {
    muted: vars["--chart-muted"]!,
    other: vars["--chart-other"]!,
    target: vars["--chart-target"]!,
    forecast: vars["--chart-forecast"]!,
  };

  it("current tokens pass in redundant-encodings mode", () => {
    const r = audit({
      colors: palette,
      background: vars["--chart-bg"]!,
      semanticRoles: semantic,
      mode: "redundant-encodings",
    });
    expect(r.verdict).toBe("pass");
  });

  it("reverting muted to 65% lightness fails with low contrast (the shipped bug)", () => {
    const r = audit({
      colors: palette,
      background: vars["--chart-bg"]!,
      semanticRoles: { ...semantic, muted: "215 16% 65%" },
      mode: "redundant-encodings",
    });
    expect(r.verdict).toBe("fail");
    const muted = r.semantic.find((s) => s.role === "muted")!;
    expect(muted.status).toBe("low-contrast");
    expect(muted.contrast).toBeLessThan(3);
  });
});

describe("engine parity checks", () => {
  it("parses raw HSL triples exactly like wrapped hsl()", () => {
    const a = parseColor("222 47% 6%")!;
    const b = parseColor("hsl(222 47% 6%)")!;
    expect(a.hex).toBe(b.hex);
  });

  it("contrast ratio matches the hand-computed muted value (~2.55:1 at 65%)", () => {
    const muted65 = parseColor("215 16% 65%")!;
    const white = parseColor("#ffffff")!;
    expect(contrastRatio(muted65, white)).toBeCloseTo(2.55, 1);
  });
});

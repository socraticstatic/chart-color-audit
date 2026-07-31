import { describe, it, expect } from "vitest";
import { simulateRgb } from "../src/engine/cvd.js";

/**
 * Regression guard, ported verbatim from the Visualizations suite: the
 * simulation must match the published Machado, Oliveira & Fernandes 2009
 * dichromacy matrices (Table 1, severity 1.0,
 * inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html).
 *
 * History: a commit in the parent project replaced the correct DEUTAN matrix
 * with values that appear nowhere in the paper, while claiming to fix it.
 * These tests pin the observable behavior so that cannot silently happen
 * again — they are the credibility of this package.
 */

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function expected(m: number[], rgb: [number, number, number]) {
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  const clamp = (v: number) => Math.max(0, Math.min(1, enc(v)));
  return {
    r: clamp(m[0]! * r + m[1]! * g + m[2]! * b),
    g: clamp(m[3]! * r + m[4]! * g + m[5]! * b),
    b: clamp(m[6]! * r + m[7]! * g + m[8]! * b),
  };
}

// Published severity-1.0 matrices, verbatim from the paper's table.
const PUBLISHED = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
} as const;

const PROBES: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0.6, 0],
  [0.3, 0.7, 0.2],
];

describe("simulateRgb matches the published Machado 2009 matrices", () => {
  for (const type of ["protan", "deutan", "tritan"] as const) {
    it(type, () => {
      for (const probe of PROBES) {
        const got = simulateRgb({ r: probe[0], g: probe[1], b: probe[2] }, type);
        const want = expected([...PUBLISHED[type]], probe);
        expect(got.r).toBeCloseTo(want.r, 6);
        expect(got.g).toBeCloseTo(want.g, 6);
        expect(got.b).toBeCloseTo(want.b, 6);
      }
    });
  }

  it("deuteranopia collapses red toward olive (red must not stay red)", () => {
    const red = simulateRgb({ r: 1, g: 0, b: 0 }, "deutan");
    // A deutan viewer gains a strong G component for pure red; the corrupted
    // matrix left g ≈ 0, which kept red fully saturated.
    expect(red.g).toBeGreaterThan(0.4);
  });
});

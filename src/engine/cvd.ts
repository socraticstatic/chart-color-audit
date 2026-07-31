/**
 * Color-vision deficiency simulation using the published Machado, Oliveira &
 * Fernandes 2009 matrices (Table 1, severity 1.0 — dichromacy):
 * https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 *
 * The matrices are applied in LINEAR RGB, as the paper specifies. These
 * constants are pinned by test/cvd.test.ts against the published table —
 * do not "fix" them without re-checking the primary source.
 */

export type Matrix = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const PROTAN_1: Matrix = [
  0.152286, 1.052583, -0.204868,
  0.114503, 0.786281, 0.099216,
  -0.003882, -0.048116, 1.051998,
];

export const DEUTAN_1: Matrix = [
  0.367322, 0.860646, -0.227968,
  0.280085, 0.672501, 0.047413,
  -0.011820, 0.042940, 0.968881,
];

export const TRITAN_1: Matrix = [
  1.255528, -0.076749, -0.178779,
  -0.078411, 0.930809, 0.147602,
  0.004733, 0.691367, 0.303900,
];

export type CvdType = "deutan" | "protan" | "tritan";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** sRGB gamma decode (IEC 61966-2-1). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB gamma encode (IEC 61966-2-1). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Simulate dichromacy for an sRGB color (channels 0..1).
 * Linearize → matrix → de-linearize → clamp.
 */
export function simulateRgb(rgb: Rgb, type: CvdType): Rgb {
  const m = type === "deutan" ? DEUTAN_1 : type === "protan" ? PROTAN_1 : TRITAN_1;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const nr = m[0] * r + m[1] * g + m[2] * b;
  const ng = m[3] * r + m[4] * g + m[5] * b;
  const nb = m[6] * r + m[7] * g + m[8] * b;
  const clamp = (v: number) => Math.max(0, Math.min(1, linearToSrgb(v)));
  return { r: clamp(nr), g: clamp(ng), b: clamp(nb) };
}

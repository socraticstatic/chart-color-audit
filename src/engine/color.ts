/**
 * Color records and perceptual math. All comparison math happens in OKLab;
 * WCAG contrast uses classic relative luminance from linearized sRGB.
 */
import { converter, formatHex, parse } from "culori";
import type { Oklab, Rgb as CuloriRgb } from "culori";
import { simulateRgb, srgbToLinear, type CvdType, type Rgb } from "./cvd.js";

const toOklab = converter("oklab");
const toRgb = converter("rgb");

export interface ColorRecord {
  /** Normalized #rrggbb hex of the color as parsed. */
  hex: string;
  /** sRGB channels in 0..1. */
  rgb: Rgb;
  /** OKLab coordinates. */
  oklab: { l: number; a: number; b: number };
}

/**
 * Parse a CSS color string into a ColorRecord.
 *
 * Accepts anything culori can parse (`#1a2b3c`, `hsl(210 40% 50%)`,
 * `rgb(...)`, named colors, `oklch(...)`) plus raw shadcn-style HSL triples
 * (`"222 47% 6%"`), which are wrapped as `hsl(...)` before parsing.
 * Returns null when the value is not a color.
 */
export function parseColor(input: string): ColorRecord | null {
  const raw = input.trim();
  let parsed = parse(raw);
  if (!parsed && /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/.test(raw)) {
    parsed = parse(`hsl(${raw})`);
  }
  if (!parsed) return null;
  const rgb = toRgb(parsed) as CuloriRgb;
  const lab = toOklab(parsed) as Oklab;
  return {
    hex: formatHex(parsed) ?? "#000000",
    rgb: { r: rgb.r ?? 0, g: rgb.g ?? 0, b: rgb.b ?? 0 },
    oklab: { l: lab.l ?? 0, a: lab.a ?? 0, b: lab.b ?? 0 },
  };
}

function fromRgb(rgb: Rgb): ColorRecord {
  const lab = toOklab({ mode: "rgb", ...rgb }) as Oklab;
  return {
    hex: formatHex({ mode: "rgb", ...rgb }) ?? "#000000",
    rgb,
    oklab: { l: lab.l ?? 0, a: lab.a ?? 0, b: lab.b ?? 0 },
  };
}

/**
 * Euclidean OKLab distance × 100 — values land on an intuitive scale where
 * ≈2 is the edge of what a human eye can tell apart (roughly comparable to
 * ΔE2000 magnitudes for small differences).
 */
export function deltaE(a: ColorRecord, b: ColorRecord): number {
  const dl = a.oklab.l - b.oklab.l;
  const da = a.oklab.a - b.oklab.a;
  const db = a.oklab.b - b.oklab.b;
  return Math.sqrt(dl * dl + da * da + db * db) * 100;
}

export type VisionMode = "normal" | "deutan" | "protan" | "tritan" | "achromatopsia";

export const VISION_MODES: VisionMode[] = [
  "normal",
  "deutan",
  "protan",
  "tritan",
  "achromatopsia",
];

/** Rec. 709 luma on linearized channels, re-encoded to sRGB gray. */
export function toGrayscale(c: ColorRecord): ColorRecord {
  const linY =
    0.2126 * srgbToLinear(c.rgb.r) +
    0.7152 * srgbToLinear(c.rgb.g) +
    0.0722 * srgbToLinear(c.rgb.b);
  const y = linY <= 0.0031308 ? 12.92 * linY : 1.055 * Math.pow(linY, 1 / 2.4) - 0.055;
  return fromRgb({ r: y, g: y, b: y });
}

/** Project a color through a vision simulation. */
export function simulate(c: ColorRecord, mode: VisionMode): ColorRecord {
  if (mode === "normal") return c;
  if (mode === "achromatopsia") return toGrayscale(c);
  return fromRgb(simulateRgb(c.rgb, mode as CvdType));
}

function relativeLuminance(c: Rgb): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** WCAG contrast ratio between two colors (order-independent). */
export function contrastRatio(a: ColorRecord, b: ColorRecord): number {
  const la = relativeLuminance(a.rgb);
  const lb = relativeLuminance(b.rgb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

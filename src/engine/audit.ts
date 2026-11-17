/**
 * The audit: pairwise perceptual separation under five vision simulations,
 * WCAG 2.2 SC 1.4.11 non-text contrast vs. the background, and optional
 * semantic-role collision checks.
 *
 * Floors philosophy: the default ("perceptual") fails anything a human eye
 * could not tell apart — min pairwise ΔE below ~2, the just-noticeable
 * difference. The "redundant-encodings" mode uses near-zero floors for
 * design systems that pair every color with a dash/decal/shape channel, so
 * color only needs to avoid outright collision. "strict" demands clear
 * separation with no redundancy assumed.
 */
import {
  compositeOver,
  contrastRatio,
  deltaE,
  parseColor,
  simulate,
  VISION_MODES,
  type ColorRecord,
  type VisionMode,
} from "./color.js";

export type FloorsMode = "perceptual" | "redundant-encodings" | "strict";

export interface Floors {
  /** Min pairwise ΔE (OKLab × 100) under normal vision. */
  minDeltaENormal: number;
  /** Min pairwise ΔE under each CVD/grayscale simulation. */
  minDeltaECvd: number;
  /** Min WCAG contrast ratio of every color vs. the background. */
  minContrast: number;
  /** Min WCAG contrast for tokens rendered as UI text (SC 1.4.3). */
  minTextContrast: number;
  /**
   * Min WCAG contrast between any two series. 0 (the default in every
   * preset) turns the check off. Set it to 3 for charts whose series touch
   * with nothing between them (pie slices, stacked bars or areas with no
   * gap or stroke), where SC 1.4.11 asks for 3:1 across the shared edge.
   */
  minPairContrast: number;
}

export const FLOOR_PRESETS: Record<FloorsMode, Floors> = {
  // JND ≈ 2 in OKLab×100: fail what an eye cannot tell apart.
  perceptual: { minDeltaENormal: 2, minDeltaECvd: 2, minContrast: 3, minTextContrast: 4.5, minPairContrast: 0 },
  // Color paired 1:1 with dash/decal/shape — color only avoids collision.
  "redundant-encodings": { minDeltaENormal: 1, minDeltaECvd: 0.1, minContrast: 3, minTextContrast: 4.5, minPairContrast: 0 },
  // No redundancy assumed: clearly distinct normally, distinguishable under CVD.
  strict: { minDeltaENormal: 10, minDeltaECvd: 4, minContrast: 3, minTextContrast: 4.5, minPairContrast: 0 },
};

/** Human-word reading of a measured minimum pairwise ΔE. */
export type Band =
  | "clearly-distinct" // ≥ 10
  | "distinguishable" // ≥ 2 (edge of human perception)
  | "patterns-carry-identity" // below JND but above the active floor
  | "collision"; // below the active floor
export function bandFor(value: number, floor: number): Band {
  if (value < floor) return "collision";
  if (value >= 10) return "clearly-distinct";
  if (value >= 2) return "distinguishable";
  return "patterns-carry-identity";
}

export interface VisionFinding {
  mode: VisionMode;
  /** Minimum pairwise ΔE across all color pairs under this simulation. */
  minDeltaE: number;
  /** Zero-based indexes of the closest pair (null when fewer than 2 colors). */
  closestPair: [number, number] | null;
  band: Band | null;
  floor: number;
  pass: boolean;
  /** Every pair below the floor, closest first. Empty when the mode passes. */
  failingPairs: { pair: [number, number]; deltaE: number }[];
}

/** WCAG contrast between series, for charts whose series share an edge. */
export interface PairContrastFinding {
  /** Lowest contrast ratio between any two series (Infinity with one color). */
  min: number;
  /** Zero-based indexes of that pair (null when fewer than 2 colors). */
  lowestPair: [number, number] | null;
  /** The active floor. 0 means the check is off and `pass` is always true. */
  floor: number;
  pass: boolean;
  /** Every pair below the floor, lowest first. Empty when the check is off. */
  failingPairs: { pair: [number, number]; ratio: number }[];
}

export interface ContrastFinding {
  index: number;
  hex: string;
  ratio: number;
  pass: boolean;
}

export type SemanticStatus = "ok" | "low-contrast" | "collision" | "cvd-risk";

export interface SemanticFinding {
  role: string;
  hex: string;
  contrast: number;
  /** Closest categorical slot under normal vision (index, ΔE). */
  nearestSlot: number;
  nearestDeltaE: number;
  /** Closest categorical slot under the worst CVD simulation. */
  nearestCvdSlot: number;
  nearestCvdDeltaE: number;
  status: SemanticStatus;
  reason: string | null;
}

export interface AuditInput {
  /** Palette colors, any CSS color string or raw HSL triple. Order = slot order. */
  colors: string[];
  /** Background the marks render on. */
  background: string;
  /** Optional semantic roles (e.g. positive/negative/muted) to check against the palette. */
  semanticRoles?: Record<string, string>;
  /**
   * Tokens rendered as UI text (status labels, captions, table numbers).
   * Marks need 3:1 (SC 1.4.11); small text needs 4.5:1 (SC 1.4.3). Reusing
   * mark tokens as text is the single most common failure this tool's parent
   * project shipped: a measured sweep found 111 instances of exactly that,
   * 89 of them one green that cleared the mark floor at 3.65-3.88:1.
   */
  textRoles?: Record<string, string>;
  /** Floors preset. Default: "perceptual". */
  mode?: FloorsMode;
  /** Per-floor overrides on top of the preset. */
  floors?: Partial<Floors>;
}

export interface TextFinding {
  role: string;
  hex: string;
  ratio: number;
  pass: boolean;
}

export interface AuditResult {
  /**
   * `hex` is the color as rendered on the background. For a translucent
   * input that is the composited color, and `alpha` carries the input's
   * opacity.
   */
  colors: { hex: string; input: string; alpha?: number }[];
  background: { hex: string; input: string };
  mode: FloorsMode;
  floors: Floors;
  perVision: VisionFinding[];
  contrast: ContrastFinding[];
  pairContrast: PairContrastFinding;
  semantic: SemanticFinding[];
  text: TextFinding[];
  verdict: "pass" | "fail";
  /** Human-readable reasons for every failure. Empty when verdict is "pass". */
  failures: string[];
}

class AuditError extends Error {}

const FLOOR_KEYS: (keyof Floors)[] = [
  "minDeltaENormal",
  "minDeltaECvd",
  "minContrast",
  "minTextContrast",
  "minPairContrast",
];

/** Floor overrides, checked: a mistyped floor must not become a silent pass or fail. */
function validFloors(floors: Partial<Floors> | undefined): Partial<Floors> {
  const out: Partial<Floors> = {};
  if (floors === undefined) return out;
  if (typeof floors !== "object" || floors === null || Array.isArray(floors)) {
    throw new AuditError(`"floors" must be an object with any of: ${FLOOR_KEYS.join(", ")}.`);
  }
  for (const [key, value] of Object.entries(floors as Record<string, unknown>)) {
    if (!FLOOR_KEYS.includes(key as keyof Floors)) {
      throw new AuditError(`Unknown floor "${key}". Expected one of: ${FLOOR_KEYS.join(", ")}.`);
    }
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new AuditError(`Floor "${key}" must be a number of 0 or more (got ${JSON.stringify(value)}).`);
    }
    out[key as keyof Floors] = value;
  }
  return out;
}

function parseOrThrow(input: string, what: string): ColorRecord {
  const c = parseColor(input);
  if (!c) throw new AuditError(`Cannot parse ${what}: "${input}"`);
  return c;
}

/**
 * Audit a palette. Throws Error with a clear message on unparseable input;
 * never throws for accessibility failures — those are reported in the result.
 */
export function audit(input: AuditInput): AuditResult {
  const mode: FloorsMode = input.mode ?? "perceptual";
  const preset = FLOOR_PRESETS[mode];
  if (!preset) {
    throw new AuditError(
      `Unknown mode "${String(mode)}" — expected one of ${Object.keys(FLOOR_PRESETS).join(", ")}`
    );
  }
  const floors: Floors = { ...preset, ...validFloors(input.floors) };
  if (input.colors.length === 0) throw new AuditError("No colors given.");

  const background = parseOrThrow(input.background, "background");
  if (background.alpha < 1) {
    throw new AuditError(
      `Background "${input.background}" is not opaque (alpha ${background.alpha}). ` +
        "Give the solid color the marks sit on."
    );
  }
  // A translucent mark is seen blended with the background, so that blend is
  // the color every check measures.
  const parsed = input.colors.map((c, i) => parseOrThrow(c, `color ${i + 1}`));
  const colors = parsed.map((c) => compositeOver(c, background));
  const failures: string[] = [];

  // Pairwise separation per vision mode.
  const perVision: VisionFinding[] = VISION_MODES.map((visionMode) => {
    const floor = visionMode === "normal" ? floors.minDeltaENormal : floors.minDeltaECvd;
    if (colors.length < 2) {
      return {
        mode: visionMode,
        minDeltaE: Infinity,
        closestPair: null,
        band: null,
        floor,
        pass: true,
        failingPairs: [],
      };
    }
    const sim = colors.map((c) => simulate(c, visionMode));
    let min = Infinity;
    let pair: [number, number] = [0, 1];
    const failingPairs: VisionFinding["failingPairs"] = [];
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i];
        const b = sim[j];
        if (!a || !b) continue;
        const d = deltaE(a, b);
        if (d < floor) failingPairs.push({ pair: [i, j], deltaE: d });
        if (d < min) {
          min = d;
          pair = [i, j];
        }
      }
    }
    failingPairs.sort((x, y) => x.deltaE - y.deltaE);
    const pass = min >= floor;
    if (!pass) {
      const others = failingPairs.slice(1);
      const shown = others
        .slice(0, 5)
        .map((p) => `${p.pair[0] + 1} and ${p.pair[1] + 1} (${p.deltaE.toFixed(2)})`)
        .join(", ");
      const more =
        others.length === 0
          ? ""
          : ` Also below the floor: ${shown}${others.length > 5 ? `, and ${others.length - 5} more` : ""}.`;
      failures.push(
        `${visionMode}: slots ${pair[0] + 1} and ${pair[1] + 1} are ΔE ${min.toFixed(2)} apart (floor ${floor}).${more}`
      );
    }
    return {
      mode: visionMode,
      minDeltaE: min,
      closestPair: pair,
      band: bandFor(min, floor),
      floor,
      pass,
      failingPairs,
    };
  });

  // WCAG non-text contrast vs. background, per color.
  const contrast: ContrastFinding[] = colors.map((c, index) => {
    const ratio = contrastRatio(c, background);
    const pass = ratio >= floors.minContrast;
    if (!pass) {
      failures.push(
        `contrast: slot ${index + 1} (${c.hex}) is ${ratio.toFixed(2)}:1 vs. background (needs ≥ ${floors.minContrast}:1, WCAG 2.2 SC 1.4.11).`
      );
    }
    return { index, hex: c.hex, ratio, pass };
  });

  // WCAG contrast between series. Always measured; a failure only when the
  // caller has set a floor, because it matters only where series touch.
  let pairMin = Infinity;
  let lowestPair: [number, number] | null = null;
  const lowPairs: PairContrastFinding["failingPairs"] = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i];
      const b = colors[j];
      if (!a || !b) continue;
      const ratio = contrastRatio(a, b);
      if (ratio < floors.minPairContrast) lowPairs.push({ pair: [i, j], ratio });
      if (ratio < pairMin) {
        pairMin = ratio;
        lowestPair = [i, j];
      }
    }
  }
  lowPairs.sort((x, y) => x.ratio - y.ratio);
  const pairContrast: PairContrastFinding = {
    min: pairMin,
    lowestPair,
    floor: floors.minPairContrast,
    pass: lowPairs.length === 0,
    failingPairs: lowPairs,
  };
  if (!pairContrast.pass) {
    const shown = lowPairs
      .slice(0, 6)
      .map((p) => `${p.pair[0] + 1} and ${p.pair[1] + 1} (${p.ratio.toFixed(2)}:1)`)
      .join(", ");
    failures.push(
      `pair contrast: ${lowPairs.length} pair${lowPairs.length === 1 ? "" : "s"} of series below ${floors.minPairContrast}:1 against each other: ${shown}${lowPairs.length > 6 ? `, and ${lowPairs.length - 6} more` : ""}. Where series touch, WCAG 2.2 SC 1.4.11 asks for the floor across the shared edge.`
    );
  }

  // Semantic roles vs. background and vs. the categorical palette.
  const semantic: SemanticFinding[] = Object.entries(input.semanticRoles ?? {}).map(
    ([role, value]) => {
      const color = compositeOver(parseOrThrow(value, `semantic role "${role}"`), background);
      const roleContrast = contrastRatio(color, background);

      let nearestSlot = -1;
      let nearestDeltaE = Infinity;
      let nearestCvdSlot = -1;
      let nearestCvdDeltaE = Infinity;
      colors.forEach((slot, idx) => {
        const d = deltaE(color, slot);
        if (d < nearestDeltaE) {
          nearestDeltaE = d;
          nearestSlot = idx;
        }
        for (const m of ["deutan", "protan", "tritan"] as const) {
          const dc = deltaE(simulate(color, m), simulate(slot, m));
          if (dc < nearestCvdDeltaE) {
            nearestCvdDeltaE = dc;
            nearestCvdSlot = idx;
          }
        }
      });

      let status: SemanticStatus = "ok";
      let reason: string | null = null;
      if (roleContrast < floors.minContrast) {
        status = "low-contrast";
        reason = `Contrast ${roleContrast.toFixed(2)}:1 vs. background (needs ≥ ${floors.minContrast}:1).`;
      } else if (colors.length > 0 && nearestDeltaE < floors.minDeltaENormal) {
        status = "collision";
        reason = `Collides with slot ${nearestSlot + 1} (ΔE ${nearestDeltaE.toFixed(2)} < ${floors.minDeltaENormal}).`;
      } else if (colors.length > 0 && nearestCvdDeltaE < floors.minDeltaECvd) {
        status = "cvd-risk";
        reason = `Under CVD simulation, collides with slot ${nearestCvdSlot + 1} (ΔE ${nearestCvdDeltaE.toFixed(2)} < ${floors.minDeltaECvd}).`;
      }
      // cvd-risk is deliberately reported without failing the verdict:
      // semantic roles usually carry redundant cues (position, icon, label),
      // so a CVD-only collision is a review prompt, not a CI failure. The
      // README documents this contract — change both together or neither.
      if (status === "low-contrast" || status === "collision") {
        failures.push(`semantic "${role}": ${reason}`);
      }

      return {
        role,
        hex: color.hex,
        contrast: roleContrast,
        nearestSlot,
        nearestDeltaE,
        nearestCvdSlot,
        nearestCvdDeltaE,
        status,
        reason,
      };
    }
  );

  // Text tokens vs. background at the SC 1.4.3 floor.
  const text: TextFinding[] = Object.entries(input.textRoles ?? {}).map(([role, value]) => {
    const color = compositeOver(parseOrThrow(value, `text token "${role}"`), background);
    const ratio = contrastRatio(color, background);
    const pass = ratio >= floors.minTextContrast;
    if (!pass) {
      failures.push(
        `text "${role}": ${color.hex} is ${ratio.toFixed(2)}:1 vs. background as UI text (needs ≥ ${floors.minTextContrast}:1, WCAG 2.2 SC 1.4.3 — the 3:1 mark floor does not apply to text).`
      );
    }
    return { role, hex: color.hex, ratio, pass };
  });

  return {
    colors: colors.map((c, i) => {
      const alpha = parsed[i]?.alpha ?? 1;
      return alpha < 1
        ? { hex: c.hex, input: input.colors[i] ?? "", alpha }
        : { hex: c.hex, input: input.colors[i] ?? "" };
    }),
    background: { hex: background.hex, input: input.background },
    mode,
    floors,
    perVision,
    contrast,
    pairContrast,
    semantic,
    text,
    verdict: failures.length === 0 ? "pass" : "fail",
    failures,
  };
}

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
}

export const FLOOR_PRESETS: Record<FloorsMode, Floors> = {
  // JND ≈ 2 in OKLab×100: fail what an eye cannot tell apart.
  perceptual: { minDeltaENormal: 2, minDeltaECvd: 2, minContrast: 3, minTextContrast: 4.5 },
  // Color paired 1:1 with dash/decal/shape — color only avoids collision.
  "redundant-encodings": { minDeltaENormal: 1, minDeltaECvd: 0.1, minContrast: 3, minTextContrast: 4.5 },
  // No redundancy assumed: clearly distinct normally, distinguishable under CVD.
  strict: { minDeltaENormal: 10, minDeltaECvd: 4, minContrast: 3, minTextContrast: 4.5 },
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
  colors: { hex: string; input: string }[];
  background: { hex: string; input: string };
  mode: FloorsMode;
  floors: Floors;
  perVision: VisionFinding[];
  contrast: ContrastFinding[];
  semantic: SemanticFinding[];
  text: TextFinding[];
  verdict: "pass" | "fail";
  /** Human-readable reasons for every failure. Empty when verdict is "pass". */
  failures: string[];
}

class AuditError extends Error {}

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
  const floors: Floors = { ...preset, ...input.floors };
  if (input.colors.length === 0) throw new AuditError("No colors given.");

  const colors = input.colors.map((c, i) => parseOrThrow(c, `color ${i + 1}`));
  const background = parseOrThrow(input.background, "background");
  const failures: string[] = [];

  // Pairwise separation per vision mode.
  const perVision: VisionFinding[] = VISION_MODES.map((visionMode) => {
    const floor = visionMode === "normal" ? floors.minDeltaENormal : floors.minDeltaECvd;
    if (colors.length < 2) {
      return { mode: visionMode, minDeltaE: Infinity, closestPair: null, band: null, floor, pass: true };
    }
    const sim = colors.map((c) => simulate(c, visionMode));
    let min = Infinity;
    let pair: [number, number] = [0, 1];
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i];
        const b = sim[j];
        if (!a || !b) continue;
        const d = deltaE(a, b);
        if (d < min) {
          min = d;
          pair = [i, j];
        }
      }
    }
    const pass = min >= floor;
    if (!pass) {
      failures.push(
        `${visionMode}: slots ${pair[0] + 1} and ${pair[1] + 1} are ΔE ${min.toFixed(2)} apart (floor ${floor}).`
      );
    }
    return {
      mode: visionMode,
      minDeltaE: min,
      closestPair: pair,
      band: bandFor(min, floor),
      floor,
      pass,
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

  // Semantic roles vs. background and vs. the categorical palette.
  const semantic: SemanticFinding[] = Object.entries(input.semanticRoles ?? {}).map(
    ([role, value]) => {
      const color = parseOrThrow(value, `semantic role "${role}"`);
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
    const color = parseOrThrow(value, `text token "${role}"`);
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
    colors: colors.map((c, i) => ({ hex: c.hex, input: input.colors[i] ?? "" })),
    background: { hex: background.hex, input: input.background },
    mode,
    floors,
    perVision,
    contrast,
    semantic,
    text,
    verdict: failures.length === 0 ? "pass" : "fail",
    failures,
  };
}

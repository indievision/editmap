import { framingRank } from "./framing";
import type { CutAnnotation, CutInterpretation, Shot } from "../models/project";

export type CutPair = {
  outgoing: Shot;
  incoming: Shot;
  time: number;
  transition: string;
};

export function cutPairAt(shots: Shot[], incomingId?: string): CutPair | undefined {
  const incomingIndex = shots.findIndex((shot) => shot.id === incomingId);
  if (incomingIndex < 1) return undefined;
  const outgoing = shots[incomingIndex - 1];
  const incoming = shots[incomingIndex];
  // A gap is a new passage, not an edit relationship.
  if (Math.abs(outgoing.endSeconds - incoming.startSeconds) > 0.00001) return undefined;
  return { outgoing, incoming, time: incoming.startSeconds, transition: incoming.transition };
}

export function framingChange(pair: CutPair) {
  const before = framingRank(pair.outgoing);
  const after = framingRank(pair.incoming);
  if (before === null || after === null)
    return { label: "Unclassified", detail: "Tag both shots with a framing size to compare." };
  if (after > before)
    return { label: "Tighter", detail: `${pair.outgoing.shotSize} → ${pair.incoming.shotSize}` };
  if (after < before)
    return { label: "Wider", detail: `${pair.outgoing.shotSize} → ${pair.incoming.shotSize}` };
  return { label: "Same framing", detail: `${pair.outgoing.shotSize} → ${pair.incoming.shotSize}` };
}

export function durationChange(pair: CutPair) {
  const ratio = pair.incoming.duration / pair.outgoing.duration;
  const label = ratio > 1.05 ? "Longer" : ratio < 0.95 ? "Shorter" : "Similar hold";
  return { label, detail: `${pair.outgoing.duration.toFixed(2)}s → ${pair.incoming.duration.toFixed(2)}s` };
}

export function annotationFor(annotations: CutAnnotation[] | undefined, pair: CutPair) {
  return annotations?.find((item) => item.outgoingId === pair.outgoing.id && item.incomingId === pair.incoming.id) ?? {
    outgoingId: pair.outgoing.id,
    incomingId: pair.incoming.id,
    interpretation: "Unmarked" as CutInterpretation,
    notes: "",
  };
}

/**
 * Calculates Euclidean color distance in normalized Rec. 709 RGB space [0, 1].
 */
export function calculateColorDistance(paletteA: string[] = [], paletteB: string[] = []): number {
  if (!paletteA.length || !paletteB.length) return 0;
  const hexToRgb = (hex: string) => {
    const clean = hex.replace("#", "");
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [0.5, 0.5, 0.5];
    return [
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255,
    ];
  };

  const cA = hexToRgb(paletteA[0]);
  const cB = hexToRgb(paletteB[0]);

  const dist = Math.sqrt((cA[0] - cB[0]) ** 2 + (cA[1] - cB[1]) ** 2 + (cA[2] - cB[2]) ** 2) / Math.sqrt(3);
  return Math.min(1, Math.max(0, dist));
}

export interface CutVisualDeltaResult {
  deltaLuma: number;
  deltaChroma: number;
  deltaV: number;
  shockScore: number;
}

/**
 * Calculates Cut Visual Delta (ΔV) and Sensory Shock Index across a cut boundary.
 * ΔLuma = |Y_B - Y_A|
 * ΔChroma = ColorDistance(Palette_A, Palette_B)
 * ΔV = 0.6 * ΔLuma + 0.4 * ΔChroma
 * Shock = ΔV * min(2.5, 2.0 / max(0.2, duration_B)) * 40 (0 - 100 scale)
 */
export function calculateCutVisualDelta(outgoing: Shot, incoming: Shot): CutVisualDeltaResult {
  const lumaA = outgoing.colorProfile?.luminance ?? 0.5;
  const lumaB = incoming.colorProfile?.luminance ?? 0.5;
  const deltaLuma = Math.abs(lumaB - lumaA);

  const deltaChroma = calculateColorDistance(
    outgoing.colorProfile?.palette,
    incoming.colorProfile?.palette,
  );

  const deltaV = 0.6 * deltaLuma + 0.4 * deltaChroma;

  const durationB = Math.max(0.2, incoming.duration);
  const durationMultiplier = Math.min(2.5, 2.0 / durationB);
  const shockScore = Math.min(100, Math.round(deltaV * durationMultiplier * 40));

  return {
    deltaLuma: Number(deltaLuma.toFixed(3)),
    deltaChroma: Number(deltaChroma.toFixed(3)),
    deltaV: Number(deltaV.toFixed(3)),
    shockScore,
  };
}

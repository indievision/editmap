import { fetchLocalModel } from "./localModel";
import { framingRank } from "./framing";
import type { CutAnnotation, CutInterpretation, EyeTraceCutReading, FocalPoint, Shot } from "../models/project";

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

export function colorMatchAtCut(outgoing: Shot, incoming: Shot) {
  const outgoingSample = outgoing.colorProfile?.temporal?.boundary?.end;
  const incomingSample = incoming.colorProfile?.temporal?.boundary?.start;
  const before = outgoingSample ?? outgoing.colorProfile;
  const after = incomingSample ?? incoming.colorProfile;
  if (!before || !after) return { label: "Awaiting colour evidence", score: null };
  const deltaLuminance = Math.abs(after.luminance - before.luminance);
  const deltaTemperature = Math.abs(after.temperature - before.temperature);
  const deltaSaturation = Math.abs(after.saturation - before.saturation);
  const deltaPalette = calculateColorDistance(before.palette, after.palette);
  const score = Math.min(1, .35 * deltaLuminance + .2 * (deltaTemperature / 2) + .2 * deltaSaturation + .25 * deltaPalette);
  const label = score <= .10 ? "Close colour match"
    : deltaLuminance >= .16 ? "Luminance jump"
    : deltaTemperature >= .28 ? "Temperature contrast"
    : deltaSaturation >= .18 ? "Saturation shift"
    : deltaPalette >= .22 ? "Palette discontinuity"
    : "Measured colour shift";
  return { label, score: Number(score.toFixed(3)), nearBoundary: Boolean(outgoingSample && incomingSample) };
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

/**
 * Calculates Eye-Trace Euclidean jump distance and Walter Murch saccadic classification.
 */
export function calculateEyeTrace(
  outgoingPoint: FocalPoint,
  incomingPoint: FocalPoint
): EyeTraceCutReading {
  const dx = incomingPoint.x - outgoingPoint.x;
  const dy = incomingPoint.y - outgoingPoint.y;
  const jumpDistance = Math.sqrt(dx * dx + dy * dy);
  const jumpDistancePercent = Math.min(100, Math.round(jumpDistance * 100));

  let rating: "smooth" | "natural" | "jarring";
  if (jumpDistancePercent <= 18) {
    rating = "smooth";
  } else if (jumpDistancePercent <= 38) {
    rating = "natural";
  } else {
    rating = "jarring";
  }

  let screenDirection: "left-to-right" | "right-to-left" | "neutral" = "neutral";
  if (dx > 0.12) {
    screenDirection = "left-to-right";
  } else if (dx < -0.12) {
    screenDirection = "right-to-left";
  }

  return {
    outgoingFocalPoint: outgoingPoint,
    incomingFocalPoint: incomingPoint,
    jumpDistance: Number(jumpDistance.toFixed(3)),
    jumpDistancePercent,
    rating,
    screenDirection,
  };
}

/**
 * Client-side visual saliency and human focal point detection using HTML5 Canvas.
 * Combines Sobel edge energy, YCbCr skin tone probability, and cinematic center-rule Gaussian bias.
 */
export async function extractClientFocalPoint(imageSrc: string): Promise<FocalPoint> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = 160;
        const h = 90;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve({ x: 0.5, y: 0.45, type: "center", confidence: 0.5 });
          return;
        }

        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Grayscale & Luminance buffer
        const luma = new Float32Array(w * h);
        const skin = new Float32Array(w * h);
        let skinCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const idx = i >> 2;

          // Rec. 709 Luma
          luma[idx] = 0.299 * r + 0.587 * g + 0.114 * b;

          // YCbCr skin detection
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

          // Standard skin cluster range
          if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) {
            skin[idx] = 1.0;
            skinCount++;
          }
        }

        const isSkinDominant = skinCount > 40; // clustered human presence

        // Saliency map
        let totalWeight = 0;
        let weightedX = 0;
        let weightedY = 0;

        for (let y = 1; y < h - 1; y++) {
          const ny = y / h;
          for (let x = 1; x < w - 1; x++) {
            const nx = x / w;
            const idx = y * w + x;

            // Sobel horizontal and vertical gradients
            const gx =
              luma[idx + 1] -
              luma[idx - 1] +
              0.5 * (luma[idx + 1 - w] - luma[idx - 1 - w]) +
              0.5 * (luma[idx + 1 + w] - luma[idx - 1 + w]);
            const gy =
              luma[idx + w] -
              luma[idx - w] +
              0.5 * (luma[idx + w - 1] - luma[idx - w - 1]) +
              0.5 * (luma[idx + w + 1] - luma[idx - w + 1]);
            const gradient = Math.sqrt(gx * gx + gy * gy);

            // Center / Rule-of-thirds Gaussian bias (center slightly high at 0.45)
            const cdx = nx - 0.5;
            const cdy = ny - 0.45;
            const centerBias = Math.exp(-(cdx * cdx + cdy * cdy) / 0.28);

            // Saliency score
            let score = gradient * centerBias;
            if (skin[idx] > 0) {
              score += 120 * centerBias; // Faces draw focal priority
            }

            if (score > 10) {
              totalWeight += score;
              weightedX += nx * score;
              weightedY += ny * score;
            }
          }
        }

        if (totalWeight <= 0) {
          resolve({ x: 0.5, y: 0.45, type: "center", confidence: 0.5 });
          return;
        }

        const focalX = Math.max(0.05, Math.min(0.95, weightedX / totalWeight));
        const focalY = Math.max(0.05, Math.min(0.95, weightedY / totalWeight));
        const focalType = isSkinDominant ? "face" : "saliency";

        resolve({
          x: Number(focalX.toFixed(3)),
          y: Number(focalY.toFixed(3)),
          type: focalType,
          confidence: isSkinDominant ? 0.88 : 0.72,
        });
      } catch {
        resolve({ x: 0.5, y: 0.45, type: "center", confidence: 0.5 });
      }
    };
    img.onerror = () => {
      resolve({ x: 0.5, y: 0.45, type: "center", confidence: 0.5 });
    };
    img.src = imageSrc;
  });
}

/**
 * Analyzes eye trace across cut boundary frames.
 * Uses local Python CV service if available; automatically falls back to client canvas saliency.
 */
export async function analyzeCutEyeTrace(
  outgoingFrame: string,
  incomingFrame: string
): Promise<EyeTraceCutReading> {
  // Attempt local CV server first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetchLocalModel("/api/analyze-eye-trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outgoingImage: outgoingFrame,
        incomingImage: incomingFrame,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as EyeTraceCutReading;
      if (data && data.outgoingFocalPoint && data.incomingFocalPoint) {
        return data;
      }
    }
  } catch {
    // Local server unavailable or timed out; fall back to client-side extraction seamlessly
  }

  const [outgoingPoint, incomingPoint] = await Promise.all([
    extractClientFocalPoint(outgoingFrame),
    extractClientFocalPoint(incomingFrame),
  ]);

  return calculateEyeTrace(outgoingPoint, incomingPoint);
}

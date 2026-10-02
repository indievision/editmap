import { fetchLocalModel } from "./localModel";
import { framingRank } from "./framing";
import type { CutAnnotation, CutInterpretation, EyeTraceCutReading, FocalPoint, GazeMomentum, Shot } from "../models/project";

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
 * Calculates Eye-Trace Euclidean jump distance, Walter Murch saccadic classification,
 * and optional kinetic gaze momentum alignment.
 */
export function calculateEyeTrace(
  outgoingPoint: FocalPoint,
  incomingPoint: FocalPoint,
  momentum?: GazeMomentum
): EyeTraceCutReading {
  const dx = incomingPoint.x - outgoingPoint.x;
  const dy = incomingPoint.y - outgoingPoint.y;
  const jumpDistance = Math.sqrt(dx * dx + dy * dy);
  const jumpDistancePercent = Math.min(100, Math.round(jumpDistance * 100));

  let rating: "anchored" | "shifted" | "scattered";
  if (jumpDistancePercent <= 18) {
    rating = "anchored";
  } else if (jumpDistancePercent <= 38) {
    rating = "shifted";
  } else {
    rating = "scattered";
  }

  let screenDirection: "left-to-right" | "right-to-left" | "neutral" = "neutral";
  if (dx > 0.12) {
    screenDirection = "left-to-right";
  } else if (dx < -0.12) {
    screenDirection = "right-to-left";
  }

  // 1. 180° Axis Clash Warning
  let axisClash = false;
  let axisClashDetail: string | undefined = undefined;
  const gaze1 = outgoingPoint.gazeDirection;
  const gaze2 = incomingPoint.gazeDirection;
  const isSameSide = (outgoingPoint.x > 0.50 && incomingPoint.x > 0.50) || (outgoingPoint.x < 0.50 && incomingPoint.x < 0.50);

  if (isSameSide && gaze1 && gaze2 && gaze1 === gaze2 && gaze1 !== "direct") {
    axisClash = true;
    const sideStr = outgoingPoint.x > 0.50 ? "screen-right" : "screen-left";
    axisClashDetail = `Both subjects framed ${sideStr} facing ${gaze1} (180° line cross)`;
  }

  // 2. Character Replacement / Jump-Cut Collision
  let characterReplacement = false;
  let characterReplacementDetail: string | undefined = undefined;
  if (jumpDistancePercent <= 12 && outgoingPoint.type !== "center" && incomingPoint.type !== "center") {
    characterReplacement = true;
    characterReplacementDetail = `Subject substituted in place (${jumpDistancePercent}% hop)`;
  }

  // 3. Depth / Focal Plane Accommodation Shift
  const s1 = outgoingPoint.sharpness ?? 100;
  const s2 = incomingPoint.sharpness ?? 100;
  let depthShift = undefined;
  if (s1 > 100 && s2 < 45) {
    depthShift = {
      outgoingSharpness: s1,
      incomingSharpness: s2,
      shift: "near-to-far" as const,
      magnitude: s1 > 180 ? ("high" as const) : ("moderate" as const),
    };
  } else if (s2 > 100 && s1 < 45) {
    depthShift = {
      outgoingSharpness: s1,
      incomingSharpness: s2,
      shift: "far-to-near" as const,
      magnitude: s2 > 180 ? ("high" as const) : ("moderate" as const),
    };
  }

  return {
    outgoingFocalPoint: outgoingPoint,
    incomingFocalPoint: incomingPoint,
    jumpDistance: Number(jumpDistance.toFixed(3)),
    jumpDistancePercent,
    rating,
    screenDirection,
    axisClash,
    axisClashDetail,
    characterReplacement,
    characterReplacementDetail,
    depthShift,
    ...(momentum ? { momentum } : {}),
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
    img.onload = async () => {
      // 1. Priority: Browser Native FaceDetector API (Chromium / Chrome)
      if (typeof window !== "undefined" && "FaceDetector" in window) {
        try {
          const detector = new (window as any).FaceDetector({ fastMode: false, maxDetectedFaces: 5 });
          const faces = await detector.detect(img);
          if (faces && Array.isArray(faces) && faces.length > 0) {
            faces.sort(
              (a: any, b: any) =>
                b.boundingBox.width * b.boundingBox.height -
                a.boundingBox.width * a.boundingBox.height
            );
            const best = faces[0];
            const box = best.boundingBox;
            let eyeX = box.x + box.width / 2;
            let eyeY = box.y + box.height * 0.35;
            if (best.landmarks && Array.isArray(best.landmarks)) {
              const eyes = best.landmarks.filter((l: any) => l.type === "eye");
              if (eyes.length >= 2) {
                eyeX = (eyes[0].location.x + eyes[1].location.x) / 2;
                eyeY = (eyes[0].location.y + eyes[1].location.y) / 2;
              } else if (eyes.length === 1) {
                eyeX = eyes[0].location.x;
                eyeY = eyes[0].location.y;
              }
            }
            const natW = img.naturalWidth || box.width;
            const natH = img.naturalHeight || box.height;
            resolve({
              x: Number(Math.max(0.02, Math.min(0.98, eyeX / natW)).toFixed(3)),
              y: Number(Math.max(0.02, Math.min(0.98, eyeY / natH)).toFixed(3)),
              type: "eyes",
              confidence: 0.94,
            });
            return;
          }
        } catch {
          // Native FaceDetector failed or disabled, fall back to canvas
        }
      }

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
        const skin = new Uint8Array(w * h);
        let totalSkin = 0;

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
            skin[idx] = 1;
            totalSkin++;
          }
        }

        // Sobel gradients
        const grad = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
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
            grad[idx] = Math.sqrt(gx * gx + gy * gy);
          }
        }

        // 2. Sliding window face & skin cluster localization
        // Typical face size at 160x90 is ~24x30 pixels.
        const winW = 26;
        const winH = 32;
        const step = 6;
        let bestScore = -1;
        let bestBox = { minX: 0, maxX: w, minY: 0, maxY: h };
        let bestIsSkin = false;

        for (let top = 2; top <= h - winH - 2; top += step) {
          const cyNorm = (top + winH / 2) / h;
          for (let left = 2; left <= w - winW - 2; left += step) {
            const cxNorm = (left + winW / 2) / w;

            let winSkin = 0;
            let winGrad = 0;
            for (let wy = 0; wy < winH; wy++) {
              const rowIdx = (top + wy) * w;
              for (let wx = 0; wx < winW; wx++) {
                const pxIdx = rowIdx + (left + wx);
                winSkin += skin[pxIdx];
                winGrad += grad[pxIdx];
              }
            }

            // Rule-of-thirds prior (mild bias towards typical upper composition)
            const cdx = cxNorm - 0.5;
            const cdy = cyNorm - 0.42;
            const prior = Math.exp(-(cdx * cdx + cdy * cdy) / 0.45);

            // Skin presence heavily prioritized for human attention
            const score = (winSkin * 3.5 + winGrad * 0.05) * prior;

            if (score > bestScore) {
              bestScore = score;
              bestIsSkin = winSkin >= 22;
              bestBox = {
                minX: left,
                maxX: left + winW,
                minY: top,
                maxY: top + winH,
              };
            }
          }
        }

        if (bestIsSkin) {
          // Inside best face box, compute precise bounding box of skin pixels
          let skMinX = bestBox.maxX;
          let skMaxX = bestBox.minX;
          let skMinY = bestBox.maxY;
          let skMaxY = bestBox.minY;
          let skCount = 0;

          for (let py = bestBox.minY; py < bestBox.maxY; py++) {
            const rIdx = py * w;
            for (let px = bestBox.minX; px < bestBox.maxX; px++) {
              if (skin[rIdx + px]) {
                skCount++;
                if (px < skMinX) skMinX = px;
                if (px > skMaxX) skMaxX = px;
                if (py < skMinY) skMinY = py;
                if (py > skMaxY) skMaxY = py;
              }
            }
          }

          if (skCount >= 18) {
            const eyeX = (skMinX + skMaxX) / 2 / w;
            // Eyes are at ~35% down the face height
            const eyeY = (skMinY + 0.35 * (skMaxY - skMinY)) / h;
            resolve({
              x: Number(Math.max(0.02, Math.min(0.98, eyeX)).toFixed(3)),
              y: Number(Math.max(0.02, Math.min(0.98, eyeY)).toFixed(3)),
              type: "eyes",
              confidence: 0.88,
            });
            return;
          }
        }

        // 3. Fallback: Peak Visual Saliency
        let maxGradVal = 0;
        let peakX = 0.5;
        let peakY = 0.45;
        for (let y = 4; y < h - 4; y++) {
          const ny = y / h;
          for (let x = 4; x < w - 4; x++) {
            const nx = x / w;
            const cdx = nx - 0.5;
            const cdy = ny - 0.45;
            const prior = Math.exp(-(cdx * cdx + cdy * cdy) / 0.40);
            const val = grad[y * w + x] * prior;
            if (val > maxGradVal) {
              maxGradVal = val;
              peakX = nx;
              peakY = ny;
            }
          }
        }

        resolve({
          x: Number(Math.max(0.05, Math.min(0.95, peakX)).toFixed(3)),
          y: Number(Math.max(0.05, Math.min(0.95, peakY)).toFixed(3)),
          type: "saliency",
          confidence: 0.70,
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
 * Calculates optical flow displacement between two consecutive pre-cut frames
 * around the outgoing focal point to determine gaze momentum and collision.
 */
export async function calculateClientGazeMomentum(
  prevFrame: string,
  currFrame: string,
  outPoint: FocalPoint,
  inPoint: FocalPoint
): Promise<GazeMomentum> {
  return new Promise((resolve) => {
    const imgA = new Image();
    const imgB = new Image();
    let loaded = 0;
    const check = () => {
      loaded++;
      if (loaded === 2) compute();
    };
    const fallback: GazeMomentum = {
      vx: 0,
      vy: 0,
      velocity: 0,
      alignment: "static",
      cosineScore: 0,
    };
    imgA.onload = check;
    imgB.onload = check;
    imgA.onerror = () => resolve(fallback);
    imgB.onerror = () => resolve(fallback);
    imgA.src = prevFrame;
    imgB.src = currFrame;

    const compute = () => {
      try {
        const w = 160;
        const h = 90;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(fallback);

        ctx.drawImage(imgA, 0, 0, w, h);
        const dataA = ctx.getImageData(0, 0, w, h).data;
        ctx.drawImage(imgB, 0, 0, w, h);
        const dataB = ctx.getImageData(0, 0, w, h).data;

        // Convert to luma
        const lumaA = new Uint8Array(w * h);
        const lumaB = new Uint8Array(w * h);
        for (let i = 0; i < dataA.length; i += 4) {
          lumaA[i >> 2] = (dataA[i] * 77 + dataA[i + 1] * 150 + dataA[i + 2] * 29) >> 8;
          lumaB[i >> 2] = (dataB[i] * 77 + dataB[i + 1] * 150 + dataB[i + 2] * 29) >> 8;
        }

        // Focus search around outgoing focal point
        const fx = Math.round(outPoint.x * w);
        const fy = Math.round(outPoint.y * h);
        const blockSize = 12;
        const searchRange = 6;
        const bx = Math.max(searchRange, Math.min(w - blockSize - searchRange, fx - (blockSize >> 1)));
        const by = Math.max(searchRange, Math.min(h - blockSize - searchRange, fy - (blockSize >> 1)));

        let bestDx = 0;
        let bestDy = 0;
        let minSAD = Infinity;

        for (let dy = -searchRange; dy <= searchRange; dy += 2) {
          for (let dx = -searchRange; dx <= searchRange; dx += 2) {
            let sad = 0;
            for (let py = 0; py < blockSize; py += 2) {
              const rowA = (by + py) * w;
              const rowB = (by + py + dy) * w;
              for (let px = 0; px < blockSize; px += 2) {
                sad += Math.abs(lumaA[rowA + bx + px] - lumaB[rowB + bx + px + dx]);
              }
            }
            if (sad < minSAD) {
              minSAD = sad;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }

        const vx = Number(Math.max(-1, Math.min(1, bestDx / searchRange)).toFixed(3));
        const vy = Number(Math.max(-1, Math.min(1, bestDy / searchRange)).toFixed(3));
        const velMag = Math.sqrt(vx * vx + vy * vy);
        const velocity = Math.min(100, Math.round(velMag * 100));

        const sx = inPoint.x - outPoint.x;
        const sy = inPoint.y - outPoint.y;
        const sMag = Math.sqrt(sx * sx + sy * sy);

        if (velMag < 0.1 || sMag < 0.04) {
          return resolve({
            vx: 0,
            vy: 0,
            velocity: 0,
            alignment: "static",
            cosineScore: 0,
          });
        }

        const cosine = (vx * sx + vy * sy) / (velMag * sMag);
        const cosineScore = Number(Math.max(-1, Math.min(1, cosine)).toFixed(3));

        let alignment: "momentum-match" | "neutral" | "momentum-collision" | "static" = "neutral";
        if (cosineScore >= 0.40) {
          alignment = "momentum-match";
        } else if (cosineScore <= -0.40) {
          alignment = "momentum-collision";
        }

        resolve({
          vx,
          vy,
          velocity,
          alignment,
          cosineScore,
        });
      } catch {
        resolve(fallback);
      }
    };
  });
}

/**
 * Analyzes eye trace and optical flow gaze momentum across cut boundary frames.
 * Uses local Python CV service if available; automatically falls back to client canvas saliency.
 */
export async function analyzeCutEyeTrace(
  outgoingFrame: string,
  incomingFrame: string,
  prevOutgoingFrame?: string
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
        ...(prevOutgoingFrame ? { prevOutgoingImage: prevOutgoingFrame } : {}),
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

  let momentum: GazeMomentum | undefined = undefined;
  if (prevOutgoingFrame) {
    momentum = await calculateClientGazeMomentum(
      prevOutgoingFrame,
      outgoingFrame,
      outgoingPoint,
      incomingPoint
    );
  }

  return calculateEyeTrace(outgoingPoint, incomingPoint, momentum);
}

export interface WhiplashCluster {
  id: string;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  cutCount: number;
  avgJumpPercent: number;
  cuts: Array<{ incomingId: string; outgoingId: string; time: number; jumpPercent: number }>;
}

export function detectWhiplashClusters(
  shots: Shot[],
  annotations?: CutAnnotation[],
  maxGapSeconds: number = 8.0
): WhiplashCluster[] {
  if (!shots || shots.length < 2) return [];

  const cuts: Array<{
    outgoingId: string;
    incomingId: string;
    time: number;
    jumpPercent: number;
    isJarring: boolean;
  }> = [];

  const annotationMap = new Map<string, CutAnnotation>();
  if (annotations) {
    for (const ann of annotations) {
      annotationMap.set(`${ann.outgoingId}->${ann.incomingId}`, ann);
    }
  }

  for (let i = 0; i < shots.length - 1; i++) {
    const outgoing = shots[i];
    const incoming = shots[i + 1];
    if (Math.abs(incoming.startSeconds - outgoing.endSeconds) <= 0.04) {
      const ann = annotationMap.get(`${outgoing.id}->${incoming.id}`);
      const eye = ann?.eyeTrace;
      const jumpPercent = eye?.jumpDistancePercent ?? 0;
      const isJarring = eye ? eye.rating === "jarring" || eye.jumpDistancePercent > 38 : false;
      cuts.push({
        outgoingId: outgoing.id,
        incomingId: incoming.id,
        time: incoming.startSeconds,
        jumpPercent,
        isJarring,
      });
    }
  }

  const clusters: WhiplashCluster[] = [];
  let currentGroup: typeof cuts = [];

  const flushGroup = () => {
    if (currentGroup.length >= 2) {
      const totalJump = currentGroup.reduce((sum, c) => sum + c.jumpPercent, 0);
      clusters.push({
        id: `whiplash-cluster-${clusters.length + 1}`,
        startIndex: 0,
        endIndex: 0,
        startTime: currentGroup[0].time,
        endTime: currentGroup[currentGroup.length - 1].time,
        cutCount: currentGroup.length,
        avgJumpPercent: Math.round(totalJump / currentGroup.length),
        cuts: currentGroup.map((c) => ({
          incomingId: c.incomingId,
          outgoingId: c.outgoingId,
          time: c.time,
          jumpPercent: c.jumpPercent,
        })),
      });
    }
    currentGroup = [];
  };

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (cut.isJarring) {
      if (currentGroup.length === 0) {
        currentGroup.push(cut);
      } else {
        const prev = currentGroup[currentGroup.length - 1];
        if (cut.time - prev.time <= maxGapSeconds) {
          currentGroup.push(cut);
        } else {
          flushGroup();
          currentGroup = [cut];
        }
      }
    } else {
      flushGroup();
    }
  }

  flushGroup();
  return clusters;
}

export interface SaccadeRangeStats {
  totalCuts: number;
  scannedCuts: number;
  avgJumpPercent: number | null;
  smoothCount: number;
  naturalCount: number;
  jarringCount: number;
  anchoredCount: number;
  shiftedCount: number;
  scatteredCount: number;
  collisionCount: number;
  axisClashCount: number;
  replacementCount: number;
  overallRating: "anchored" | "shifted" | "scattered" | "smooth" | "natural" | "jarring" | "unscanned";
}

export function getSaccadeRangeStats(
  shots: Shot[],
  annotations: CutAnnotation[] | undefined,
  startTime?: number,
  endTime?: number
): SaccadeRangeStats {
  const annotationMap = new Map<string, CutAnnotation>();
  if (annotations) {
    for (const ann of annotations) {
      annotationMap.set(`${ann.outgoingId}->${ann.incomingId}`, ann);
    }
  }

  let totalCuts = 0;
  let scannedCuts = 0;
  let totalJump = 0;
  let smoothCount = 0;
  let naturalCount = 0;
  let jarringCount = 0;
  let anchoredCount = 0;
  let shiftedCount = 0;
  let scatteredCount = 0;
  let collisionCount = 0;
  let axisClashCount = 0;
  let replacementCount = 0;

  for (let i = 0; i < shots.length - 1; i++) {
    const outgoing = shots[i];
    const incoming = shots[i + 1];
    if (Math.abs(incoming.startSeconds - outgoing.endSeconds) <= 0.04) {
      const cutTime = incoming.startSeconds;
      if (startTime !== undefined && cutTime < startTime) continue;
      if (endTime !== undefined && cutTime > endTime) continue;

      totalCuts++;
      const ann = annotationMap.get(`${outgoing.id}->${incoming.id}`);
      if (ann?.eyeTrace) {
        scannedCuts++;
        totalJump += ann.eyeTrace.jumpDistancePercent;
        const r = ann.eyeTrace.rating;
        if (r === "anchored" || r === "smooth") {
          anchoredCount++;
          smoothCount++;
        } else if (r === "shifted" || r === "natural") {
          shiftedCount++;
          naturalCount++;
        } else if (r === "scattered" || r === "jarring") {
          scatteredCount++;
          jarringCount++;
        }

        if (ann.eyeTrace.axisClash) {
          axisClashCount++;
        }
        if (ann.eyeTrace.characterReplacement) {
          replacementCount++;
        }
        if (ann.eyeTrace.momentum?.alignment === "momentum-collision") {
          collisionCount++;
        }
      }
    }
  }

  const avgJumpPercent = scannedCuts > 0 ? Math.round(totalJump / scannedCuts) : null;
  let overallRating: "anchored" | "shifted" | "scattered" | "smooth" | "natural" | "jarring" | "unscanned" = "unscanned";
  if (avgJumpPercent !== null) {
    if (avgJumpPercent <= 18) overallRating = "anchored";
    else if (avgJumpPercent <= 38) overallRating = "shifted";
    else overallRating = "scattered";
  }

  return {
    totalCuts,
    scannedCuts,
    avgJumpPercent,
    smoothCount,
    naturalCount,
    jarringCount,
    anchoredCount,
    shiftedCount,
    scatteredCount,
    collisionCount,
    axisClashCount,
    replacementCount,
    overallRating,
  };
}

export interface BatchScanProgress {
  current: number;
  total: number;
  percent: number;
  lastIncomingId?: string;
}

export async function scanProjectEyeTrace(
  shots: Shot[],
  existingAnnotations: CutAnnotation[] | undefined,
  videoUrl: string,
  fps: number = 24,
  onProgress?: (progress: BatchScanProgress) => void,
  signal?: AbortSignal
): Promise<CutAnnotation[]> {
  if (typeof document === "undefined" || !videoUrl || shots.length < 2) {
    return existingAnnotations ? [...existingAnnotations] : [];
  }

  const cuts: Array<{ outgoing: Shot; incoming: Shot; time: number }> = [];
  for (let i = 0; i < shots.length - 1; i++) {
    const outgoing = shots[i];
    const incoming = shots[i + 1];
    if (Math.abs(incoming.startSeconds - outgoing.endSeconds) <= 0.04) {
      cuts.push({ outgoing, incoming, time: incoming.startSeconds });
    }
  }

  if (cuts.length === 0) return existingAnnotations ? [...existingAnnotations] : [];

  const annotationMap = new Map<string, CutAnnotation>();
  if (existingAnnotations) {
    for (const ann of existingAnnotations) {
      annotationMap.set(`${ann.outgoingId}->${ann.incomingId}`, { ...ann });
    }
  }

  const decoder = document.createElement("video");
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");

  const wait = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Video event timeout")), 10000);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      decoder.addEventListener(event, done, { once: true });
      decoder.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Video decode error"));
        },
        { once: true }
      );
    });

  const capture = async (target: number) => {
    const sought = wait("seeked");
    decoder.currentTime = Math.max(0, Math.min(target, (decoder.duration || 1) - 0.001));
    await sought;
    if (!context) throw new Error("Canvas context unavailable");
    context.fillStyle = "#0a0c0d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / (decoder.videoWidth || 1), canvas.height / (decoder.videoHeight || 1));
    const width = (decoder.videoWidth || 1) * scale;
    const height = (decoder.videoHeight || 1) * scale;
    context.drawImage(decoder, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL("image/jpeg", 0.8);
  };

  try {
    decoder.muted = true;
    decoder.preload = "auto";
    const ready = wait("loadeddata");
    decoder.src = videoUrl;
    await ready;

    const frameRate = Math.max(1, fps);
    const frame = 1 / frameRate;

    for (let i = 0; i < cuts.length; i++) {
      if (signal?.aborted) break;
      const { outgoing, incoming, time } = cuts[i];
      const key = `${outgoing.id}->${incoming.id}`;

      try {
        const outgoingPrev = await capture(Math.max(outgoing.startSeconds, time - 2 * frame));
        const outgoingFrame = await capture(Math.max(outgoing.startSeconds, time - frame));
        const incomingFrame = await capture(Math.min(incoming.endSeconds - frame / 2, time + frame));

        const reading = await analyzeCutEyeTrace(outgoingFrame, incomingFrame, outgoingPrev);
        const existing = annotationMap.get(key) || {
          outgoingId: outgoing.id,
          incomingId: incoming.id,
          interpretation: "Unmarked" as const,
          notes: "",
        };
        annotationMap.set(key, { ...existing, eyeTrace: reading });
      } catch {
        // Continue to next cut if individual capture fails
      }

      onProgress?.({
        current: i + 1,
        total: cuts.length,
        percent: Math.round(((i + 1) / cuts.length) * 100),
        lastIncomingId: incoming.id,
      });
    }
  } finally {
    decoder.removeAttribute("src");
    decoder.load();
  }

  return Array.from(annotationMap.values());
}
